// UI 層：只呼叫 arm-params、arm-logic、arm-model（以及同為 UI 層的 scenarios）。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { P, SRC, ZONES, SEQUENCE, SEQUENCE_STATUS, SPEC, PARAM_GROUPS, zoneById, boltPosition } from './arm-params.js';
import { EVENT_TYPES, CATEGORY, RESULT_LABEL, signalsFor, describe } from './arm-logic.js';
import { createSmartArm, ARM_PARTS, PRINCIPLES } from './arm-model.js';
import { SCENARIOS, scenarioById, createRun, generateHistory } from './scenarios.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(`smart-arm:${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`smart-arm:${k}`, JSON.stringify(v)); } catch { /* 私密模式等情況忽略 */ } },
};
const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const NUM = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦'];
const SIDE_NAME = { L: '左側 L', R: '右側 R' };
const TONE_HEX = { orange: '#ff8a3d', yellow: '#f0b545', teal: '#3dd6d0', green: '#3ccf6b', muted: '#5d6a80' };
const RING_HEX = { green: '#3ccf6b', yellow: '#f0b545', red: '#e0303a', blue: '#4ea8ff', off: '#2a303a' };
const LEVEL_RANK = { info: 0, warn: 1, alarm: 2, fault: 3 };
const pchips = (list) => `<span class="pchips">${list.map((n) => `<span class="pchip p${n}">原則${'一二三'[n - 1]}・${PRINCIPLES[n].short}</span>`).join('')}</span>`;

