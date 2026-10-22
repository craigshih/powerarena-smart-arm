// 改良版懸吊鎖附手臂的 3D 模型。
//
//   const arm = createSmartArm({ side: 'L' });   // 回傳 THREE.Group，原點在軌道吊點
//   scene.add(arm);
//   arm.setState(logic.getState());              // 依狀態機更新燈號、工具標籤
//   arm.setToolTarget(new THREE.Vector3(...));   // 工具套筒要去的位置（世界座標）
//   arm.update(dt, time);                        // 每幀呼叫：平滑移動、燈號閃爍
//
// 結構：台車（沿軌道 z 移動）→ 垂直柱 → J1 旋轉 → 第一節臂 → J2 旋轉 → 第二節臂
//       → 平衡器（垂直伸縮）→ 鎖附工具。手臂螢幕裝在平衡器外管下端，跟著工具移動、面向師傅。
//       控制器固定在軌道吊架上，不跟著工具晃。

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { P, SEQUENCE, armMount, zoneById } from './arm-params.js';
import { signalsFor, describe } from './arm-logic.js';

export const PRINCIPLES = {
  1: { short: '不增加動作', title: '不違反人類自然行為、不增加成本', desc: '不能讓師傅多按按鈕，也不能讓他多看一個地方。' },
  2: { short: '從工具思考', title: '從工具思考，而非作業流程', desc: '防錯要靠工具與控制器本身做到。' },
  3: { short: '妥善率', title: '妥善率最重要', desc: '系統能穩定運作、有人負責，故障時有對策。' },
};

// 改良點（點部件時顯示；UI 的改良點清單與 README 都依這份）
export const ARM_PARTS = [
  {
    key: 'enable', n: 1, title: '工具內建致能／鎖定', tag: '致能鎖定', principles: [1, 2],
    what: '控制器讀承盤 PLC 的「下降完成」訊號。A 階段只開放第一階段的螺絲數，鎖滿就自動鎖住工具；承盤降到底才開放 C。',
    why: '師傅照原本的肌肉記憶作業，不用多按按鈕；能不能鎖由工具決定，而不是靠人記得。',
    fault: '控制器斷線時工具預設鎖住（失效即安全）；班長可用鑰匙切到降級模式。',
  },
  {
    key: 'torque', n: 2, title: '扭力／角度感測', tag: '扭力角度', principles: [2],
    what: '工具內建扭力感測器與角度編碼器，每顆螺絲回報扭力與角度，控制器當場判 OK／NG。NG 不計數，要原地重鎖。',
    why: '「有沒有鎖緊」由工具量測，不用另外抽檢；每顆都留下履歷。',
    fault: '感測器自我檢查失敗 → 記為工具錯誤，工具鎖住並通知班長。',
  },
  {
    key: 'ring', n: 3, title: '握把 LED 環＋震動', tag: 'LED 環', principles: [1],
    what: '綠＝可鎖附、藍＝鎖附中、黃＝已鎖定或位置不對、紅閃＝錯誤；錯誤時握把震動。',
    why: '提示出現在師傅手上、本來就在看的位置，不用多看一個地方。這是電動鎖附工具的內建功能，不是加裝在工具上的外掛裝置。',
    fault: 'LED 故障不影響連鎖；語音與三色燈仍會提示。',
  },
  {
    key: 'controller', n: 4, title: '控制器三色燈＋喇叭', tag: '燈號喇叭', principles: [1, 3],
    what: '控制器固定在軌道吊架上，不在工具上，不會晃。喇叭播「提前鎖附！提前鎖附！」等語音，三色燈同步工位狀態。',
    why: '師傅等待時不一定看前方，所以以聲音為主、燈號為輔；要看細節時再看手臂螢幕。',
    fault: '每班開工自動自我檢查（燈號＋試播語音），異常即通知維護。',
  },
  {
    key: 'encoder', n: 5, title: '關節編碼器（選配，評估中）', tag: '編碼器', principles: [1, 2, 3],
    what: '台車、兩個旋轉關節與平衡器升降都裝編碼器，控制器算出工具停在哪個區域。順序錯了直接鎖住工具，不必靠攝影機。',
    why: '師傅不用多做任何動作；裝在手臂結構上，不在工具上。風險在妥善率：需要校正，車輛若隨輸送線移動還要補償位置。',
    fault: '編碼器故障時只關閉順序檢查，承盤連鎖照常運作，不讓產線停下來。',
  },
  {
    key: 'plc', n: 6, title: '承盤 PLC 訊號（I/O）', tag: 'PLC 訊號', principles: [2, 3],
    what: '控制器接承盤的「開始下降」「下降完成」數位訊號。承盤開始下降 8 秒內沒收到「下降完成」，判自動化錯誤。',
    why: '直接用設備本身的訊號判斷時機，不靠師傅或攝影機推測。',
    fault: '訊號遺失 → 第二階段維持鎖定並通知班長，紀錄歸在自動化錯誤。',
  },
  {
    key: 'key', n: 7, title: '班長鑰匙開關（降級模式）', tag: '鑰匙開關', principles: [3],
    what: '故障時由班長轉鑰匙切換，承盤連鎖暫停、回到現行作業方式，全程記錄 BYPASS 事件。',
    why: '妥善率：系統故障不會變成停線的理由，也清楚由誰負責切換。',
    fault: '鑰匙由班長保管；降級期間手臂螢幕持續顯示「降級模式」。',
  },
  {
    key: 'screen', n: 8, title: '手臂螢幕', tag: '手臂螢幕', principles: [1, 3],
    what: '小螢幕裝在平衡器外管下端，跟著工具移動、面向師傅：大字顯示目前步驟、這一側每顆螺絲的狀態，錯誤時整面變色並寫出怎麼修正。',
    why: '師傅低頭看工具時螢幕就在同一個視線裡，不用另外看站旁；錯了當場看得到是哪一顆、要怎麼處置。',
    fault: '裝在手臂外管上、不在工具本體，選用工業級防震螢幕。螢幕故障不影響連鎖，語音與握把燈仍會提示。業主曾否決「在鎖附機器上加裝裝置」，裝在外管上是否可接受需再確認。',
  },
];

