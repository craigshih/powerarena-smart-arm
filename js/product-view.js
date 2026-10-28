// 「手臂介紹」頁（UI 層）：以新款手臂（含手臂螢幕）為主的產品介紹。
// - 四種顯示：新款、舊款、並排對比、廠房實境（手臂裝回工站、師傅實際操作）
// - 點 3D 部件、編號標籤或右側清單：鏡頭飛過去放大那個部件，右側顯示舊款 vs 新款、規格與故障對策
// - 狀態示範：新舊手臂切到同一時刻；手臂螢幕區塊的實機畫面同步更新

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { P, armMount, boltPosition } from './arm-params.js';
import { createSmartArm, drawArmScreen, ARM_PARTS } from './arm-model.js';
import { scenarioById, createRun } from './scenarios.js';
import { buildEnvironment, addFactoryBackdrop } from './environment.js';
import { createOperator } from './operator.js';
import { createAlertFx } from './alert-fx.js';

const NUM = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
const NEW_KEYS = ARM_PARTS.map((p) => p.key);
const HANG_Y = P.railY.v;

// 沿用的部件（點到時顯示）
const BASE = {
  trolley: { title: '軌道台車', text: '沿上方工具軌道前後移動，讓工具跟著車位。沿用工廠原有。' },
  arm: { title: '兩節水平臂', text: '兩個水平旋轉關節，讓工具到達兩側鎖附區域。沿用工廠原有，新款在關節加裝編碼器（選配）。' },
  balancer: { title: '平衡器', text: '抵銷工具重量，師傅輕推就能上下。沿用工廠原有，新款在外管下端加裝手臂螢幕。' },
};