// ── 3D 場景 ──────────────────────────────────
const viewport = $('#viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'labels';
viewport.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e14);
scene.fog = new THREE.Fog(0x0a0e14, 14, 34);
scene.add(new THREE.HemisphereLight(0xbcd3ff, 0x1a1f28, 0.95));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(5, 11, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
scene.add(sun);
const fill = new THREE.PointLight(0xffe2b0, 14, 8);
fill.position.set(0, 4.2, 2);
scene.add(fill);

const view = new THREE.PerspectiveCamera(42, 1, 0.05, 80);
const controls = new OrbitControls(view, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 0.6;
controls.maxDistance = 16;

const env = buildEnvironment(scene);
const arms = { L: createSmartArm({ side: 'L', labels: true }), R: createSmartArm({ side: 'R', labels: false }) };
scene.add(arms.L, arms.R);
const pickables = [...env.pickables, ...arms.L.pickables, ...arms.R.pickables];

function buildEnvironment(root) {
  const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.1, ...o });
  const M = {
    floor: mat(0x0d1118, { roughness: 1 }),
    platform: mat(0x2f3a52),
    platformTop: mat(0x3d4a66, { roughness: 0.6 }),
    rail: mat(0xf2c230, { roughness: 0.5 }),
    steel: mat(0x6b7280, { metalness: 0.6, roughness: 0.4 }),
    shell: mat(0x4d6680, { roughness: 0.45, metalness: 0.35, transparent: true, opacity: 0.22, depthWrite: false }),
    engine: mat(0x8a929e, { roughness: 0.5, metalness: 0.6 }),
    trans: mat(0x6f7884, { roughness: 0.5, metalness: 0.6 }),
    bracket: mat(0x555d6b, { roughness: 0.5, metalness: 0.6 }),
    tray: mat(0xd2552c, { roughness: 0.6 }),
    worker: mat(0x7b8aa6),
    workerDark: mat(0x3b4459),
    hat: mat(0xf2c230, { roughness: 0.4 }),
    skin: mat(0xd7b49a),
    screenFrame: mat(0x1b1f27),
  };
  const box = (w, h, d, m, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y, z);
    o.castShadow = o.receiveShadow = true;
    return o;
  };
  const span = (x0, x1, y0, y1, z0, z1, m) => box(x1 - x0, y1 - y0, z1 - z0, m, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const out = { pickables: [], bolts: {} };
  const info = (obj, data) => obj.traverse((o) => { if (o.isMesh) { o.userData.info = data; out.pickables.push(o); } });

  const H = P.platformHeight.v;
  const inner = P.platformInnerX.v;
  const W = 0.9;
  const z0 = -2.6;
  const z1 = 4.2;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), M.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);
  const grid = new THREE.GridHelper(40, 80, 0x1a2333, 0x131a26);
  grid.position.y = 0.002;
  root.add(grid);

  for (const s of [1, -1]) {
    const g = new THREE.Group();
    const xa = s * inner;
    const xb = s * (inner + W);
    g.add(span(Math.min(xa, xb), Math.max(xa, xb), 0, H - 0.04, z0, z1, M.platform));
    g.add(span(Math.min(xa, xb), Math.max(xa, xb), H - 0.04, H, z0, z1, M.platformTop));
    const edge = span(Math.min(xa, xa + s * 0.04), Math.max(xa, xa + s * 0.04), H, H + 0.006, z0, z1, M.rail);
    g.add(edge);
    const xr = s * (inner + W - 0.03);
    for (let z = z0 + 0.1; z <= z1; z += 1.35) g.add(box(0.04, 1.05, 0.04, M.rail, xr, H + 0.525, z));
    g.add(span(xr - 0.02, xr + 0.02, H + 1.03, H + 1.07, z0 + 0.1, z1 - 0.1, M.rail));
    info(g, { title: s > 0 ? '作業高台（左）' : '作業高台（右）', id: 'env-platform', rows: [['高台面', `y = ${H} m（已確認）`], ['內緣', `x = ±${inner} m（推算）`], ['現場', '空間狹窄，僅一人可側向通行']] });
    root.add(g);

    // 上方工具軌道與吊架（位置沿用場域模型）
    const rail = new THREE.Group();
    const rx = s * P.railX.v;
    rail.add(span(rx - 0.05, rx + 0.05, P.railY.v + 0.01, P.railY.v + 0.11, -0.9, 3.6, M.rail));
    for (const pz of [-0.85, 3.6]) rail.add(box(0.08, P.railY.v + 0.11 - H, 0.08, M.rail, s * (inner + 0.2), (P.railY.v + 0.11 + H) / 2, pz));
    for (const pz of [-0.85, 3.6]) rail.add(span(Math.min(rx, s * (inner + 0.2)) - 0.04, Math.max(rx, s * (inner + 0.2)) + 0.04, P.railY.v + 0.05, P.railY.v + 0.11, pz - 0.04, pz + 0.04, M.rail));
    info(rail, { title: '上方工具軌道', id: 'env-rail', rows: [['吊點', `x = ±${P.railX.v}、y = ${P.railY.v} m（沿用場域模型）`], ['說明', '手臂原點設在這個吊點，台車沿軌道前後移動']] });
    root.add(rail);
  }
  root.add(span(-(inner + 0.24), inner + 0.24, P.railY.v + 0.05, P.railY.v + 0.12, 3.56, 3.64, M.rail));

  // 車輛（簡化）、引擎、變速箱
  const car = new THREE.Group();
  for (const s of [1, -1]) car.add(span(s * 0.92, s * 0.965, 1.55, 2.37, -2.3, 2.3, M.shell));
  car.add(span(-0.965, 0.965, 1.55, 1.8, 2.22, 2.32, M.shell));
  car.add(span(-0.9, 0.9, 2.37, 2.95, -1.7, 0.55, M.shell));
  info(car, { title: '車輛（簡化）', id: 'env-car', rows: [['引擎室寬', `${P.bayWidth.v} m（已確認）`], ['說明', '只畫出外形，方便看到手臂與鎖附區域']] });
  root.add(car);
  const pt = new THREE.Group();
  pt.add(span(-0.35, 0.35, 1.52, 2.22, 1.45, 2.05, M.engine));
  pt.add(span(0.2, 0.62, 1.55, 2.02, 1.05, 1.48, M.trans));
  for (const s of [1, -1]) pt.add(span(Math.min(s * 0.35, s * 0.66), Math.max(s * 0.35, s * 0.66), 1.94, 2.02, 1.66, 1.9, M.bracket));
  for (const s of [1, -1]) pt.add(span(Math.min(s * 0.62, s * 0.86), Math.max(s * 0.62, s * 0.86), 1.66, 1.72, 1.3, 1.7, M.bracket));
  info(pt, { title: '引擎與變速箱', id: 'env-powertrain', rows: [['說明', '螺絲已預鎖在引擎上，師傅不需要逐顆拿螺絲'], ['問題', '不在拿螺絲，而在「用工具提早鎖」']] });
  root.add(pt);

  // 承盤
  const tray = new THREE.Group();
  tray.add(span(-0.62, 0.62, 1.44, 1.5, 1.15, 2.2, M.tray));
  tray.add(box(0.12, 1.44, 0.12, M.steel, 0, 0.72, 1.68));
  info(tray, { title: '自動升降承盤', id: 'env-tray', rows: [['下降', `${P.trayDrop.v} m、約 ${P.trayDuration.v} 秒（業主估）`], ['訊號', '「開始下降」「下降完成」接到兩側工具控制器'], ['逾時', `${P.trayFaultTimeout.v} 秒沒降到底判自動化錯誤（假設）`]] });
  root.add(tray);
  out.tray = tray;

  // 鎖附區域與螺絲
  const zones = new THREE.Group();
  for (const z of ZONES) {
    const color = z.phase === 'A' ? 0xff8a3d : 0x3dd6d0;
    const geo = new THREE.BoxGeometry(...z.size);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, depthWrite: false }));
    m.position.set(z.pos[0], H + z.pos[1], z.pos[2]);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75 })));
    zones.add(m);
    info(m, { title: `${z.label}（${z.id}）`, id: `zone-${z.id}`, rows: [['階段', z.phase === 'A' ? 'A 第一階段' : 'C 第二階段'], ['螺絲', `${z.bolts} 顆（假設）`], ['規格', `${SPEC[z.id].torque.v} N·m ±${SPEC[z.id].tol.v}%、${SPEC[z.id].angleMin.v}–${SPEC[z.id].angleMax.v}°（假設）`]] });
    out.bolts[z.id] = Array.from({ length: z.bolts }, (_, i) => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.017, 14, 10), new THREE.MeshStandardMaterial({ color: 0x5d6a80, emissive: 0x000000, roughness: 0.4 }));
      b.position.fromArray(boltPosition(z.id, i));
      zones.add(b);
      return b;
    });
  }
  root.add(zones);
  out.zones = zones;

  // 作業員
  for (const s of [1, -1]) {
    const g = new THREE.Group();
    for (const dx of [-0.09, 0.09]) g.add(box(0.12, 0.82, 0.14, M.workerDark, dx, 0.41, 0));
    g.add(box(0.4, 0.6, 0.24, M.worker, 0, 1.12, 0));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 20, 14), M.skin);
    head.position.y = 1.56;
    g.add(head);
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.125, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.hat);
    hat.position.y = 1.6;
    g.add(hat);
    for (const dx of [-0.24, 0.24]) {
      const a = box(0.09, 0.09, 0.5, M.worker, dx, 1.3, 0.2);
      a.rotation.x = 0.5;
      g.add(a);
    }
    g.position.set(s * (inner + 0.3), H, 1.55);
    g.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    info(g, { title: s > 0 ? '師傅（左側）' : '師傅（右側）', id: 'env-operator', rows: [['身高', `${1.75} m（業主建議標準）`], ['動作', '和現在一樣：拿工具、對螺絲、扣扳機，不多按任何按鈕'], ['等待時', '會做別的事、不一定看前方，所以提示以聲音與工具本身為主']] });
    root.add(g);
  }

  // 站旁螢幕（輔助）
  const scr = new THREE.Group();
  scr.add(box(0.04, 1.25, 0.04, M.steel, 0, H + 0.62, 0));
  scr.add(box(0.66, 0.4, 0.04, M.screenFrame, 0, H + 1.45, 0));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.34), new THREE.MeshBasicMaterial({ color: 0x1d2a40 }));
  face.position.set(0, H + 1.45, 0.021);
  scr.add(face);
  scr.position.set(1.32, 0, 3.05);
  scr.rotation.y = -Math.PI * 0.82;
  info(scr, { title: '站旁螢幕（輔助）', id: 'env-screen', rows: [['作用', '大字顯示目前步驟與醒目警示'], ['定位', '輔助：師傅不一定看前方，主要提示在工具握把與語音'], ['畫面', '見上方「站旁螢幕」分頁']] });
  root.add(scr);
  out.screenFace = face.material;
  return out;
}

// ── 視角 ─────────────────────────────────────
const PRESETS = {
  orbit: { pos: [3.5, 4.4, 5.6], tgt: [0.15, 2.55, 1.5], fov: 42 },
  arm: { pos: [2.5, 3.7, 3.6], tgt: [0.7, 2.85, 1.6], fov: 42 },
  tool: { pos: [1.4, 2.65, 2.75], tgt: [0.6, 2.15, 1.6], fov: 40 },
  top: { pos: [0.01, 7.8, 1.7], tgt: [0, 2, 1.6], fov: 40 },
};
let tween = null;
function fitFov(base) {
  const a = view.aspect || 1.6;
  if (a >= 1.3) return base;
  return (2 * Math.atan(Math.tan((base * Math.PI) / 360) * (1.3 / a)) * 180) / Math.PI;
}
function goPreset(key, instant = false) {
  const p = PRESETS[key];
  $$('[data-preset]').forEach((b) => b.classList.toggle('on', b.dataset.preset === key));
  const to = { pos: new THREE.Vector3(...p.pos), tgt: new THREE.Vector3(...p.tgt), fov: fitFov(p.fov), key };
  if (instant) {
    view.position.copy(to.pos); controls.target.copy(to.tgt); view.fov = to.fov; view.updateProjectionMatrix();
    return;
  }
  tween = { t: 0, from: { pos: view.position.clone(), tgt: controls.target.clone(), fov: view.fov }, to };
}
let presetKey = 'orbit';
$$('[data-preset]').forEach((b) => b.addEventListener('click', () => { presetKey = b.dataset.preset; goPreset(presetKey); }));
controls.addEventListener('start', () => { tween = null; $$('[data-preset]').forEach((b) => b.classList.remove('on')); });

