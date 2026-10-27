// 複製自 powerarena-station-twin（commit 555ceb8）js/scene.js，未修改；場域模型更新時整份重新複製即可。
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { P, CAMERAS, ZONES, RAIL_LIMITS, PHASE_COLOR, derive, cameraPose } from './params.js';

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.1, ...opts });

const M = {
  platform: mat(0x2f3a52),
  platformTop: mat(0x3d4a66, { roughness: 0.6 }),
  rail: mat(0xf2c230, { roughness: 0.5 }),
  body: mat(0x4d6680, { roughness: 0.45, metalness: 0.35 }),
  glass: mat(0x1a2433, { roughness: 0.2, metalness: 0.5 }),
  dark: mat(0x1b1f27),
  engine: mat(0x8a929e, { roughness: 0.5, metalness: 0.6 }),
  trans: mat(0x6f7884, { roughness: 0.5, metalness: 0.6 }),
  tire: mat(0x15171c, { roughness: 0.9 }),
  tray: mat(0xd2552c, { roughness: 0.6 }),
  steel: mat(0x6b7280, { metalness: 0.6, roughness: 0.4 }),
  table: mat(0xe9edf2, { roughness: 0.7 }),
  bin: mat(0x2459c7, { roughness: 0.6 }),
  worker: mat(0x7b8aa6),
  workerDark: mat(0x3b4459),
  hat: mat(0xf2c230, { roughness: 0.4 }),
  skin: mat(0xd7b49a),
  tool: mat(0x22252b, { metalness: 0.4, roughness: 0.5 }),
  toolBand: mat(0xf2c230),
  floor: mat(0x0d1118, { roughness: 1 }),
};

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// 以 min/max 指定範圍建立方塊，比較直觀對應實際尺寸
function span(x0, x1, y0, y1, z0, z1, material) {
  return box(x1 - x0, y1 - y0, z1 - z0, material, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

function cyl(r, h, material, segs = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segs), material);
  m.castShadow = true;
  return m;
}

// 讓沿 Y 軸的細圓柱連接 a、b 兩點（纜線、欄杆斜撐用）
const _up = new THREE.Vector3(0, 1, 0);
export function stretch(mesh, a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.scale.set(1, Math.max(len, 1e-4), 1);
  mesh.quaternion.setFromUnitVectors(_up, dir.normalize());
}

export function makeTag(text, cls = '') {
  const el = document.createElement('div');
  el.className = `tag ${cls}`;
  el.textContent = text;
  const obj = new CSS2DObject(el);
  obj.center.set(0.5, 1);
  return obj;
}

function setInfo(obj, info) {
  obj.traverse((o) => { if (o.isMesh) o.userData.info = info; });
}