const BASE_PARTS = {
  trolley: { title: '軌道台車', rows: [['作用', '沿上方工具軌道前後移動，讓工具跟著車位'], ['來源', '沿用工廠原有軌道與吊點']] },
  arm: { title: '水平臂（兩節）', rows: [['作用', '水平方向的兩個旋轉關節，讓工具到達兩側鎖附區域'], ['長度', `${P.link1.v} m ＋ ${P.link2.v} m（假設）`]] },
  balancer: { title: '平衡器', rows: [['作用', '抵銷工具重量，師傅只需輕推即可上下'], ['來源', '工廠原有平衡器']] },
};

const NUM = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
const LIGHT = { green: 0x3ccf6b, yellow: 0xf0b545, red: 0xe0303a, blue: 0x4ea8ff, off: 0x1e232c };

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.35, ...o });

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const box = (w, h, d, m, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), m, x, y, z);
const cyl = (r, h, m, x, y, z, segs = 24) => mesh(new THREE.CylinderGeometry(r, r, h, segs), m, x, y, z);

function partInfo(key) {
  const p = ARM_PARTS.find((x) => x.key === key);
  if (p) {
    return {
      key, id: `arm-${key}`, n: p.n, title: `${NUM[p.n]} ${p.title}`, principles: p.principles,
      rows: [['作用', p.what], ['為何這樣設計', p.why], ['故障時', p.fault]],
    };
  }
  const b = BASE_PARTS[key];
  return { key, id: `arm-${key}`, title: b.title, rows: b.rows, principles: [] };
}