// ── 點選部件 ─────────────────────────────────
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, view);
  const hit = ray.intersectObjects(pickables.filter((o) => o.visible && o.parent?.visible !== false), false)[0];
  if (hit) selectInfo(hit.object.userData.info);
});

function selectInfo(info) {
  arms.L.highlight(info.key);
  arms.R.highlight(info.key);
  const rows = info.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  $('#info').innerHTML = `
    <div class="info-head"><h3>${esc(info.title)}</h3><code>${esc(info.id)}</code>${info.principles?.length ? pchips(info.principles) : ''}</div>
    <dl class="info-rows">${rows}</dl>
    ${info.key === 'encoder' ? `<h4>評估</h4>${encoderEvalHtml()}` : ''}`;
  setTab('info');
}

// ── 語音與提示音 ─────────────────────────────
const voice = { muted: store.get('muted', false), zh: null, ctx: null, lastSay: '', lastAt: 0 };
function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const vs = speechSynthesis.getVoices();
  voice.zh = vs.find((v) => /zh[-_]TW/i.test(v.lang)) || vs.find((v) => /zh[-_](HK|Hant)/i.test(v.lang)) || vs.find((v) => /^zh/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.addEventListener?.('voiceschanged', pickVoice); }
function unlockAudio() {
  try {
    voice.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (voice.ctx.state === 'suspended') voice.ctx.resume();
  } catch { /* 不支援 Web Audio 時只用語音 */ }
}
function chime(level) {
  if (voice.muted || !voice.ctx) return;
  const c = voice.ctx;
  const tones = level === 'warn' ? [740] : [880, 660];
  tones.forEach((f, i) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = f;
    o.type = 'square';
    const t0 = c.currentTime + i * 0.16;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.08, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + 0.15);
  });
}
function speak(text, urgent) {
  if (voice.muted || !text || !('speechSynthesis' in window)) return;
  const now = performance.now();
  if (text === voice.lastSay && now - voice.lastAt < 1500) return; // 兩側同時觸發的站級提示只播一次
  voice.lastSay = text;
  voice.lastAt = now;
  if (urgent) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-TW';
  if (voice.zh) u.voice = voice.zh;
  u.rate = 1.08;
  speechSynthesis.speak(u);
}
function setMuted(m) {
  voice.muted = m;
  store.set('muted', m);
  $('#mute').setAttribute('aria-pressed', String(m));
  $('#mute span').textContent = m ? '靜音' : '語音';
  if (m && 'speechSynthesis' in window) speechSynthesis.cancel();
}
$('#mute').addEventListener('click', () => { unlockAudio(); setMuted(!voice.muted); });
setMuted(voice.muted);

// ── 鎖附規格（師傅設定頁可改）──────────────────
const SPEC_KEYS = ['torque', 'tol', 'angleMin', 'angleMax'];
function specFrom(values) {
  const out = {};
  for (const [id, sp] of Object.entries(SPEC)) {
    out[id] = { ...sp };
    for (const k of SPEC_KEYS) {
      const v = values?.[id]?.[k];
      if (Number.isFinite(v) && v !== sp[k].v) out[id][k] = { ...sp[k], v, src: '師傅設定頁' };
    }
  }
  return out;
}
const specValues = (spec) => Object.fromEntries(Object.entries(spec).map(([id, sp]) => [id, Object.fromEntries(SPEC_KEYS.map((k) => [k, sp[k].v]))]));
let currentSpec = specFrom(store.get('spec', null));

// ── 播放器 ───────────────────────────────────
const ui = {
  scenarioId: SCENARIOS.some((s) => s.id === store.get('scenario')) ? store.get('scenario') : 'normal',
  speed: 2,
  encoder: true,
  playing: false,
  run: null,
  runId: 0,
  marks: [],
  log: [],
  notes: { L: null, R: null, all: null },
  voiceLine: { L: null, R: null },
  dirty: true,
};
const live = new Map(); // runId → 這次播放產生的事件紀錄

function newRun(id) {
  const vin = `TWPA2026B${String(20000 + ui.runId).padStart(8, '0')}`;
  return createRun(scenarioById(id), { encoder: ui.encoder, spec: currentSpec, vin, epoch: Date.now() });
}

function load(id, { autoplay = false } = {}) {
  ui.scenarioId = id;
  store.set('scenario', id);
  ui.runId++;
  ui.run = newRun(id);
  ui.marks = ui.run.markers();
  live.set(ui.runId, []);
  resetPanels();
  for (const side of ['L', 'R']) {
    arms[side].setToolRest({ instant: true });
    arms[side].setState(ui.run.states[side]);
  }
  consume(ui.run.advance(0), { silent: true });
  const sc = scenarioById(id);
  $('#hud-title').textContent = sc.title;
  $('#hud-expect').textContent = sc.needsEncoder && !ui.encoder
    ? '編碼器已關閉：控制器不知道工具在哪個區域，這個錯誤抓不到。'
    : sc.expect;
  renderScenarioList();
  renderMarks();
  ui.playing = false;
  if (autoplay) play();
  syncPlay();
}

function resetPanels() {
  ui.log = [];
  ui.notes = { L: null, R: null, all: null };
  ui.voiceLine = { L: null, R: null };
  ui.dirty = true;
}

function play() {
  unlockAudio();
  if (ui.run.done) load(ui.scenarioId);
  ui.playing = true;
  syncPlay();
}
function pause() { ui.playing = false; syncPlay(); }
function syncPlay() {
  for (const b of [$('#t-play')]) {
    b.classList.toggle('paused', !ui.playing);
    b.setAttribute('aria-label', ui.playing ? '暫停' : '播放');
  }
  $('#screen-play').textContent = ui.playing ? '暫停' : '播放';
}