export function buildStation(scene) {
  const d = derive();
  const { H, halfGap, halfBay, tireBottom, bayRim, front, bayZ, trayTop } = d;
  const W = P.platformWidth.v;
  const z0 = -5, z1 = z0 + P.platformLength.v;
  const handles = { d, cameras: [], zones: [], tools: {}, operators: {}, layers: {} };

  const layer = (name) => {
    const g = new THREE.Group();
    g.name = name;
    scene.add(g);
    handles.layers[name] = g;
    return g;
  };
  const env = layer('environment');
  const vehicleLayer = layer('vehicle');
  const peopleLayer = layer('people');
  const frustumLayer = layer('frustums');
  const zoneLayer = layer('zones');
  const railLayer = layer('rail');
  const dimLayer = layer('dims');

  // ── 地面與坑道 ───────────────────────────
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), M.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  env.add(floor);
  const grid = new THREE.GridHelper(60, 120, 0x1d3a4f, 0x142230);
  grid.position.y = 0.002;
  env.add(grid);

  const dash = new THREE.MeshBasicMaterial({ color: 0xc9a227 });
  for (let z = -14; z < 14; z += 1.2) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.6), dash);
    s.rotation.x = -Math.PI / 2;
    s.position.set(0, 0.004, z);
    env.add(s);
  }
  // 前方暫存區（staging area）框線
  const staging = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(3.6, 2.2)),
    new THREE.LineDashedMaterial({ color: 0xc9a227, dashSize: 0.25, gapSize: 0.15 })
  );
  staging.computeLineDistances();
  staging.rotation.x = -Math.PI / 2;
  staging.position.set(0, 0.006, z1 + 1.6);
  env.add(staging);

  // ── 兩側作業高台 ───────────────────────────
  for (const side of [1, -1]) {
    const g = new THREE.Group();
    const xin = side * halfGap, xout = side * (halfGap + W);
    const [xa, xb] = side > 0 ? [xin, xout] : [xout, xin];
    g.add(span(xa, xb, 0, H - 0.02, z0, z1, M.platform));
    g.add(span(xa, xb, H - 0.02, H, z0, z1, M.platformTop));
    // 內緣黃黑警示條：人與懸吊工具都緊貼這條邊界
    const strip = span(Math.min(xin, xin + side * 0.06), Math.max(xin, xin + side * 0.06), H, H + 0.004, z0, z1,
      new THREE.MeshBasicMaterial({ color: 0xf2c230 }));
    strip.castShadow = false;
    g.add(strip);
    // 外側欄杆
    const xr = xout - side * 0.04;
    for (let z = z0 + 0.1; z <= z1; z += 1.3) g.add(box(0.04, 1.05, 0.04, M.rail, xr, H + 0.525, z));
    g.add(span(xr - 0.02, xr + 0.02, H + 1.03, H + 1.07, z0 + 0.1, z1 - 0.1, M.rail));
    g.add(span(xr - 0.015, xr + 0.015, H + 0.52, H + 0.55, z0 + 0.1, z1 - 0.1, M.rail));
    // 後端樓梯
    for (let i = 0; i < 7; i++) {
      const h = H - (i + 1) * (H / 8);
      g.add(span(xa, xb, 0, h, z0 - 0.28 * (i + 1), z0 - 0.28 * i, M.platform));
    }
    setInfo(g, {
      title: side > 0 ? '作業高台（左）' : '作業高台（右）',
      id: side > 0 ? 'ent-platL' : 'ent-platR',
      rows: [['高台面高度', `${H} m（已確認）`], ['兩側間距', `${P.platformGap.v} m（已確認）`],
        ['寬度', `${W} m（假設，僅一人可側向通行）`]],
    });
    env.add(g);
    const tag = makeTag(side > 0 ? '作業高台 L' : '作業高台 R', 'tag-muted');
    tag.position.set((xin + xout) / 2, H + 0.05, z0 + 1.2);
    env.add(tag);
  }

  // ── 前方門型吊架（掛 LEFT UP / RIGHT UP） ─────────
  const gantryZ = 3.55, gantryY = H + 2.62;
  const gantry = new THREE.Group();
  // 立柱靠外側欄杆，避免緊貼攝影機擋住視野
  const postX = halfGap + W - 0.15;
  for (const s of [1, -1]) gantry.add(box(0.12, gantryY - H, 0.12, M.rail, s * postX, (gantryY + H) / 2, gantryZ));
  gantry.add(box(2 * postX + 0.12, 0.14, 0.14, M.rail, 0, gantryY, gantryZ));
  // 兩側懸吊工具軌道
  for (const s of [1, -1]) {
    gantry.add(span(s * (halfGap + 0.08) - 0.05, s * (halfGap + 0.08) + 0.05, gantryY - 0.04, gantryY + 0.06, -0.8, gantryZ, M.steel));
    gantry.add(box(0.08, gantryY - H, 0.08, M.rail, s * (halfGap + 0.2), (gantryY + H) / 2, -0.8));
    gantry.add(span(s * (halfGap + 0.08) - 0.05, s * (halfGap + 0.2) + 0.05, gantryY - 0.04, gantryY + 0.04, -0.85, -0.75, M.rail));
  }
  setInfo(gantry, { title: '門型吊架與工具軌道', id: 'ent-gantry', rows: [['用途', '吊掛上方攝影機與懸吊鎖附工具'], ['尺寸', '假設值']] });
  env.add(gantry);

  // ── 車輛 ──────────────────────────────────
  const car = new THREE.Group();
  const bodyBottom = tireBottom + 0.3;
  const back = -front;
  const bayBack = bayZ - 0.55;
  car.add(span(-halfBay, halfBay, bodyBottom, bayRim, back, bayBack, M.body));
  car.add(span(-halfBay + 0.12, halfBay - 0.12, bayRim, bayRim + 0.62, back + 0.55, bayBack - 0.25, M.glass));
  car.add(span(-halfBay + 0.16, halfBay - 0.16, bayRim + 0.6, bayRim + 0.66, back + 0.7, bayBack - 0.45, M.body));
  for (const s of [1, -1]) {
    car.add(span(s > 0 ? halfBay - 0.1 : -halfBay, s > 0 ? halfBay : -halfBay + 0.1, bodyBottom, bayRim, bayBack, front - 0.1, M.body));
    // 尾燈
    car.add(span(s * (halfBay - 0.35) - 0.2, s * (halfBay - 0.35) + 0.2, bayRim - 0.2, bayRim - 0.1, back - 0.01, back + 0.02,
      new THREE.MeshBasicMaterial({ color: 0xe0303a })));
  }
  car.add(span(-halfBay, halfBay, bodyBottom, bayRim - 0.12, front - 0.12, front, M.body));
  // 散熱器：外框＋鰭片，是從前方攝影機看引擎室最明顯的地標
  const radiator = new THREE.Group();
  const rx0 = -0.5, rx1 = 0.5, ry0 = bodyBottom + 0.05, ry1 = bayRim - 0.04, rz0 = front - 0.3, rz1 = front - 0.14;
  radiator.add(span(rx0, rx1, ry0, ry1, rz0, rz1 - 0.04, M.dark));
  for (const [a, b] of [[ry0, ry0 + 0.04], [ry1 - 0.04, ry1]]) radiator.add(span(rx0, rx1, a, b, rz0, rz1, M.steel));
  for (const [a, b] of [[rx0, rx0 + 0.04], [rx1 - 0.04, rx1]]) radiator.add(span(a, b, ry0, ry1, rz0, rz1, M.steel));
  for (let x = rx0 + 0.07; x < rx1 - 0.05; x += 0.045) radiator.add(span(x, x + 0.012, ry0 + 0.04, ry1 - 0.04, rz1 - 0.05, rz1 - 0.02, M.engine));
  setInfo(radiator, { title: '散熱器（水箱）', id: 'ent-radiator', rows: [['用途', '車頭最明顯的地標，用來對照四個螺絲孔位'], ['尺寸', '示意']] });
  car.add(radiator);
  car.add(span(-halfBay + 0.1, halfBay - 0.1, bodyBottom, bayRim, bayBack - 0.04, bayBack, M.body)); // 防火牆
  // 引擎蓋（開啟）
  const hood = new THREE.Group();
  hood.position.set(0, bayRim, bayBack);
  hood.add(box(2 * halfBay - 0.1, 0.03, front - bayBack, M.body, 0, 0, (front - bayBack) / 2));
  hood.rotation.x = -1.2;
  car.add(hood);
  // 車輪：外緣與車身同寬，使單側伸入高台上空 0.1225 m
  const tireR = 0.33, tireW = 0.22;
  for (const s of [1, -1]) for (const z of [P.wheelBase.v / 2 + 0.05, -P.wheelBase.v / 2 + 0.05]) {
    const w = cyl(tireR, tireW, M.tire, 28);
    w.rotation.z = Math.PI / 2;
    w.position.set(s * (halfBay - tireW / 2), tireBottom + tireR, z);
    car.add(w);
  }
  // 引擎與變速箱
  const engine = new THREE.Group();
  engine.add(span(-0.4, 0.34, trayTop, trayTop + 0.62, bayZ - 0.28, bayZ + 0.3, M.engine));
  engine.add(span(-0.32, 0.26, trayTop + 0.62, trayTop + 0.72, bayZ - 0.22, bayZ + 0.22, M.dark));
  engine.add(span(0.34, 0.66, trayTop + 0.12, trayTop + 0.46, bayZ - 0.52, bayZ - 0.12, M.trans));
  setInfo(car, { title: '車輛', id: 'ent-vehicle',
    rows: [['引擎室寬', `${P.bayWidth.v} m（已確認）`], ['單側伸入高台上空', `${P.tireOverlap.v} m（推算）`],
      ['車長', `${P.vehicleLength.v} m（假設）`]] });
  setInfo(engine, { title: '引擎與變速箱', id: 'ent-powertrain',
    rows: [['作業', '步驟 1 鎖左下、右下螺絲；承盤下降後，步驟 3 鎖左上、右上螺絲'], ['尺寸', '示意']] });
  car.add(engine);
  // 螺絲孔位的固定支架：下方兩顆接在引擎側，上方兩顆接在車身內側
  const halfFender = halfBay - 0.1;
  for (const z of ZONES) {
    const [x, y, zz] = z.pos;
    const s = Math.sign(x), yy = H + y;
    const inner = z.phase === 1 ? (s > 0 ? 0.34 : -0.4) : s * halfFender;
    const bracket = span(Math.min(inner, x), Math.max(inner, x), yy - 0.05, yy - 0.01, zz - 0.07, zz + 0.07, M.steel);
    setInfo(bracket, { title: `${z.label}的固定支架`, id: `ent-bracket-${z.id}`, rows: [['位置', '示意，待實測']] });
    car.add(bracket);
  }
  vehicleLayer.add(car);
  // ── 產線滑軌與車體載具 ───────────────────────
  // 車頭先進站、持續往 +Z 前進；載具在坑道內沿滑軌移動，承盤也裝在坑道裡
  const railInfo = { title: '產線滑軌與車體載具', id: 'ent-rail',
    rows: [['車行方向', '車頭先進站，持續往前移動'], ['移動速度', '待確認'],
      ...RAIL_LIMITS.map((r, i) => [`限制 ${i + 1}`, `${r.text}（${r.status === 'confirmed' ? '已確認' : '推算'}）`])] };
  const rail = new THREE.Group();
  for (const s of [1, -1]) rail.add(span(s * 0.38 - 0.035, s * 0.38 + 0.035, 0, 0.09, -16, 16, M.steel));
  for (let z = -15.6; z < 16; z += 0.8) rail.add(span(-0.6, 0.6, 0, 0.03, z - 0.06, z + 0.06, M.workerDark));
  const carrier = new THREE.Group();
  carrier.add(span(-0.48, 0.48, 0.12, 0.22, -2.1, 1.1, M.platform));
  for (const s of [1, -1]) for (const z of [-1.9, 0.9]) {
    const wheel = cyl(0.05, 0.06, M.dark, 16);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(s * 0.38, 0.12, z);
    carrier.add(wheel);
    carrier.add(box(0.1, tireBottom + 0.3 - 0.22, 0.1, M.steel, s * 0.42, (tireBottom + 0.3 + 0.22) / 2, z === 0.9 ? 1.0 : -1.6));
  }
  rail.add(carrier);
  // 地面上的車行方向箭頭
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0xf2c230, transparent: true, opacity: 0.55 });
  const chevron = new THREE.Shape();
  chevron.moveTo(-0.32, 0); chevron.lineTo(0, 0.3); chevron.lineTo(0.32, 0);
  chevron.lineTo(0.32, -0.12); chevron.lineTo(0, 0.18); chevron.lineTo(-0.32, -0.12); chevron.closePath();
  for (const z of [-7.2, -6.6, -6.0]) {
    const a = new THREE.Mesh(new THREE.ShapeGeometry(chevron), arrowMat);
    a.rotation.x = -Math.PI / 2;
    a.position.set(0, 0.012, z);
    rail.add(a);
  }
  setInfo(rail, railInfo);
  railLayer.add(rail);
  const railTag = makeTag('產線滑軌（點我看限制）', 'tag-rail');
  railTag.position.set(0, 0.35, -6.6);
  railLayer.add(railTag);
  const dirTag = makeTag('車行方向 →', 'tag-rail');
  dirTag.position.set(0, 0.05, -5.6);
  railLayer.add(dirTag);

  // ── 承盤（自動升降） ─────────────────────────
  const tray = new THREE.Group();
  tray.add(span(-0.62, 0.62, trayTop - 0.07, trayTop - 0.01, bayZ - 0.85, bayZ + 0.45, M.tray));
  for (const [x, z] of [[-0.3, bayZ + 0.15], [0.3, bayZ + 0.15], [0.5, bayZ - 0.45]]) tray.add(box(0.12, 0.06, 0.12, M.steel, x, trayTop + 0.02, z));
  const column = box(0.22, trayTop + 0.6, 0.22, M.steel, 0, (trayTop - 0.6) / 2 - 0.05, bayZ - 0.2);
  tray.add(column);
  setInfo(tray, { title: '承盤（動力總成托盤）', id: 'ent-tray',
    rows: [['控制', '依節拍自動升降（已確認）'], ['下降距離', '約 0.40–0.50 m（業主估）'], ['下降歷時', '約 4 秒（已確認）'],
      ['異常影響', '承盤故障會全廠停線']] });
  vehicleLayer.add(tray);
  handles.tray = tray;
  const trayTag = makeTag('承盤', 'tag-orange');
  trayTag.position.set(0, trayTop - 0.1, bayZ + 0.5);
  tray.add(trayTag);

  // ── 工具桌、層架、三色燈 ──────────────────────
  const furniture = (side, z, withBins) => {
    const g = new THREE.Group();
    const x = side * (halfGap + W - 0.3);
    g.add(box(0.46, 0.04, 0.8, M.table, x, H + 0.88, z));
    for (const dx of [-0.2, 0.2]) for (const dz of [-0.36, 0.36]) g.add(box(0.03, 0.88, 0.03, M.steel, x + dx, H + 0.44, z + dz));
    g.add(box(0.46, 0.03, 0.8, M.steel, x, H + 0.35, z));
    if (withBins) for (const dz of [-0.2, 0.2]) {
      g.add(box(0.3, 0.14, 0.3, M.bin, x, H + 0.44, z + dz));
      g.add(box(0.3, 0.14, 0.3, M.bin, x, H + 0.97, z + dz));
    }
    setInfo(g, { title: '工具桌／層板', id: `ent-table-${side > 0 ? 'L' : 'R'}`,
      rows: [['位置', '放在高台上，未實測（業主：可模擬）'], ['尺寸', '假設值']] });
    env.add(g);
  };
  furniture(1, -0.4, true);
  furniture(1, -1.5, false);
  furniture(-1, -0.6, true);
  furniture(-1, 3.4, true);

  const stack = new THREE.Group();
  const sx = -(halfGap + W - 0.18), sz = 4.35;
  stack.add(box(0.05, 0.9, 0.05, M.steel, sx, H + 0.45, sz));
  const lampColors = [0xe0303a, 0xf0b545, 0x3ccf6b];
  handles.lamps = lampColors.map((c, i) => {
    const m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.05, transparent: true, opacity: 0.85 });
    const lamp = cyl(0.06, 0.12, m);
    lamp.position.set(sx, H + 1.2 - i * 0.13, sz);
    stack.add(lamp);
    return m;
  });
  setInfo(stack, { title: '三色燈', id: 'ent-andon', rows: [['現況', '已有實體三色燈'], ['階段 2', '串接 MES／IoT，異常時亮燈並蜂鳴']] });
  env.add(stack);

  // ── 作業員 ────────────────────────────────
  const makeOperator = (side) => {
    const h = P.operatorHeight.v;
    const g = new THREE.Group();
    const k = h / 1.75;
    for (const dx of [-0.09, 0.09]) g.add(box(0.12, 0.82 * k, 0.14, M.workerDark, dx, 0.41 * k, 0));
    g.add(box(0.4, 0.6 * k, 0.24, M.worker, 0, 1.12 * k, 0));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.105 * k, 20, 14), M.skin);
    head.position.y = 1.56 * k;
    head.castShadow = true;
    g.add(head);
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.125 * k, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.hat);
    hat.position.y = 1.6 * k;
    g.add(hat);
    const arms = [];
    for (const dx of [-0.24, 0.24]) {
      const pivot = new THREE.Group();
      pivot.position.set(dx, 1.38 * k, 0);
      const arm = box(0.09, 0.09, 0.62 * k, M.worker, 0, 0, 0.31 * k);
      pivot.add(arm);
      g.add(pivot);
      arms.push(pivot);
    }
    g.position.set(side * (halfGap + 0.3), H, bayZ - 0.1);
    g.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    setInfo(g, { title: side > 0 ? '作業員（左側）' : '作業員（右側）', id: side > 0 ? 'ent-opL' : 'ent-opR',
      rows: [['身高', `${h} m（業主建議標準）`], ['站位', '車體與高台交界'], ['作業', '第一階段 → 承盤下降 → 第二階段']] });
    peopleLayer.add(g);
    const tag = makeTag(side > 0 ? '作業員 L' : '作業員 R', 'tag-muted');
    tag.position.set(0, h + 0.12, 0);
    g.add(tag);
    return { group: g, arms };
  };
  handles.operators.L = makeOperator(1);
  handles.operators.R = makeOperator(-1);

  // ── 懸吊鎖附工具 ───────────────────────────
  const makeTool = (side) => {
    const g = new THREE.Group();
    g.add(box(0.07, 0.07, 0.26, M.tool, 0, 0, 0));
    g.add(box(0.075, 0.03, 0.06, M.toolBand, 0, 0, -0.05));
    const grip = box(0.05, 0.16, 0.06, M.tool, 0, -0.1, 0.06);
    g.add(grip);
    const bit = cyl(0.012, 0.08, M.steel, 10);
    bit.rotation.x = Math.PI / 2;
    bit.position.z = -0.17;
    g.add(bit);
    const anchor = new THREE.Vector3(side * (halfGap + 0.08), gantryY - 0.05, 0);
    const balancer = box(0.12, 0.14, 0.12, M.steel, anchor.x, anchor.y - 0.08, 0);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 6), new THREE.MeshBasicMaterial({ color: 0x9aa3b2 }));
    const rest = new THREE.Vector3(side * (halfGap + 0.02), H + 1.25, bayZ - 0.45);
    g.position.copy(rest);
    const info = { title: side > 0 ? '鎖附工具（左）' : '鎖附工具（右）', id: side > 0 ? 'ent-toolL' : 'ent-toolR',
      rows: [['形式', '懸吊式，緊貼高台邊界'], ['偵測重點', 'PoC 以「工具與指定區域重疊」判定步驟'],
        ['階段 2', '輸出鎖附完成與扭力值到 MES']] };
    setInfo(g, info);
    setInfo(balancer, info);
    peopleLayer.add(g, balancer, cable);
    const tag = makeTag(side > 0 ? '工具 L' : '工具 R', 'tag-tool');
    tag.position.set(0, 0.12, 0);
    g.add(tag);
    return { group: g, balancer, cable, rest, anchor };
  };
  handles.tools.L = makeTool(1);
  handles.tools.R = makeTool(-1);

  // ── 螺絲孔位與鎖附區域 ROI ───────────────────────
  for (const z of ZONES) {
    const color = PHASE_COLOR[z.phase];
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false });
    const m = new THREE.Mesh(new THREE.BoxGeometry(...z.size), material);
    m.position.set(z.pos[0], H + z.pos[1], z.pos[2]);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    m.add(edges);
    const info = { title: `步驟 ${z.step}｜${z.label}`, id: z.id,
      rows: [['順序', z.step === 1 ? '步驟 1：承盤撐著時鎖（左下、右下）' : '步驟 3：承盤下降後才能鎖（左上、右上）'],
        ['左右', '以車輛本身為準；由前往後看時，車輛左側在畫面右邊'],
        ['來源', '團隊現場紀錄'], ['孔位座標', '示意，待實測']] };
    m.userData.info = info;
    zoneLayer.add(m);
    // 螺絲頭＋外圈：讓四個孔位在主畫面與攝影機子畫面都看得到
    const bolt = new THREE.Group();
    bolt.position.copy(m.position);
    const ringMat = new THREE.MeshBasicMaterial({ color });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.012, 8, 28), ringMat);
    ring.rotation.x = Math.PI / 2;
    bolt.add(ring);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.03, 6), M.engine);
    head.position.y = 0.005;
    bolt.add(head);
    bolt.traverse((o) => { if (o.isMesh) o.userData.info = info; });
    zoneLayer.add(bolt);
    const tag = makeTag(`${z.step}｜${z.label}`, z.phase === 1 ? 'tag-orange tag-step' : 'tag-teal tag-step');
    tag.position.set(0, z.size[1] / 2 + 0.03, 0);
    m.add(tag);
    handles.zones.push({ cfg: z, mesh: m, material, edges, ring, ringMat, box: new THREE.Box3().setFromObject(m) });
  }

  // ── 三支攝影機 ─────────────────────────────
  const hfov = (P.camFov.v * Math.PI) / 180;
  const aspect = P.camAspect.v;
  const vfov = (2 * Math.atan(Math.tan(hfov / 2) / aspect) * 180) / Math.PI;
  for (const cfg of CAMERAS) {
    const pose = cameraPose(cfg, d);
    const pos = new THREE.Vector3(...pose.position);
    const tgt = new THREE.Vector3(...pose.target);
    const cam = new THREE.PerspectiveCamera(vfov, aspect, 0.05, 40);
    cam.position.copy(pos);
    cam.lookAt(tgt);
    cam.updateMatrixWorld();
    scene.add(cam);

    const hex = `#${cfg.color.toString(16).padStart(6, '0')}`;
    const body = new THREE.Group();
    body.position.copy(pos);
    body.lookAt(tgt);
    body.add(box(0.12, 0.1, 0.2, mat(0xdfe5ee), 0, 0, -0.02));
    const lens = cyl(0.035, 0.06, mat(cfg.color, { emissive: cfg.color, emissiveIntensity: 0.4 }), 16);
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.1;
    body.add(lens);
    const info = { title: `攝影機 ${cfg.name}`, id: `cam-${cfg.id}`, color: hex,
      rows: [[cfg.distance.label, `${cfg.distance.v} m（${cfg.distance.note}）`],
        [cfg.height.label, `${cfg.height.v} m`], ['角度', `${cfg.bearing.v}°（解讀為俯視方位角）`],
        ['推算位置', pos.toArray().map((v) => v.toFixed(2)).join(', ')],
        ['視角', `${P.camFov.v}° 水平（假設）`]] };
    setInfo(body, info);
    env.add(body);
    // 支架
    if (cfg.heightRef === 'bayRim') {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1, 8), M.steel);
      stretch(rod, pos, new THREE.Vector3(pos.x, gantryY, pos.z));
      env.add(rod);
    } else {
      env.add(box(0.04, pos.y - H, 0.04, M.steel, pos.x, (pos.y + H) / 2, pos.z));
    }
    const tag = makeTag(cfg.name, 'tag-cam');
    tag.element.style.setProperty('--c', hex);
    tag.position.copy(pos).add(new THREE.Vector3(0, 0.22, 0));
    env.add(tag);

    // 視錐：延伸到觀測距離再多 0.6 m
    const far = cfg.distance.v + 0.6;
    const hh = Math.tan((vfov * Math.PI) / 360) * far, hw = hh * aspect;
    const corners = [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]].map(([x, y]) => new THREE.Vector3(x, y, -far));
    const verts = [];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      verts.push(0, 0, 0, a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.computeVertexNormals();
    const fr = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
    const lineVerts = [];
    for (const c of corners) lineVerts.push(0, 0, 0, c.x, c.y, c.z);
    for (let i = 0; i < 4; i++) { const a = corners[i], b = corners[(i + 1) % 4]; lineVerts.push(a.x, a.y, a.z, b.x, b.y, b.z); }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3));
    fr.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.55 })));
    // 光軸到目標
    const axis = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -pos.distanceTo(tgt))]);
    fr.add(new THREE.Line(axis, new THREE.LineDashedMaterial({ color: cfg.color, dashSize: 0.08, gapSize: 0.06 })));
    fr.children[1].computeLineDistances();
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: cfg.color }));
    dot.position.z = -pos.distanceTo(tgt);
    fr.add(dot);
    fr.position.copy(pos);
    fr.quaternion.copy(cam.quaternion);
    frustumLayer.add(fr);

    handles.cameras.push({ cfg, cam, body, frustum: fr, pos, tgt, hex, vfov });
  }

  // ── 尺寸標註 ──────────────────────────────
  const dimMat = new THREE.LineBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.9 });
  const dim = (a, b, text, tickDir = new THREE.Vector3(0, 0.06, 0)) => {
    const pts = [a, b, a.clone().add(tickDir), a.clone().sub(tickDir), b.clone().add(tickDir), b.clone().sub(tickDir)];
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    g.setIndex([0, 1, 2, 3, 4, 5]);
    dimLayer.add(new THREE.LineSegments(g, dimMat));
    const t = makeTag(text, 'tag-dim');
    t.center.set(0.5, 0.5);
    t.position.copy(a).add(b).multiplyScalar(0.5);
    dimLayer.add(t);
  };
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  dim(v(-halfGap, H + 0.03, -3.4), v(halfGap, H + 0.03, -3.4), `高台間距 ${P.platformGap.v} m`, v(0, 0, 0.08));
  dim(v(-halfBay, bayRim + 0.08, front + 0.25), v(halfBay, bayRim + 0.08, front + 0.25), `引擎室寬 ${P.bayWidth.v} m`, v(0, 0.06, 0));
  dim(v(halfGap + W + 0.15, 0, z0 + 0.5), v(halfGap + W + 0.15, H, z0 + 0.5), `高台 ${H} m`, v(0.06, 0, 0));
  dim(v(halfGap + 0.02, tireBottom + 0.02, P.wheelBase.v / 2 + 0.05), v(halfBay, tireBottom + 0.02, P.wheelBase.v / 2 + 0.05),
    `重疊 ${P.tireOverlap.v} m`, v(0, 0, 0.06));
  dim(v(-0.95, trayTop, bayZ + 0.55), v(-0.95, trayTop - P.trayDrop.v, bayZ + 0.55), `承盤下降 ≈${P.trayDrop.v} m`, v(0.06, 0, 0));
  dim(v(-halfGap - 0.75, H, bayZ - 0.1), v(-halfGap - 0.75, H + P.operatorHeight.v, bayZ - 0.1), `身高 ${P.operatorHeight.v} m`, v(0, 0, 0.06));

  return handles;
}