// legacy: true 時畫出現行手臂（沒有控制器、編碼器、LED 環與扭力感測），給「現行 vs IoT」對比用。
export function createSmartArm({ side = 'L', labels = true, mount = true, legacy = false } = {}) {
  if (legacy) labels = false;
  const s = side === 'L' ? 1 : -1; // 外側（高台方向）的 x 符號
  const L1 = P.link1.v;
  const L2 = P.link2.v;
  const drop = P.columnDrop.v;
  const tube = P.tubeLength.v;
  const toolLen = P.toolLength.v;
  const wristY = -drop - 0.055;

  const M = {
    yellow: mat(0xf2c230, { roughness: 0.5, metalness: 0.2 }),
    arm: mat(0x3a4354, { roughness: 0.5, metalness: 0.5 }),
    steel: mat(0x7d8696, { metalness: 0.7, roughness: 0.35 }),
    chrome: mat(0xc9d1dc, { metalness: 0.9, roughness: 0.2 }),
    dark: mat(0x1d2128, { metalness: 0.4, roughness: 0.5 }),
    body: mat(0x2a2f38, { metalness: 0.3, roughness: 0.45 }),
    sensor: mat(0x3dd6d0, { emissive: 0x3dd6d0, emissiveIntensity: 0.25, metalness: 0.4, roughness: 0.4 }),
    encoder: mat(0x3dd6d0, { emissive: 0x3dd6d0, emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.4 }),
    cabinet: mat(0x4a5366, { roughness: 0.6, metalness: 0.3 }),
    grille: mat(0x0e1116, { roughness: 0.9, metalness: 0.1 }),
    trigger: mat(0xd2552c, { roughness: 0.5 }),
    ring: mat(LIGHT.off, { emissive: LIGHT.off, emissiveIntensity: 0, roughness: 0.3, metalness: 0.1 }),
  };
  const lampMats = ['red', 'yellow', 'green'].map((c) => mat(LIGHT[c], {
    emissive: LIGHT[c], emissiveIntensity: 0.04, transparent: true, opacity: 0.9, roughness: 0.3, metalness: 0,
  }));

  const root = new THREE.Group();
  root.name = `smart-arm-${side}`;
  if (mount) root.position.fromArray(armMount(side));

  const pickables = [];
  const byKey = {};
  const tags = [];
  const encoders = [];
  function tagPart(obj, key) {
    const info = partInfo(key);
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.userData.info = info;
      pickables.push(o);
      (byKey[key] ||= []).push(o);
    });
    return obj;
  }
  function addTag(parent, text, cls, x, y, z) {
    const el = document.createElement('div');
    el.className = `tag ${cls}`;
    el.textContent = text;
    const t = new CSS2DObject(el);
    t.center.set(0.5, 1);
    t.position.set(x, y, z);
    parent.add(t);
    tags.push(t);
    return el;
  }
  const numTag = (parent, key, x, y, z) => {
    if (!labels) return;
    const p = ARM_PARTS.find((a) => a.key === key);
    const el = addTag(parent, `${NUM[p.n]} ${p.tag}`, 'tag-num', x, y, z);
    if (key === 'encoder') el.classList.add('tag-encoder');
  };

  // ── 台車 ─────────────────────────────────
  const trolley = new THREE.Group();
  root.add(trolley);
  const carriage = new THREE.Group();
  carriage.add(box(0.15, 0.07, 0.28, M.yellow, 0, -0.06, 0));
  for (const dz of [-0.09, 0.09]) {
    const w = cyl(0.025, 0.17, M.dark, 0, -0.02, dz, 14);
    w.rotation.z = Math.PI / 2;
    carriage.add(w);
  }
  carriage.add(cyl(0.035, drop - 0.08, M.steel, 0, -(0.09 + (drop - 0.08) / 2) + 0.02, 0));
  trolley.add(tagPart(carriage, 'trolley'));
  // 台車位置編碼器
  const encT = box(0.04, 0.05, 0.08, M.encoder, s * 0.095, -0.06, 0.06);
  trolley.add(tagPart(encT, 'encoder'));
  encoders.push(encT);

  // ── 兩節水平臂 ───────────────────────────
  const j1 = new THREE.Group();
  j1.position.y = -drop;
  trolley.add(j1);
  const hub1 = cyl(0.06, 0.08, M.steel, 0, 0, 0);
  const link1 = box(L1, 0.05, 0.075, M.arm, L1 / 2, 0, 0);
  const cap1 = cyl(0.045, 0.012, M.yellow, L1, 0.031, 0);
  j1.add(tagPart(new THREE.Group().add(hub1, link1, cap1), 'arm'));
  const enc1 = new THREE.Mesh(new THREE.TorusGeometry(0.066, 0.011, 10, 32), M.encoder);
  enc1.rotation.x = Math.PI / 2;
  enc1.position.y = 0.045;
  j1.add(tagPart(enc1, 'encoder'));
  encoders.push(enc1);

  const j2 = new THREE.Group();
  j2.position.set(L1, -0.055, 0);
  j1.add(j2);
  const hub2 = cyl(0.05, 0.06, M.steel, 0, 0, 0);
  const link2 = box(L2, 0.045, 0.07, M.arm, L2 / 2, 0, 0);
  j2.add(tagPart(new THREE.Group().add(hub2, link2), 'arm'));
  const enc2 = new THREE.Mesh(new THREE.TorusGeometry(0.056, 0.01, 10, 32), M.encoder);
  enc2.rotation.x = Math.PI / 2;
  enc2.position.y = -0.036;
  j2.add(tagPart(enc2, 'encoder'));
  encoders.push(enc2);
  numTag(j2, 'encoder', 0, 0.09, 0);

  // ── 平衡器與工具（腕部保持與世界座標同向）──
  const wrist = new THREE.Group();
  wrist.position.x = L2;
  j2.add(wrist);
  const balancer = new THREE.Group();
  balancer.add(cyl(0.045, 0.06, M.steel, 0, -0.01, 0));
  balancer.add(cyl(0.038, tube, M.steel, 0, -0.03 - tube / 2, 0));
  const rod = cyl(0.02, 1, M.chrome, 0, 0, 0, 16);
  balancer.add(rod);
  wrist.add(tagPart(balancer, 'balancer'));
  const encZ = box(0.012, tube * 0.8, 0.02, M.encoder, s * 0.04, -0.03 - tube / 2, 0);
  wrist.add(tagPart(encZ, 'encoder'));
  encoders.push(encZ);

  // 手臂螢幕：外管下端的支架，面向外側（師傅站的那一邊），略往上仰
  const scr = { canvas: null, ctx: null, tex: null, key: '' };
  const display = new THREE.Group();
  display.position.set(s * 0.06, -0.03 - tube + 0.07, 0);
  display.rotation.y = s * Math.PI / 2;
  display.rotateX(-0.32);
  if (!legacy) {
    scr.canvas = document.createElement('canvas');
    scr.canvas.width = 480;
    scr.canvas.height = 320;
    scr.ctx = scr.canvas.getContext('2d');
    scr.tex = new THREE.CanvasTexture(scr.canvas);
    scr.tex.colorSpace = THREE.SRGBColorSpace;
    scr.tex.anisotropy = 4;
    const scrParts = new THREE.Group();
    scrParts.add(box(0.26, 0.18, 0.02, M.dark, 0, 0, 0.005));
    scrParts.add(box(0.05, 0.04, 0.06, M.steel, 0, 0, -0.03));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.16), new THREE.MeshBasicMaterial({ map: scr.tex, toneMapped: false }));
    face.position.z = 0.0155;
    scrParts.add(face);
    display.add(tagPart(scrParts, 'screen'));
    wrist.add(display);
  }

  const tool = new THREE.Group(); // 原點 = 套筒尖端
  wrist.add(tool);
  const spinner = new THREE.Group();
  spinner.add(cyl(0.02, 0.05, M.chrome, 0, 0.025, 0, 6));
  spinner.add(cyl(0.012, 0.03, M.steel, 0, 0.065, 0, 12));
  tool.add(spinner);
  const toolBody = new THREE.Group();
  toolBody.add(cyl(0.032, 0.07, M.dark, 0, 0.115, 0));
  toolBody.add(cyl(0.036, 0.17, M.body, 0, 0.275, 0));
  toolBody.add(cyl(0.031, 0.02, M.yellow, 0, 0.35, 0));
  // 側握把（朝外側，師傅站的那一邊）
  toolBody.add(box(0.12, 0.024, 0.026, M.body, s * 0.09, 0.3, 0));
  toolBody.add(box(0.026, 0.13, 0.032, M.body, s * 0.15, 0.25, 0));
  toolBody.add(box(0.012, 0.03, 0.016, M.trigger, s * 0.133, 0.27, 0));
  tool.add(tagPart(toolBody, 'enable'));
  const transducer = cyl(0.039, 0.03, M.sensor, 0, 0.165, 0);
  tool.add(tagPart(transducer, 'torque'));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.009, 10, 32), M.ring);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.198;
  tool.add(tagPart(ring, 'ring'));
  const toolTag = addTag(tool, `工具 ${side}`, 'tag-tool', 0, toolLen + 0.08, 0);
  numTag(display, 'screen', 0, 0.12, 0);
  numTag(tool, 'torque', -s * 0.11, 0.17, 0);
  numTag(tool, 'ring', -s * 0.11, 0.245, 0);

  // ── 控制器（固定在軌道吊架，不跟工具移動）──
  const ctrl = new THREE.Group();
  ctrl.position.set(s * 0.17, 0, -0.25); // 師傅身後，不擋視線
  root.add(ctrl);
  const cabY = -0.62;
  const cab = new THREE.Group();
  cab.add(cyl(0.014, 0.44, M.steel, 0, -0.22, 0, 10));
  cab.add(box(0.28, 0.36, 0.14, M.cabinet, 0, cabY, 0));
  cab.add(box(0.2, 0.08, 0.004, M.grille, 0, cabY + 0.09, -0.071));
  tagPart(cab, 'enable');
  ctrl.add(cab);
  const speaker = cyl(0.05, 0.012, M.grille, -0.06, cabY - 0.07, -0.074);
  speaker.rotation.x = Math.PI / 2;
  const lamps = new THREE.Group();
  lampMats.forEach((m, i) => lamps.add(cyl(0.032, 0.06, m, 0.09, cabY + 0.21 + (2 - i) * 0.062, 0, 20)));
  lamps.add(cyl(0.012, 0.03, M.steel, 0.09, cabY + 0.19, 0, 10));
  ctrl.add(tagPart(new THREE.Group().add(speaker, lamps), 'controller'));
  const keySw = cyl(0.018, 0.02, M.yellow, 0.08, cabY - 0.08, -0.078, 16);
  keySw.rotation.x = Math.PI / 2;
  ctrl.add(tagPart(keySw, 'key'));
  const io = new THREE.Group();
  io.add(box(0.05, 0.08, 0.06, M.dark, -s * 0.165, cabY - 0.05, 0));
  io.add(cyl(0.008, 0.62, M.dark, -s * 0.18, cabY + 0.26, 0, 8));
  ctrl.add(tagPart(io, 'plc'));
  numTag(ctrl, 'enable', -0.02, cabY + 0.02, -0.08);
  numTag(ctrl, 'controller', 0.09, cabY + 0.42, 0);
  numTag(ctrl, 'plc', -s * 0.2, cabY - 0.1, 0);
  numTag(ctrl, 'key', 0.1, cabY - 0.12, -0.08);

  // ── 逆向運動學 ───────────────────────────
  const REST = new THREE.Vector3(-s * 0.2, -1.44, 1.15);
  const goal = REST.clone();
  const cur = REST.clone();
  let elbow = 1;
  const tipMax = wristY - 0.03 - tube - toolLen - 0.03;

  function solve() {
    const z0 = P.railZMin.v - root.position.z;
    const z1 = P.railZMax.v - root.position.z;
    const tz = THREE.MathUtils.clamp(cur.z - P.trolleyLead.v, z0, z1);
    trolley.position.z = tz;
    // rotation.y = θ 會把 +X 轉到 (cosθ, 0, −sinθ)，所以在 (x, −z) 平面解兩節臂
    let u = cur.x;
    let w = -(cur.z - tz);
    let d = Math.hypot(u, w);
    const dMin = Math.abs(L1 - L2) + 0.02;
    const dMax = L1 + L2 - 0.02;
    const k = d < 1e-6 ? 1 : THREE.MathUtils.clamp(d, dMin, dMax) / d;
    u *= k; w *= k; d = Math.hypot(u, w);
    const c2 = THREE.MathUtils.clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1);
    // 手肘朝外側（高台上方），避免伸進引擎室
    let best = null;
    for (const sign of [1, -1]) {
      const t2 = sign * Math.acos(c2);
      const t1 = Math.atan2(w, u) - Math.atan2(L2 * Math.sin(t2), L1 + L2 * Math.cos(t2));
      const score = s * L1 * Math.cos(t1) + (sign === elbow ? 0.02 : 0);
      if (!best || score > best.score) best = { t1, t2, sign, score };
    }
    elbow = best.sign;
    j1.rotation.y = best.t1;
    j2.rotation.y = best.t2;
    wrist.rotation.y = -(best.t1 + best.t2);
    const tipY = THREE.MathUtils.clamp(cur.y, -2.6, tipMax);
    tool.position.y = tipY - wristY + (running ? -0.012 : 0);
    const top = -0.03 - tube;
    const bottom = tool.position.y + toolLen;
    rod.scale.y = Math.max(top - bottom, 0.01);
    rod.position.y = (top + bottom) / 2;
  }

  // ── 狀態與燈號 ───────────────────────────
  let sig = { ring: 'off', ringBlink: false, stack: { red: 'off', yellow: 'off', green: 'off' }, label: '待機' };
  let running = false;
  let tone = '';

  function setState(state) {
    if (legacy) {
      running = state.tool === 'RUNNING';
      toolTag.textContent = `現行工具 ${side}・${running ? '鎖附中' : '隨時可轉'}`;
      return;
    }
    sig = signalsFor(state);
    running = state.tool === 'RUNNING';
    drawScreen(state, sig);
    const next = sig.ring === 'red' ? 'tag-red' : sig.ring === 'yellow' ? 'tag-yellow' : sig.ring === 'green' || sig.ring === 'blue' ? 'tag-green' : '';
    if (next !== tone) {
      if (tone) toolTag.classList.remove(tone);
      if (next) toolTag.classList.add(next);
      tone = next;
    }
    toolTag.textContent = `工具 ${side}・${sig.label}`;
  }

  // 螢幕內容：步驟、工具狀態、這一側每顆螺絲、警示與處置
  const TONE = { orange: '#ff8a3d', yellow: '#f0b545', teal: '#3dd6d0', green: '#3ccf6b', muted: '#5d6a80' };
  const RING = { green: '#3ccf6b', yellow: '#f0b545', red: '#e0303a', blue: '#4ea8ff', off: '#5d6a80' };
  const FIX = {
    EARLY_ATTEMPT: '放開扳機，等承盤降下',
    SEQUENCE_ERROR: '先鎖亮白框的那一顆',
    TIGHTEN_NG: '原地重鎖這一顆',
    TIMEOUT: '盡快補完剩下的螺絲',
    PHASE_WARNING: '加快完成這一階段',
    AUTOMATION_FAULT: '不用處理，等班長復歸承盤',
    TOOL_FAULT: '停止作業，通知班長',
  };
  function drawScreen(state, sigNow) {
    if (!scr.ctx) return;
    const d = describe(state);
    const a = state.alarm;
    const key = JSON.stringify([d, a?.type, a?.text, sigNow.label, state.bolts, state.expected, state.remaining == null ? null : Math.ceil(state.remaining)]);
    if (key === scr.key) return;
    scr.key = key;
    const c = scr.ctx;
    const W = scr.canvas.width;
    const H = scr.canvas.height;
    const bad = a && (a.level === 'alarm' || a.level === 'fault');
    const warn = a && a.level === 'warn';
    c.fillStyle = bad ? '#5c0d13' : warn ? '#4a3606' : '#070b11';
    c.fillRect(0, 0, W, H);
    const font = (px, w = 700) => `${w} ${px}px -apple-system, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif`;
    // 步驟
    c.fillStyle = TONE[d.tone];
    c.fillRect(16, 16, 96, 96);
    c.fillStyle = '#0a0e14';
    c.font = font(70, 800);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(d.step, 64, 68);
    c.textAlign = 'left';
    c.fillStyle = '#ffffff';
    c.font = font(40);
    c.fillText(d.title, 128, 46);
    c.fillStyle = RING[sigNow.ring];
    c.font = font(28, 600);
    c.fillText(`工具${sigNow.label}`, 128, 92);
    if (state.remaining != null) {
      c.textAlign = 'right';
      c.fillStyle = state.timedOut ? '#ff6b73' : state.remaining <= P.phaseWarnLead.v ? '#f0b545' : '#8b98ad';
      c.fillText(state.timedOut ? '超時' : `${Math.ceil(state.remaining)}s`, W - 18, 46);
      c.textAlign = 'left';
    }
    // 螺絲
    let y = 150;
    c.font = font(26, 500);
    for (const id of SEQUENCE[side]) {
      const z = zoneById(id);
      const cur = state.expected?.zoneId === id;
      c.fillStyle = cur ? '#ffffff' : '#9aa6b8';
      c.fillText(`${z.phase} ${z.label}`, 18, y);
      state.bolts[id].forEach((b, i) => {
        const x = W - 30 - (state.bolts[id].length - 1 - i) * 34;
        c.beginPath();
        c.arc(x, y, 12, 0, Math.PI * 2);
        c.fillStyle = b === 'OK' ? '#3ccf6b' : b === 'NG' ? '#e0303a' : '#2a3448';
        c.fill();
        if (cur && state.expected.boltIndex === i && (state.phase === 'A' || state.phase === 'C')) {
          c.lineWidth = 4;
          c.strokeStyle = '#ffffff';
          c.stroke();
        }
      });
      y += 40;
    }
    // 警示與處置
    if (a && a.level !== 'info') {
      const by = H - 76;
      c.fillStyle = bad ? '#e0303a' : '#f0b545';
      c.fillRect(0, by, W, 76);
      c.fillStyle = bad ? '#ffffff' : '#1a1407';
      c.font = font(28);
      c.fillText(a.text.length > 15 ? `${a.text.slice(0, 15)}…` : a.text, 16, by + 25);
      c.font = font(24, 500);
      c.fillText(`→ ${FIX[a.type] ?? '依提示處置'}`, 16, by + 58);
    }
    scr.tex.needsUpdate = true;
  }

  function applyLights(time) {
    if (legacy) return;
    const blinkOn = time % 0.8 < 0.45;
    const rc = LIGHT[sig.ring];
    const ringOn = sig.ring !== 'off' && (!sig.ringBlink || blinkOn);
    M.ring.color.setHex(sig.ring === 'off' ? LIGHT.off : rc);
    M.ring.emissive.setHex(rc);
    M.ring.emissiveIntensity = ringOn ? 1.6 : 0.05;
    ['red', 'yellow', 'green'].forEach((c, i) => {
      const v = sig.stack[c];
      lampMats[i].emissiveIntensity = v === 'on' || (v === 'blink' && blinkOn) ? 1.5 : 0.04;
    });
  }

  function update(dt, time = performance.now() / 1000) {
    const k = 1 - Math.exp(-dt * 5);
    cur.lerp(goal, k);
    solve();
    if (running) spinner.rotation.y += dt * 40;
    applyLights(time);
  }

  function setToolTarget(v, { instant = false } = {}) {
    root.updateWorldMatrix(true, false);
    goal.copy(root.worldToLocal(v.clone()));
    if (instant) { cur.copy(goal); solve(); }
  }
  function setToolRest({ instant = false } = {}) {
    goal.copy(REST);
    if (instant) { cur.copy(goal); solve(); }
  }
  function getToolTip(target = new THREE.Vector3()) {
    return tool.getWorldPosition(target);
  }

  function setEncoderEnabled(on) {
    encoders.forEach((m) => (m.visible = on));
    tags.forEach((t) => t.element.classList.contains('tag-encoder') && (t.visible = on));
  }
  function setLabelsVisible(on) {
    tags.forEach((t) => {
      if (t.element.classList.contains('tag-num')) t.visible = on && (!t.element.classList.contains('tag-encoder') || encoders[0].visible);
    });
  }

  // 點選高亮：暫時換成發光材質
  const saved = new Map();
  function highlight(key) {
    for (const [m, original] of saved) m.material = original;
    saved.clear();
    for (const m of byKey[key] || []) {
      if (m.material === M.ring || lampMats.includes(m.material)) continue; // 燈號材質要持續更新
      saved.set(m, m.material);
      const h = m.material.clone();
      h.emissive = new THREE.Color(0xf2c230);
      h.emissiveIntensity = 0.55;
      m.material = h;
    }
  }

  // 握把、工具頂端、控制器燈號的世界座標（給師傅模型伸手與轉頭用）
  const getGrip = (t = new THREE.Vector3()) => tool.localToWorld(t.set(s * 0.15, 0.25, 0));
  const getToolTop = (t = new THREE.Vector3()) => tool.localToWorld(t.set(0, 0.33, 0));
  const getControllerPos = (t = new THREE.Vector3()) => ctrl.localToWorld(t.set(0.09, cabY + 0.27, 0));

  if (legacy) {
    for (const m of encoders) m.removeFromParent();
    ctrl.removeFromParent();
    ring.visible = false;
    transducer.material = M.body;
    const info = { key: 'legacy', id: 'arm-legacy', title: '現行鎖附工具', principles: [],
      rows: [['現況', '工具隨時都能轉，不知道承盤有沒有降下來'], ['回饋', '沒有燈號、語音，也不回報扭力與角度'], ['紀錄', '沒有每顆螺絲的履歷']] };
    pickables.length = 0;
    tool.traverse((o) => { if (o.isMesh) { o.userData.info = info; pickables.push(o); } });
  }

  solve();
  return Object.assign(root, {
    side, legacy, pickables, tags,
    setState, setToolTarget, setToolRest, getToolTip, getGrip, getToolTop, getControllerPos, update,
    setEncoderEnabled, setLabelsVisible, highlight,
  });
}