function seek(t) {
  const was = ui.playing;
  ui.playing = false;
  ui.run = newRun(ui.scenarioId);
  live.set(ui.runId, []);
  resetPanels();
  for (let x = 0; x < t; x += 0.25) consume(ui.run.advance(Math.min(x + 0.25, t)), { silent: true });
  for (const side of ['L', 'R']) snapArm(side);
  ui.playing = was;
  syncPlay();
}

function snapArm(side) {
  const target = ui.run.targets[side];
  if (target) arms[side].setToolTarget(toolPoint(target), { instant: true });
  else arms[side].setToolRest({ instant: true });
}
const toolPoint = (t) => new THREE.Vector3(...boltPosition(t.zoneId, t.boltIndex)).add(new THREE.Vector3(0, 0.03, 0));

function consume(out, { silent = false } = {}) {
  const t = ui.run.t;
  if (out.records.length) live.get(ui.runId)?.push(...out.records);
  for (const r of out.records) {
    if (['TOOL_ENABLED', 'TRAY_LOWERING'].includes(r.type) && ui.log.length > 60) continue;
    const meta = EVENT_TYPES[r.type];
    const lv = { OK: 'ok', NG: 'alarm', BLOCKED: 'alarm', FAULT: 'fault', WARN: 'warn' }[r.result] ?? 'info';
    const where = r.zoneId ? ` · ${zoneById(r.zoneId).label}${r.boltIndex != null ? ` #${r.boltIndex + 1}` : ''}` : '';
    const val = r.torqueNm != null ? ` · ${r.torqueNm} N·m / ${r.angleDeg}°` : '';
    ui.log.unshift({ sim: t, lv, text: `<b>${r.side}</b> ${meta.label}${where}${val}` });
  }
  for (const a of out.alerts) {
    ui.voiceLine[a.side] = { text: a.say || a.text, level: a.level, t };
    if (!silent) {
      if (a.level !== 'info') chime(a.level);
      speak(a.say, LEVEL_RANK[a.level] >= 2);
    }
  }
  for (const n of out.notes) {
    ui.notes[n.side] = { t: n.t, text: n.text };
    ui.log.unshift({ sim: n.t, lv: 'note', text: `<b>${n.side === 'all' ? '班長' : n.side}</b> ${esc(n.text)}` });
  }
  for (const m of out.moves) {
    if (m.target) arms[m.side].setToolTarget(toolPoint(m.target));
    else arms[m.side].setToolRest();
  }
  ui.log.length = Math.min(ui.log.length, 120);
  for (const side of ['L', 'R']) arms[side].setState(ui.run.states[side]);
  if (out.records.length || out.alerts.length || out.notes.length) ui.dirty = true;
}

function tick(dt) {
  if (!ui.playing) return;
  const out = ui.run.advance(ui.run.t + dt * ui.speed);
  consume(out);
  if (ui.run.done) { ui.playing = false; syncPlay(); ui.dirty = true; }
}

// ── 左側：情境清單、播放控制 ─────────────────────
function renderScenarioList() {
  $('#scenario-list').innerHTML = SCENARIOS.map((s, i) => `
    <button class="scen${s.id === ui.scenarioId ? ' on' : ''}" data-scen="${s.id}" type="button">
      <i>${i + 1}</i><b>${s.title}</b><span>${s.short}</span>
    </button>`).join('');
  $('#screen-scenario').innerHTML = SCENARIOS.map((s, i) => `<option value="${s.id}"${s.id === ui.scenarioId ? ' selected' : ''}>${i + 1}. ${s.title}</option>`).join('');
}
$('#scenario-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-scen]');
  if (b) load(b.dataset.scen, { autoplay: true });
});
$('#t-play').addEventListener('click', () => (ui.playing ? pause() : play()));
$('#t-restart').addEventListener('click', () => load(ui.scenarioId, { autoplay: true }));
$$('[data-speed]').forEach((b) => b.addEventListener('click', () => {
  ui.speed = +b.dataset.speed;
  $$('[data-speed]').forEach((x) => x.classList.toggle('on', x === b));
}));
const slider = $('#t-slider');
slider.addEventListener('input', () => seek(+slider.value));

$('#opt-encoder').addEventListener('change', (e) => {
  ui.encoder = e.target.checked;
  arms.L.setEncoderEnabled(ui.encoder);
  arms.R.setEncoderEnabled(ui.encoder);
  arms.L.setLabelsVisible($('#opt-labels').checked);
  load(ui.scenarioId, { autoplay: ui.playing });
});
$('#opt-labels').addEventListener('change', (e) => arms.L.setLabelsVisible(e.target.checked));
$('#opt-zones').addEventListener('change', (e) => (env.zones.visible = e.target.checked));