// 把物件的世界包圍盒投影到攝影機影像，取得 2D 框（0–1 正規化座標）
const _box = new THREE.Box3();
const _corner = new THREE.Vector3();
export function projectBox(obj, cam) {
  _box.setFromObject(obj);
  if (_box.isEmpty()) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, front = 0;
  for (let i = 0; i < 8; i++) {
    _corner.set(i & 1 ? _box.max.x : _box.min.x, i & 2 ? _box.max.y : _box.min.y, i & 4 ? _box.max.z : _box.min.z);
    _corner.applyMatrix4(cam.matrixWorldInverse);
    if (_corner.z < -cam.near) front++;
    _corner.applyMatrix4(cam.projectionMatrix);
    x0 = Math.min(x0, _corner.x); x1 = Math.max(x1, _corner.x);
    y0 = Math.min(y0, _corner.y); y1 = Math.max(y1, _corner.y);
  }
  if (front < 8) return null;
  const c = (n) => Math.min(Math.max(n, -1), 1);
  if (x1 < -1 || x0 > 1 || y1 < -1 || y0 > 1) return null;
  return { x: (c(x0) + 1) / 2, y: (1 - c(y1)) / 2, w: (c(x1) - c(x0)) / 2, h: (c(y1) - c(y0)) / 2 };
}