// 狀態示範：情境與時刻；舊款同一時刻的樣子；look 是新款手臂上的顏色與圖示
export const DEMOS = [
  { key: 'ready', label: '可鎖附', id: 'normal', t: 2.0, old: '隨時可轉', look: ['#3ccf6b', 'check', '可鎖附'],
    use: { title: '該鎖哪一顆', act: '白框標出下一顆' } },
  { key: 'running', label: '鎖附中', id: 'normal', t: 3.5, old: '鎖附中，不回報扭力', oldRun: true, look: ['#4ea8ff', 'spin', '鎖附中'] },
  { key: 'warn', label: '即將超時', id: 'timeout', t: 12, old: '沒有倒數', look: ['#f0b545', 'clock', '即將超時'],
    use: { title: '還剩多少時間', act: '倒數變黃' } },
  { key: 'wait', label: '等承盤', id: 'normal', t: 15, old: '仍然能轉', look: ['#f0b545', 'lock', '已鎖定・等承盤'] },
  { key: 'early', label: '降前鎖附', id: 'early', t: 15, old: '工具照轉，承盤沒降就鎖上', oldRun: true, look: ['#e0303a', 'stop', '降前鎖附・已攔下', true],
    use: { title: '為什麼被攔下', act: '放開扳機，等承盤' } },
  { key: 'ng', label: '扭力不足', id: 'ng', t: 4.8, old: '沒有量測', look: ['#ff3b4f', 'x', '扭力不足・重鎖', true],
    use: { title: '哪一顆沒鎖好', act: '原地重鎖' } },
  { key: 'tray', label: '承盤異常', id: 'automation', t: 36, old: '工具仍能轉', look: ['#b07cff', 'gear', '承盤異常・等班長'],
    use: { title: '不是自己的錯', act: '等班長復歸' } },
  { key: 'fault', label: '扭矩槍訊號中斷', id: 'tool', t: 4.5, old: '停了也沒紀錄', look: ['#ff8a3d', 'bolt', '訊號中斷・已鎖住', true] },
  { key: 'done', label: '本車完成', id: 'normal', t: 36, old: '沒有完成確認', look: ['#3ccf6b', 'check', '本車完成'],
    use: { title: '鎖完確認', act: '每顆都是綠點' } },
];
const ICON = {
  check: '<path d="M4 12l5 5L20 6"/>',
  spin: '<path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/>',
  clock: '<circle cx="12" cy="13" r="9"/><path d="M12 8v5l3 2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  stop: '<path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z"/><path d="M8 12h8"/>',
  x: '<circle cx="12" cy="12" r="10"/><path d="M8 8l8 8M16 8l-8 8"/>',
  gear: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  free: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

function demoAt(d, spec) {
  const run = createRun(scenarioById(d.id), { encoder: true, spec, vin: 'TWPA2026E00000001', epoch: Date.parse('2026-10-24T08:00:00+08:00') });
  const records = [];
  for (let x = 0; x < d.t; x += 0.25) records.push(...run.advance(Math.min(x + 0.25, d.t)).records);
  return { state: run.states.L, target: run.targets.L, trayPos: run.trayPos, records };
}

export function createProductView(deps) {
  const { $, esc, speak, unlockAudio, getSpec } = deps;
  const host = $('#product-view');

  // ── 場景：攝影棚 ─────────────────────────────
  const scene = new THREE.Scene();
  const STUDIO_BG = new THREE.Color(0x18202b);
  const PLANT_BG = new THREE.Color(0x1b2028);
  scene.background = STUDIO_BG.clone();
  scene.fog = new THREE.Fog(0x18202b, 8, 18);
  scene.add(new THREE.HemisphereLight(0xe6eeff, 0x1a1f28, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 7, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 16 });
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9cc4ff, 0.9);
  rim.position.set(-4, 4, -3);
  scene.add(rim);
  const studio = new THREE.Group();
  const floorY = P.platformHeight.v;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3.2, 64), new THREE.MeshStandardMaterial({ color: 0x1b222d, roughness: 0.6, metalness: 0.2 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY;
  floor.receiveShadow = true;
  studio.add(floor);
  for (const r of [1.2, 2.0, 2.8]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.008, 96), new THREE.MeshBasicMaterial({ color: 0x2a3446 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = floorY + 0.002;
    studio.add(ring);
  }
  scene.add(studio);

  // 一段上方軌道（工廠原有），展示台上的手臂掛在上面
  const railMat = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5, metalness: 0.2 });
  const makeRail = () => {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 3.6), railMat);
    beam.position.set(0, HANG_Y + 0.06, 0.6);
    beam.castShadow = true;
    studio.add(beam);
    return beam;
  };

  const arms = {
    old: createSmartArm({ side: 'L', legacy: true, mount: false }),
    iot: createSmartArm({ side: 'L', labels: true, mount: false }),
  };
  const rails = { old: makeRail(), iot: makeRail() };
  // 工具上方原本的文字標籤由狀態徽章取代
  for (const k of ['old', 'iot']) arms[k].tags.forEach((t) => t.element.classList.contains('tag-tool') && t.element.classList.add('hidden-tag'));
  // 狀態外觀：工具外圍光暈＋工具上方的狀態標籤，讓每個狀態一眼分得出來
  const looks = {};
  for (const k of ['old', 'iot']) {
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x3ccf6b, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
    const el = document.createElement('div');
    el.className = 'arm-badge';
    const badge = new CSS2DObject(el);
    badge.center.set(0.5, 0); // 掛在套筒下方，不擋手臂螢幕
    scene.add(halo, badge);
    looks[k] = { halo, el, badge, blink: false };
  }
  scene.add(arms.old, arms.iot);
  const titles = {};
  for (const [k, text] of [['old', '舊款・現有手臂'], ['iot', '新款・IoT 改良手臂']]) {
    const el = document.createElement('div');
    el.className = `product-title ${k}`;
    el.textContent = text;
    const t = new CSS2DObject(el);
    t.center.set(0.5, 1);
    scene.add(t);
    titles[k] = t;
  }

  // ── 廠房實境（第一次切換時才建）────────────────
  let plant = null;
  function buildPlant() {
    const g = new THREE.Group();
    const env = buildEnvironment(g);
    addFactoryBackdrop(g);
    const op = createOperator({ side: 'L' });
    g.add(op);
    const fx = createAlertFx(g);
    scene.add(g);
    plant = { g, env, op, fx };
  }

  // ── 繪圖 ───────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  host.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.domElement.className = 'labels';
  host.appendChild(labels.domElement);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.02, 60);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 0.25;
  controls.maxDistance = 10;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.8;
  let tween = null;
  const stopSpin = () => { controls.autoRotate = false; $('#product-spin').checked = false; };
  controls.addEventListener('start', () => { stopSpin(); tween = null; });

  const st = { mode: 'iot', part: 'screen', demo: 'ready', focused: null };
  const mount = new THREE.Vector3(...armMount('L'));
  const POSE = new THREE.Vector3(...boltPosition('Z1L', 1)).sub(mount).add(new THREE.Vector3(0, 0.12, -0.25));
  const VIEW = {
    iot: { pos: [2.95, 4.15, 3.95], tgt: [0.05, 3.0, 0.65] },
    old: { pos: [2.95, 4.15, 3.95], tgt: [0.05, 3.0, 0.65] },
    both: { pos: [3.4, 4.35, 5.0], tgt: [0.1, 3.0, 0.65] },
    plant: { pos: [2.25, 4.05, 3.75], tgt: [0.55, 2.75, 1.4] },
  };

  // ── 鏡頭移動（全貌 ↔ 部件特寫）─────────────────
  function flyTo(pos, tgt, instant = false) {
    if (instant) {
      tween = null;
      camera.position.copy(pos);
      controls.target.copy(tgt);
      controls.update();
      return;
    }
    tween = { t: 0, from: { pos: camera.position.clone(), tgt: controls.target.clone() }, to: { pos, tgt } };
  }
  function overview(instant = false) {
    st.focused = null;
    $('#product-back').hidden = true;
    const v = VIEW[st.mode];
    flyTo(new THREE.Vector3(...v.pos), new THREE.Vector3(...v.tgt), instant);
  }
  function focusPart(k) {
    if (st.mode === 'old') setMode('iot', true);
    arms.iot.updateMatrixWorld(true);
    const f = arms.iot.getPartFocus(k);
    if (!f) return;
    stopSpin();
    st.focused = k;
    $('#product-back').hidden = false;
    flyTo(f.target.clone().add(f.offset), f.target);
  }

  // ── 顯示模式 ────────────────────────────────
  function setMode(mode, keepFocus = false) {
    st.mode = mode;
    const both = mode === 'both';
    const isPlant = mode === 'plant';
    if (isPlant && !plant) buildPlant();
    studio.visible = !isPlant;
    if (plant) { plant.g.visible = isPlant; plant.fx.setVisible(isPlant); }
    scene.background = (isPlant ? PLANT_BG : STUDIO_BG).clone();
    scene.fog = isPlant ? new THREE.Fog(0x1b2028, 9, 26) : new THREE.Fog(0x18202b, 8, 18);
    arms.old.visible = mode === 'old' || both;
    arms.iot.visible = mode !== 'old';
    rails.old.visible = arms.old.visible && !isPlant;
    rails.iot.visible = arms.iot.visible && !isPlant;
    const xs = both ? { old: -0.75, iot: 0.95 } : { old: 0.3, iot: 0.3 };
    for (const k of ['old', 'iot']) {
      arms[k].tags.forEach((t) => (t.visible = arms[k].visible)); // CSS2D 標籤不會跟著父物件隱藏
      looks[k].badge.visible = arms[k].visible;
      looks[k].halo.visible = arms[k].visible;
      if (isPlant && k === 'iot') arms[k].position.copy(mount);
      else arms[k].position.set(xs[k], HANG_Y, 0);
      rails[k].position.x = xs[k];
      titles[k].visible = both && arms[k].visible;
      titles[k].position.set(xs[k], HANG_Y + 0.42, 0.6);
    }
    applyDemo(false, true);
    document.querySelectorAll('[data-pmode]').forEach((b) => b.classList.toggle('on', b.dataset.pmode === mode));
    host.classList.toggle('show-tags', mode === 'iot' || mode === 'both');
    if (!keepFocus) overview(true);
  }

  // ── 狀態示範 ────────────────────────────────
  let demoCache = new Map();
  let current = null;
  const local = (target) => (target
    ? new THREE.Vector3(...boltPosition(target.zoneId, target.boltIndex)).sub(mount).add(new THREE.Vector3(0, 0.03, 0))
    : POSE.clone());
  function applyDemo(sayIt = true, instant = false) {
    const d = DEMOS.find((x) => x.key === st.demo);
    if (!demoCache.has(d.key)) demoCache.set(d.key, demoAt(d, getSpec()));
    current = demoCache.get(d.key);
    const { state, target } = current;
    arms.iot.setState(state);
    arms.old.setState({ tool: d.oldRun ? 'RUNNING' : 'ENABLED' });
    for (const k of ['old', 'iot']) arms[k].setToolTarget(arms[k].position.clone().add(local(target)), { instant });
    if (plant) {
      plant.fx.reset();
      plant.fx.onRecords(current.records, { pops: false });
    }
    $('#demo-select').value = d.key;
    const a = state.alarm && state.alarm.level !== 'info' ? state.alarm : null;
    const [color, ic, text, blink] = d.look;
    const label = d.key === 'warn' && state.remaining != null ? `剩 ${Math.ceil(state.remaining)} 秒` : text;
    setLook('iot', color, ic, label, blink);
    setLook('old', '#8b98ad', d.oldRun ? 'spin' : 'free', d.oldRun ? '鎖附中' : '隨時可轉', false);
    const sb = $('#status-badge');
    sb.hidden = st.mode === 'old' || st.mode === 'both'; // 並排時每支手臂各有自己的狀態徽章
    sb.style.setProperty('--c', color);
    $('.demo-pick').style.setProperty('--c', color);
    sb.classList.toggle('blink', !!blink);
    sb.innerHTML = `${icon(ic)}<b>${esc(label)}</b>${a ? `<span>「${esc(a.say || a.text)}」</span>` : ''}`;
    $('#demo-iot').innerHTML = `<b>新款</b>${esc(label)}`;
    $('#demo-old').innerHTML = `<b>舊款</b>${esc(d.old)}`;
    drawScreens();
    if (sayIt && a?.say) speak(a.say, true);
    if (sayIt && (st.mode === 'iot' || st.mode === 'plant')) focusStatus();
  }
  function setLook(k, color, ic, label, blink) {
    const L = looks[k];
    L.halo.material.color.set(color);
    L.blink = !!blink;
    L.el.style.setProperty('--c', color);
    L.el.innerHTML = `${icon(ic)}<span>${esc(label)}</span>`;
  }
  // 廠房實境裡師傅站在車子左外側（+X），鏡頭改從車頭前上方看，才不會被師傅擋住
  const STATUS_OFFSET = { studio: new THREE.Vector3(1.25, 0.35, 1.05), plant: new THREE.Vector3(-0.8, 0.8, 1.7) };
  // 狀態特寫：工具、握把燈與手臂螢幕同時入鏡
  function focusStatus() {
    arms.iot.updateMatrixWorld(true);
    const scr = arms.iot.getPartFocus('screen').target;
    const tip = arms.iot.getToolTip(new THREE.Vector3());
    const tgt = scr.clone().lerp(tip, 0.5);
    stopSpin();
    st.focused = 'status';
    $('#product-back').hidden = false;
    flyTo(tgt.clone().add(STATUS_OFFSET[st.mode === 'plant' ? 'plant' : 'studio']), tgt);
  }
  // 狀態特寫的鏡頭中心：手臂螢幕與套筒的中點（工具移動時跟著走）
  function statusCenter() {
    const scr = arms.iot.getPartFocus('screen').target;
    return scr.lerp(arms.iot.getToolTip(new THREE.Vector3()), 0.5);
  }

  function drawScreens() {
    if (!current) return;
    for (const id of ['pd-device-canvas', 'pd-mini']) {
      const c = document.getElementById(id);
      if (c) drawArmScreen(c.getContext('2d'), current.state, 'L');
    }
    document.querySelectorAll('[data-use]').forEach((b) => b.classList.toggle('on', b.dataset.use === st.demo));
  }

  // ── 右側說明 ────────────────────────────────
  function renderFeature() {
    const k = st.part;
    const p = ARM_PARTS.find((x) => x.key === k);
    if (!p) {
      const b = BASE[k];
      $('#feature-detail').innerHTML = `
        <div class="feature-head"><span class="fnum base">沿用</span><h3>${esc(b.title)}</h3></div>
        <p class="feature-one">${esc(b.text)}</p>`;
    } else {
      $('#feature-detail').innerHTML = `
        <div class="feature-head"><span class="fnum">${NUM[p.n]}</span><h3>${esc(p.title)}</h3></div>
        ${k === 'screen' ? '<div class="mini-screen"><canvas id="pd-mini" width="480" height="320" aria-label="手臂螢幕目前畫面"></canvas></div>' : ''}
        <div class="feature-vs">
          <p class="vs-new"><i>新款</i>${esc(p.short)}</p>
          <p class="vs-old"><i>舊款</i>${esc(p.beforeShort)}</p>
        </div>`;
    }
    document.querySelectorAll('[data-feature]').forEach((b) => b.classList.toggle('on', b.dataset.feature === k));
    arms.iot.highlight($('#product-new').checked ? NEW_KEYS : k);
    drawScreens();
  }
  function selectPart(k, zoom = true) {
    st.part = k;
    renderFeature();
    if (zoom) focusPart(k);
  }
  // 點 3D 部件
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5 || !arms.iot.visible) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(arms.iot.pickables.filter((o) => o.visible), false)[0];
    const k = hit?.object.userData.info?.key;
    if (k && (NEW_KEYS.includes(k) || BASE[k])) selectPart(k);
  });
  for (const t of arms.iot.tags) {
    const k = t.element.dataset.part;
    if (k) t.element.addEventListener('click', () => selectPart(k));
  }

  // ── 控制 ─────────────────────────────────
  $('#feature-list').innerHTML = ARM_PARTS.map((p) => `<button type="button" data-feature="${p.key}"><span>${NUM[p.n]}</span>${esc(p.tag)}</button>`).join('');
  $('#feature-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-feature]');
    if (b) selectPart(b.dataset.feature);
  });
  document.querySelectorAll('[data-pmode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.pmode)));
  $('#product-spin').addEventListener('change', (e) => (controls.autoRotate = e.target.checked));
  $('#product-new').addEventListener('change', renderFeature);
  $('#product-back').addEventListener('click', () => overview());
  const DEMO_GROUPS = [['正常', ['ready', 'running', 'done']], ['提醒', ['warn', 'wait']], ['錯誤', ['early', 'ng', 'tray', 'fault']]];
  $('#demo-select').innerHTML = DEMO_GROUPS.map(([g, keys]) => `<optgroup label="${g}">${keys
    .map((k) => `<option value="${k}">${DEMOS.find((d) => d.key === k).label}</option>`).join('')}</optgroup>`).join('');
  $('#demo-select').addEventListener('change', (e) => {
    unlockAudio();
    st.demo = e.target.value;
    applyDemo(true);
  });

  // 手臂螢幕區塊：作用清單（點了切到那個時刻）
  $('#pd-uses').innerHTML = DEMOS.filter((d) => d.use).map((d, i) => `
    <button type="button" data-use="${d.key}" style="--c:${d.look[0]}">
      <span class="n">${i + 1}</span>
      <span class="u"><b>${esc(d.use.title)}</b><em>${esc(d.use.act)}</em></span>
    </button>`).join('');
  $('#pd-uses').addEventListener('click', (e) => {
    const b = e.target.closest('[data-use]');
    if (!b) return;
    unlockAudio();
    st.demo = b.dataset.use;
    applyDemo(true);
  });
  $('#pd-device-notes').addEventListener('change', (e) => $('#pd-device').classList.toggle('notes', e.target.checked));
  $('#pd-device-full').addEventListener('click', () => {
    const el = $('#pd-device');
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => {});
  });
  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);

  const IDLE_R = { alarm: null, bolts: {} };
  function frame(dt, time) {
    if (tween) {
      tween.t = Math.min(1, tween.t + dt * 1.4);
      const k = 1 - (1 - tween.t) ** 3;
      camera.position.lerpVectors(tween.from.pos, tween.to.pos, k);
      controls.target.lerpVectors(tween.from.tgt, tween.to.tgt, k);
      if (tween.t >= 1) tween = null;
    }
    controls.update();
    arms.old.update(dt, time);
    arms.iot.update(dt, time);
    for (const k of ['old', 'iot']) {
      const L = looks[k];
      const tip = arms[k].getToolTip(new THREE.Vector3());
      L.halo.position.copy(tip).add(new THREE.Vector3(0, 0.18, 0));
      L.badge.position.copy(tip).add(new THREE.Vector3(0, -0.06, 0));
      const pulse = L.blink ? (Math.sin(time * 9) > 0 ? 0.42 : 0.08) : 0.2 + 0.08 * Math.sin(time * 3);
      L.halo.material.opacity = k === 'old' ? 0.08 : pulse;
      L.halo.scale.setScalar(1 + (L.blink ? 0.15 * Math.sin(time * 9) : 0.05 * Math.sin(time * 3)));
    }
    // 放大中且部件在動（例如工具移到另一顆螺絲）時，鏡頭跟著部件
    if (st.focused && !tween) {
      const f = st.focused === 'status' ? { target: statusCenter() } : arms.iot.getPartFocus(st.focused);
      if (f && f.target.distanceTo(controls.target) > 0.002) {
        const delta = f.target.clone().sub(controls.target).multiplyScalar(Math.min(1, dt * 4));
        controls.target.add(delta);
        camera.position.add(delta);
      }
    }
    if (st.mode === 'plant' && plant && current) {
      plant.env.tray.position.y = -P.trayDrop.v * current.trayPos;
      const s = current.state;
      plant.env.paintBolts({ L: s }, time);
      plant.op.update(dt, time, {
        mode: current.target ? 'work' : 'wait',
        grip: current.target ? arms.iot.getGrip() : null,
        top: current.target ? arms.iot.getToolTop() : null,
      });
      plant.fx.update(dt, time, { states: { L: s, R: IDLE_R }, arms: { L: arms.iot, R: arms.iot }, tray: plant.env.tray });
      if (host.dataset.fx !== plant.fx.mood) host.dataset.fx = plant.fx.mood;
    } else if (host.dataset.fx) host.dataset.fx = '';
    renderer.render(scene, camera);
    labels.render(scene, camera);
  }

  setMode('iot');
  renderFeature();
  return {
    frame,
    resize,
    refresh() { demoCache = new Map(); applyDemo(false); },
    debug: { camera, controls, arms },
  };
}