function renderMarks() {
  const d = ui.run.duration;
  slider.max = d;
  const color = { warn: '#f0b545', alarm: '#e0303a', fault: '#ff5c8a' };
  const seen = new Set();
  $('#t-marks').innerHTML = ui.marks.filter((m) => {
    const k = `${m.type}@${Math.round(m.t)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map((m) => `<i style="left:${(m.t / d) * 100}%;--c:${color[m.level]}" title="${esc(EVENT_TYPES[m.type]?.label ?? m.type)}"></i>`).join('');
}

function renderTimeline() {
  const { t, duration } = ui.run;
  slider.value = t;
  $('#t-fill').style.width = `${(t / duration) * 100}%`;
  $('#t-time').textContent = `${fmtT(t)} / ${fmtT(duration)}`;
}

// ── 站旁螢幕（迷你與全頁共用）────────────────────
function screenHtml() {
  const run = ui.run;
  const st = run.states;
  let top = null;
  for (const side of ['L', 'R']) {
    const a = st[side].alarm;
    if (a && (!top || LEVEL_RANK[a.level] > LEVEL_RANK[top.a.level] || (LEVEL_RANK[a.level] === LEVEL_RANK[top.a.level] && a.at > top.a.at))) top = { a, side };
  }
  const same = top && st.L.alarm?.type === st.R.alarm?.type && st.L.alarm?.text === st.R.alarm?.text;
  const banner = top
    ? `<div class="scr-alarm" data-level="${top.a.level}"><span>${esc(top.a.text)}</span><span class="who">${same ? '全站' : SIDE_NAME[top.side]}</span></div>`
    : `<div class="scr-alarm" data-level="none"><span>依 SOP 作業中</span></div>`;
  const sideHtml = (side) => {
    const s = st[side];
    const d = describe(s);
    const sig = signalsFor(s);
    const exp = s.expected;
    const zones = SEQUENCE[side].map((id) => {
      const z = zoneById(id);
      const dots = s.bolts[id].map((b, i) => `<i class="${b}${exp && exp.zoneId === id && exp.boltIndex === i && (s.phase === 'A' || s.phase === 'C') ? ' cur' : ''}"></i>`).join('');
      return `<div class="scr-zone${exp?.zoneId === id ? ' cur' : ''}"><span>${z.phase} · ${z.label}</span><span class="bolts">${dots}</span></div>`;
    }).join('');
    let time = '';
    if (s.remaining != null) {
      const n = Math.ceil(s.remaining);
      const cls = s.timedOut ? 'over' : n <= P.phaseWarnLead.v ? 'hot' : '';
      time = `<span class="scr-time ${cls}">${s.timedOut ? '已超時' : `剩 ${n} 秒`}</span>`;
    }
    const ringTone = { green: 't-green', blue: 't-blue', yellow: 't-yellow', red: 't-red', off: 't-off' }[sig.ring];
    return `<div class="scr-side">
      <div class="scr-head"><span class="scr-step" style="--c:${TONE_HEX[d.tone]}">${d.step}</span>
        <div class="scr-title"><b>${d.title}</b><span>${SIDE_NAME[side]} · ${d.sub}</span></div></div>
      <div class="scr-meta"><span class="pill ${ringTone}">工具${sig.label}</span>${time}</div>
      <div class="scr-zones">${zones}</div>
    </div>`;
  };
  const trayText = describe(st.L).tray;
  return `${banner}<div class="scr-sides">${sideHtml('L')}${sideHtml('R')}</div>
    <div class="scr-foot"><span class="tray-bar">承盤 <s><i style="width:${Math.round(run.trayPos * 100)}%"></i></s> ${trayText}</span>
      <span>VIN ${st.L.vin}</span><span>${P.station.v} · ${fmtT(run.t)}</span></div>`;
}
const lastHtml = new WeakMap();
function paint(el, html) {
  if (lastHtml.get(el) === html) return;
  lastHtml.set(el, html);
  el.innerHTML = html;
}

// ── 右側：即時狀態 ───────────────────────────
function sideCardsHtml() {
  const card = (side) => {
    const s = ui.run.states[side];
    const sig = signalsFor(s);
    const lamp = (c, hex) => `<i class="lamp ${sig.stack[c]}" style="--c:${hex}"></i>`;
    const v = ui.voiceLine[side];
    const n = ui.notes[side];
    const last = s.last ? `${zoneById(s.last.zoneId).label} #${s.last.boltIndex + 1} · ${s.last.torqueNm} N·m · ${s.last.angleDeg}° · <b class="res res-${s.last.result}">${s.last.result}</b>` : '—';
    const ringTone = { green: 't-green', blue: 't-blue', yellow: 't-yellow', red: 't-red', off: 't-off' }[sig.ring];
    return `<div class="sc">
      <div class="sc-head"><b>${SIDE_NAME[side]} · 師傅 ${esc(s.operator)}</b><span class="pill ${ringTone}">${sig.label}</span></div>
      <div class="lights">握把 LED <span class="ring-dot${sig.ringBlink ? ' blink' : ''}" style="--c:${RING_HEX[sig.ring]}"></span>
        控制器 <span class="lamp-stack">${lamp('red', '#e0303a')}${lamp('yellow', '#f0b545')}${lamp('green', '#3ccf6b')}</span>
        ${sig.haptic ? '<span class="vib">握把震動</span>' : ''}</div>
      <dl class="sc-line">
        <dt>聲音</dt><dd class="${v && v.level !== 'info' ? 'sc-voice' : ''}">${v ? `「${esc(v.text)}」` : '—'}</dd>
        <dt>師傅處置</dt><dd>${n ? esc(n.text) : '—'}</dd>
        <dt>最後一顆</dt><dd>${last}</dd>
      </dl></div>`;
  };
  const boss = ui.notes.all ? `<div class="sc"><div class="sc-head"><b>班長／全站</b></div><dl class="sc-line"><dt>處置</dt><dd>${esc(ui.notes.all.text)}</dd></dl></div>` : '';
  return card('L') + card('R') + boss;
}
function logHtml() {
  if (!ui.log.length) return '<li class="lv-info"><span>按下播放開始</span></li>';
  return ui.log.slice(0, 40).map((l) => `<li class="lv-${l.lv}"><time>${fmtT(l.sim)}</time><span>${l.text}</span></li>`).join('');
}

let tabNow = 'live';
function setTab(key) {
  tabNow = key;
  $$('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === key)));
  $$('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== key));
}
$$('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
setTab('live');

// ── 改良點、評估、參數 ──────────────────────────
function encoderEvalHtml() {
  const rows = [
    ['ok', '原則一：不增加動作', '編碼器是被動感測，師傅不用多按、不用多看。'],
    ['ok', '原則二：從工具思考', '防錯由手臂與控制器本身完成，不靠攝影機判斷時機。'],
    ['warn', '與「在鎖附機器上加裝裝置」的差異', '被否決的理由是容易晃、隱形成本高。編碼器裝在手臂關節的固定結構上，不在工具上；市面上也有內建編碼器的定位手臂可以整組採購，不是事後加裝。需要向業主說明這個差異。'],
    ['warn', '原則三：妥善率（風險最高）', '① 車輛若邊作業邊隨輸送線移動，需要補償輸送線位置。② 同一區域螺絲間距約 0.1 m，判到「哪一顆」精度要求高。③ 需要定期校正（例如每班開工回原點）。'],
    ['ok', '故障對策', '編碼器異常時只關閉順序檢查，承盤連鎖照常運作，不讓產線停下來。'],
  ];
  return `<div class="eval">
    <div class="verdict"><b>結論：不違反原則一、二；原則三有風險但可控。</b>
      <p>建議定位只做到「哪個區域」，不做到「哪一顆」；列為第二期選配，先用承盤連鎖＋計數上線。上方紅外線測距可當替代定位方式。</p></div>
    ${rows.map(([k, t, d]) => `<div class="eval-row"><span class="mk ${k}">${k === 'ok' ? '✓' : '!'}</span><div><b>${t}</b><p>${d}</p></div></div>`).join('')}
  </div>`;
}

function renderParts() {
  $('#parts').innerHTML = `
    <h4>改良點（點一下在 3D 標出）</h4>
    <ul class="parts-list">${ARM_PARTS.map((p) => `
      <li><button type="button" data-part="${p.key}">
        <span class="n">${NUM[p.n]}</span><b>${p.title}</b>${pchips(p.principles)}<span class="what">${p.what}</span>
      </button></li>`).join('')}</ul>
    <h4>關節編碼器手臂評估</h4>${encoderEvalHtml()}`;
  $('#parts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-part]');
    if (!b) return;
    const m = arms.L.pickables.find((o) => o.userData.info.key === b.dataset.part);
    if (m) selectInfo(m.userData.info);
  });
  $('#encoder-eval').innerHTML = encoderEvalHtml();
}

function renderParams() {
  const chip = (st) => `<span class="chip chip-${st}">${{ confirmed: '已確認', derived: '推算', assumed: '假設' }[st]}</span>`;
  const row = (it) => `<tr><th>${esc(it.label)}${it.note ? `<small>${esc(it.note)}</small>` : ''}<small>${esc(it.src)}</small></th>
    <td class="num">${esc(it.v)}<i> ${esc(it.unit)}</i></td><td>${chip(it.status)}</td></tr>`;
  const groups = PARAM_GROUPS.map(([title, keys]) => `<h4>${title}</h4><table class="ptable">${keys.map((k) => row(P[k])).join('')}</table>`).join('');
  const spec = `<h4>鎖附規格（師傅設定頁可改）</h4><table class="ptable">${ZONES.map((z) => {
    const sp = currentSpec[z.id];
    return `<tr><th>${z.label}<small>${z.id} · ${z.bolts} 顆 · Pset ${sp.pset.v}</small></th>
      <td class="num">${sp.torque.v}<i> N·m ±${sp.tol.v}%</i><br>${sp.angleMin.v}–${sp.angleMax.v}<i>°</i></td><td>${chip('assumed')}</td></tr>`;
  }).join('')}${row(SEQUENCE_STATUS)}</table>
  <p class="src-note">來源：${Object.values(SRC).join('、')}。所有數值集中在 js/arm-params.js。</p>`;
  $('#params').innerHTML = groups + spec;
}

// ── 畫面切換 ─────────────────────────────────
const VIEWS = ['arm', 'settings', 'screen', 'trace', 'compare'];
let viewNow = 'arm';
function go(v, { push = true } = {}) {
  if (!VIEWS.includes(v)) v = 'arm';
  viewNow = v;
  document.body.dataset.view = v;
  $$('main > .view').forEach((s) => (s.hidden = s.dataset.view !== v));
  $$('[data-go]').forEach((b) => b.classList.toggle('on', b.dataset.go === v));
  if (push && location.hash !== `#${v}`) history.replaceState(null, '', `#${v}`);
  $(`[data-go="${v}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (v === 'arm') requestAnimationFrame(resize);
  if (v === 'trace') renderTrace();
  if (v === 'settings') renderSettings();
  if (v !== 'arm') window.scrollTo(0, 0);
}
$$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
window.addEventListener('hashchange', () => go(location.hash.slice(1), { push: false }));
const navScroll = $('.nav-scroll');
const navEnd = () => navScroll.classList.toggle('at-end', navScroll.scrollLeft + navScroll.clientWidth >= navScroll.scrollWidth - 4);
navScroll.addEventListener('scroll', navEnd, { passive: true });

// 比較頁的情境連結
$$('[data-play]').forEach((b) => b.addEventListener('click', () => { go('arm'); load(b.dataset.play, { autoplay: true }); }));

// 站旁螢幕頁
$('#screen-scenario').addEventListener('change', (e) => load(e.target.value, { autoplay: true }));
$('#screen-play').addEventListener('click', () => (ui.playing ? pause() : play()));
$('#screen-restart').addEventListener('click', () => load(ui.scenarioId, { autoplay: true }));
$('#screen-full').addEventListener('click', () => {
  const el = $('#big-screen');
  if (document.fullscreenElement) document.exitFullscreen?.();
  else el.requestFullscreen?.().catch(() => {});
});

// ── 師傅設定 ─────────────────────────────────
let draft = specValues(currentSpec);
const FIELDS = [
  { k: 'torque', label: '目標扭力', unit: 'N·m', step: 1, min: 5, max: 400 },
  { k: 'tol', label: '扭力容差 ±', unit: '%', step: 1, min: 1, max: 30 },
  { k: 'angleMin', label: '角度下限', unit: '°', step: 5, min: 0, max: 720 },
  { k: 'angleMax', label: '角度上限', unit: '°', step: 5, min: 5, max: 720 },
];
function renderSettings() {
  $('#set-grid').innerHTML = ZONES.map((z) => {
    const v = draft[z.id];
    const lo = (v.torque * (1 - v.tol / 100)).toFixed(1);
    const hi = (v.torque * (1 + v.tol / 100)).toFixed(1);
    return `<article class="zcard" style="--c:${z.phase === 'A' ? '#ff8a3d' : '#3dd6d0'}">
      <header><b>${z.label}</b><small>${z.id} · ${z.phase} 階段 · ${z.bolts} 顆 · Pset ${SPEC[z.id].pset.v}</small></header>
      ${FIELDS.map((f) => `<label class="field"><span>${f.label}</span>
        <span class="stepper"><button type="button" data-z="${z.id}" data-k="${f.k}" data-d="-1" aria-label="${f.label}減少">−</button>
        <input type="number" inputmode="decimal" data-z="${z.id}" data-k="${f.k}" value="${v[f.k]}" min="${f.min}" max="${f.max}" step="${f.step}" aria-label="${z.label}${f.label}">
        <button type="button" data-z="${z.id}" data-k="${f.k}" data-d="1" aria-label="${f.label}增加">＋</button></span></label>`).join('')}
      <div class="zrange">判 OK：<b>${lo}–${hi} N·m</b>，角度 <b>${v.angleMin}–${v.angleMax}°</b></div>
    </article>`;
  }).join('');
}
function setDraft(z, k, val) {
  const f = FIELDS.find((x) => x.k === k);
  let v = THREE.MathUtils.clamp(Math.round(val / f.step) * f.step, f.min, f.max);
  if (k === 'angleMin') v = Math.min(v, draft[z].angleMax - 5);
  if (k === 'angleMax') v = Math.max(v, draft[z].angleMin + 5);
  draft[z][k] = v;
  $('#set-status').textContent = '尚未套用';
  renderSettings();
}
$('#set-grid').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-d]');
  if (!b) return;
  const f = FIELDS.find((x) => x.k === b.dataset.k);
  setDraft(b.dataset.z, b.dataset.k, draft[b.dataset.z][b.dataset.k] + f.step * +b.dataset.d);
});
$('#set-grid').addEventListener('change', (e) => {
  const i = e.target.closest('input[data-z]');
  if (i && i.value !== '') setDraft(i.dataset.z, i.dataset.k, +i.value);
});
$('#set-apply').addEventListener('click', () => {
  currentSpec = specFrom(draft);
  store.set('spec', draft);
  $('#set-status').textContent = '已套用，下一台車開始生效';
  renderParams();
  load(ui.scenarioId);
});
$('#set-reset').addEventListener('click', () => {
  draft = specValues(SPEC);
  $('#set-status').textContent = '已還原預設值（尚未套用）';
  renderSettings();
});

// ── 事後追溯 ─────────────────────────────────
let historyData = null;
const trace = { mode: 'bolt', limit: 150 };
const tsFmt = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const fmtTs = (ts) => tsFmt.format(new Date(ts));
const where = (r) => (r.zoneId ? `${zoneById(r.zoneId).label} #${(r.boltIndex ?? 0) + 1}` : '—');

function allRecords() {
  historyData ||= generateHistory();
  const mine = [...live.values()].flat();
  return { records: historyData.concat(mine), liveVins: new Set(mine.map((r) => r.vin)) };
}

function boltRows(records) {
  const rows = new Map();
  const autoByVin = new Map();
  const key = (r) => `${r.vin}|${r.side}|${r.zoneId}|${r.boltIndex}`;
  const sorted = records.slice().sort((a, b) => a.ts.localeCompare(b.ts));
  for (const r of sorted) {
    if (r.type === 'AUTOMATION_FAULT') autoByVin.set(r.vin, r);
    if (!r.zoneId || r.boltIndex == null) continue;
    let row = rows.get(key(r));
    if (!row) rows.set(key(r), (row = { vin: r.vin, station: r.station, side: r.side, operator: r.operator, zoneId: r.zoneId, boltIndex: r.boltIndex, phase: zoneById(r.zoneId).phase, attempts: 0, cats: new Set(), notes: [] }));
    if (r.type === 'TIGHTEN_OK' || r.type === 'TIGHTEN_NG') {
      row.attempts++;
      Object.assign(row, { ts: r.ts, torqueNm: r.torqueNm, angleDeg: r.angleDeg, result: r.result });
    }
    if (r.errorCategory) {
      row.cats.add(r.errorCategory);
      row.notes.push(r.type === 'TIGHTEN_NG' ? `NG ${r.torqueNm} N·m` : EVENT_TYPES[r.type].label);
    }
  }
  const list = [...rows.values()].filter((r) => r.result);
  for (const row of list) {
    if (row.phase === 'C' && autoByVin.has(row.vin)) { row.cats.add('AUTOMATION'); row.notes.push('承盤逾時，等待復歸後鎖附'); }
    if (row.attempts > 1) row.notes.push(`重鎖 ${row.attempts - 1} 次`);
  }
  return list;
}

function traceFilters() {
  return {
    vin: $('#f-vin').value.trim().toUpperCase(),
    side: $('#f-side').value,
    zone: $('#f-zone').value,
    result: $('#f-result').value,
    cat: $('#f-cat').value,
  };
}
function matches(r, f, cats) {
  if (f.vin && !r.vin.includes(f.vin)) return false;
  if (f.side && r.side !== f.side) return false;
  if (f.zone && r.zoneId !== f.zone) return false;
  if (f.result && r.result !== f.result) return false;
  if (f.cat === 'ANY' && !cats.size) return false;
  if (f.cat && f.cat !== 'ANY' && !cats.has(f.cat)) return false;
  return true;
}

function renderTraceSelects() {
  $('#f-zone').innerHTML = `<option value="">全部位置</option>${ZONES.map((z) => `<option value="${z.id}">${z.label}（${z.id}）</option>`).join('')}`;
  const results = trace.mode === 'bolt' ? ['OK', 'NG'] : Object.keys(RESULT_LABEL);
  $('#f-result').innerHTML = `<option value="">全部結果</option>${results.map((r) => `<option value="${r}">${RESULT_LABEL[r]}</option>`).join('')}`;
}

function traceData() {
  const { records, liveVins } = allRecords();
  const f = traceFilters();
  const rows = trace.mode === 'bolt'
    ? boltRows(records).filter((r) => matches(r, f, r.cats))
    : records.filter((r) => matches(r, f, new Set(r.errorCategory ? [r.errorCategory] : [])));
  rows.sort((a, b) => b.ts.localeCompare(a.ts));
  return { rows, records, liveVins, f };
}

function renderTrace() {
  const { rows, records, liveVins, f } = traceData();
  // 摘要：依 VIN／側／位置篩選後的錯誤事件數
  const scope = records.filter((r) => matches(r, { ...f, result: '', cat: '' }, new Set()));
  const bolts = boltRows(scope);
  const fpy = bolts.length ? Math.round((bolts.filter((b) => b.attempts === 1 && !b.cats.size).length / bolts.length) * 1000) / 10 : 0;
  const count = (c) => scope.filter((r) => r.errorCategory === c).length;
  $('#trace-summary').innerHTML = `
    <div class="stat c-ok"><span>螺絲履歷 · 一次合格率</span><b>${bolts.length} 顆 · ${fpy}%</b></div>
    ${Object.entries(CATEGORY).map(([k, label]) => `<button type="button" class="stat c-${k}${f.cat === k ? ' on' : ''}" data-cat="${k}"><span>${label}</span><b>${count(k)}</b></button>`).join('')}
    <div class="stat"><span>車輛數</span><b>${new Set(scope.map((r) => r.vin)).size}</b></div>`;

  const shown = rows.slice(0, trace.limit);
  const liveChip = (vin) => (liveVins.has(vin) ? '<span class="chip chip-live">本次播放</span>' : '');
  const catHtml = (cats) => [...cats].map((c) => `<span class="cat cat-${c}">${CATEGORY[c]}</span>`).join('') || '—';
  let head;
  let body;
  if (trace.mode === 'bolt') {
    head = ['時間', 'VIN', '工位', '側', '師傅', '螺絲位置', '扭力 N·m', '角度 °', '結果', '錯誤分類', '說明'];
    body = shown.map((r) => `<tr>
      <td data-label="時間">${fmtTs(r.ts)}</td><td data-label="VIN" class="full"><code>${r.vin}</code>${liveChip(r.vin)}</td>
      <td data-label="工位">${r.station}</td><td data-label="側">${r.side}</td><td data-label="師傅">${r.operator}</td>
      <td data-label="螺絲位置">${where(r)}</td><td data-label="扭力 N·m" class="n">${r.torqueNm}</td><td data-label="角度 °" class="n">${r.angleDeg}</td>
      <td data-label="結果"><span class="res res-${r.result}">${RESULT_LABEL[r.result]}</span></td>
      <td data-label="錯誤分類">${catHtml(r.cats)}</td><td data-label="說明" class="wrap full">${esc(r.notes.join('；')) || '—'}</td></tr>`).join('');
  } else {
    head = ['時間', 'VIN', '工位', '側', '師傅', '螺絲位置', '階段', '事件', '扭力 N·m', '角度 °', '結果', '錯誤分類'];
    body = shown.map((r) => `<tr>
      <td data-label="時間">${fmtTs(r.ts)}</td><td data-label="VIN" class="full"><code>${r.vin}</code>${liveChip(r.vin)}</td>
      <td data-label="工位">${r.station}</td><td data-label="側">${r.side}</td><td data-label="師傅">${r.operator}</td>
      <td data-label="螺絲位置">${where(r)}</td><td data-label="階段">${r.phase || '—'}</td>
      <td data-label="事件">${EVENT_TYPES[r.type].label}<br><code>${r.type}</code></td>
      <td data-label="扭力 N·m" class="n">${r.torqueNm ?? '—'}</td><td data-label="角度 °" class="n">${r.angleDeg ?? '—'}</td>
      <td data-label="結果"><span class="res res-${r.result}">${RESULT_LABEL[r.result]}</span></td>
      <td data-label="錯誤分類">${r.errorCategory ? catHtml([r.errorCategory]) : '—'}</td></tr>`).join('');
  }
  $('#trace-table').innerHTML = `<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${head.length}">沒有符合條件的紀錄</td></tr>`}</tbody>`;
  $('#trace-count').textContent = `共 ${rows.length} 筆${rows.length > shown.length ? `，顯示前 ${shown.length} 筆` : ''}`;
  $('#trace-more').hidden = rows.length <= shown.length;
}

$('#trace-summary').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  $('#f-cat').value = $('#f-cat').value === b.dataset.cat ? '' : b.dataset.cat;
  trace.limit = 150;
  renderTrace();
});
$$('.filters [data-mode]').forEach((b) => b.addEventListener('click', () => {
  trace.mode = b.dataset.mode;
  trace.limit = 150;
  $$('.filters [data-mode]').forEach((x) => x.classList.toggle('on', x === b));
  const keep = $('#f-result').value;
  renderTraceSelects();
  if ([...$('#f-result').options].some((o) => o.value === keep)) $('#f-result').value = keep;
  renderTrace();
}));
for (const id of ['#f-side', '#f-zone', '#f-result', '#f-cat']) $(id).addEventListener('change', () => { trace.limit = 150; renderTrace(); });
$('#f-vin').addEventListener('input', () => { trace.limit = 150; renderTrace(); });
$('#f-clear').addEventListener('click', () => {
  for (const id of ['#f-vin', '#f-side', '#f-zone', '#f-result', '#f-cat']) $(id).value = '';
  renderTrace();
});
$('#trace-more').addEventListener('click', () => { trace.limit += 300; renderTrace(); });

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const exportRows = () => {
  const { rows } = traceData();
  if (trace.mode === 'event') return rows;
  return rows.map((r) => ({
    ts: r.ts, vin: r.vin, station: r.station, side: r.side, operator: r.operator, zoneId: r.zoneId, boltIndex: r.boltIndex,
    phase: r.phase, attempts: r.attempts, torqueNm: r.torqueNm, angleDeg: r.angleDeg, result: r.result,
    errorCategory: [...r.cats].join('|'), note: r.notes.join('；'),
  }));
};
$('#f-json').addEventListener('click', () => download(`smart-arm-${trace.mode}.json`, JSON.stringify(exportRows(), null, 2), 'application/json'));
$('#f-csv').addEventListener('click', () => {
  const rows = exportRows();
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const cell = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  download(`smart-arm-${trace.mode}.csv`, `﻿${cols.join(',')}\n${rows.map((r) => cols.map((c) => cell(r[c])).join(',')).join('\n')}`, 'text/csv');
});

// 比較頁表格在手機改卡片時需要欄名
$$('table.compare').forEach((t) => {
  const names = $$('thead th', t).map((th) => th.textContent);
  $$('tbody tr', t).forEach((tr) => [...tr.children].forEach((c, i) => c.tagName === 'TD' && c.setAttribute('data-label', names[i])));
});

// ── 迴圈 ─────────────────────────────────────
function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  labelRenderer.setSize(w, h);
  view.aspect = w / h;
  if (!tween) view.fov = fitFov(PRESETS[presetKey].fov);
  view.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);

const clock = new THREE.Clock();
let uiTimer = 0;
const boltColor = { PENDING: 0x4a5568, OK: 0x3ccf6b, NG: 0xe0303a };
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const time = clock.elapsedTime;
  tick(dt);

  if (viewNow === 'arm') {
    if (tween) {
      tween.t = Math.min(1, tween.t + dt * 1.6);
      const k = 1 - (1 - tween.t) ** 3;
      view.position.lerpVectors(tween.from.pos, tween.to.pos, k);
      controls.target.lerpVectors(tween.from.tgt, tween.to.tgt, k);
      view.fov = THREE.MathUtils.lerp(tween.from.fov, tween.to.fov, k);
      view.updateProjectionMatrix();
      if (tween.t >= 1) tween = null;
    }
    controls.update();
    arms.L.update(dt, time);
    arms.R.update(dt, time);
    // 承盤與螺絲狀態
    env.tray.position.y = -P.trayDrop.v * ui.run.trayPos;
    const pulse = 0.5 + 0.5 * Math.sin(time * 6);
    for (const side of ['L', 'R']) {
      const s = ui.run.states[side];
      for (const id of SEQUENCE[side]) {
        s.bolts[id].forEach((b, i) => {
          const m = env.bolts[id][i].material;
          const cur = s.expected && s.expected.zoneId === id && s.expected.boltIndex === i && (s.phase === 'A' || s.phase === 'C');
          m.color.setHex(cur ? 0xffffff : boltColor[b]);
          m.emissive.setHex(cur ? 0xf2c230 : b === 'PENDING' ? 0x000000 : boltColor[b]);
          m.emissiveIntensity = cur ? 0.4 + pulse * 0.8 : 0.5;
        });
      }
    }
    const lv = Math.max(...['L', 'R'].map((k) => LEVEL_RANK[ui.run.states[k].alarm?.level] ?? -1));
    env.screenFace.color.setHex(lv >= 2 ? (time % 0.8 < 0.45 ? 0xe0303a : 0x5a1016) : lv === 1 ? 0xf0b545 : 0x1d4a34);
    renderer.render(scene, view);
    labelRenderer.render(scene, view);
  }

  uiTimer += dt;
  if (ui.dirty || uiTimer > 0.2) {
    uiTimer = 0;
    ui.dirty = false;
    renderTimeline();
    if (viewNow === 'arm') {
      const html = screenHtml();
      paint($('#mini-screen'), html);
      paint($('#side-cards'), sideCardsHtml());
      paint($('#event-log'), logHtml());
    }
    if (viewNow === 'screen') paint($('#big-screen'), screenHtml());
  }
  requestAnimationFrame(frame);
}

// ── 啟動 ─────────────────────────────────────
renderParts();
renderParams();
renderTraceSelects();
goPreset('orbit', true);
load(ui.scenarioId);
go(location.hash.slice(1) || 'arm', { push: false });
navEnd();
requestAnimationFrame(frame);
