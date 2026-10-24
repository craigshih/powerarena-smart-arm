// 「手臂介紹」頁（UI 層）：以新款手臂（含手臂螢幕）為主的產品介紹。
// - 四種顯示：新款、舊款、並排對比、廠房實境（手臂裝回工站、師傅實際操作）
// - 點 3D 部件、編號標籤或右側清單：鏡頭飛過去放大那個部件，右側顯示舊款 vs 新款、規格與故障對策
// - 狀態示範：新舊手臂切到同一時刻；手臂螢幕區塊的實機畫面同步更新

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { P, SEQUENCE, armMount, boltPosition } from './arm-params.js';
import { createSmartArm, drawArmScreen, ARM_PARTS, PRINCIPLES } from './arm-model.js';
import { scenarioById, createRun } from './scenarios.js';
import { buildEnvironment, addFactoryBackdrop } from './environment.js';
import { createOperator } from './operator.js';
import { createAlertFx } from './alert-fx.js';

const NUM = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
const NEW_KEYS = ARM_PARTS.map((p) => p.key);
const HANG_Y = P.railY.v;
const STATUS = { confirmed: '已確認', derived: '推算', assumed: '假設' };

// 沿用的部件（點到時顯示）
const BASE = {
  trolley: { title: '軌道台車', text: '沿上方工具軌道前後移動，讓工具跟著車位。沿用工廠原有。' },
  arm: { title: '兩節水平臂', text: '兩個水平旋轉關節，讓工具到達兩側鎖附區域。沿用工廠原有，新款在關節加裝編碼器（選配）。' },
  balancer: { title: '平衡器', text: '抵銷工具重量，師傅輕推就能上下。沿用工廠原有，新款在外管下端加裝手臂螢幕。' },
};

// 狀態示範：情境與時刻；舊款同一時刻會怎樣；use 是手臂螢幕對師傅的作用
export const DEMOS = [
  { key: 'ready', label: '可鎖附', id: 'normal', t: 9.5, old: '隨時可轉，沒有任何提示',
    use: { title: '知道現在該鎖哪一顆', see: '大字步驟 A，白框標出下一顆。', act: '照白框鎖，不用靠記憶記順序。' } },
  { key: 'running', label: '鎖附中', id: 'normal', t: 8.0, old: '鎖附中，但不回報扭力', oldRun: true },
  { key: 'warn', label: '即將超時', id: 'timeout', t: 30, old: '沒有倒數提醒',
    use: { title: '知道還剩多少時間', see: '右上角倒數變黃，底部寫出剩幾秒。', act: '加快完成，不必抬頭找時鐘。' } },
  { key: 'wait', label: '等承盤', id: 'normal', t: 30, old: '仍然能轉：這時候鎖下去就是提前鎖附' },
  { key: 'early', label: '提前鎖附', id: 'early', t: 31, old: '工具照轉，車身固定點提前鎖上', oldRun: true,
    use: { title: '被攔下時，知道為什麼', see: '「提前鎖附！承盤尚未下降」→ 放開扳機，等承盤降下。', act: '放開扳機等承盤，不會以為工具壞了。' } },
  { key: 'ng', label: '扭力不足', id: 'ng', t: 9.6, old: '沒有量測，被當成鎖好了',
    use: { title: '鎖不好，當場知道是哪一顆', see: '整面變紅寫出實際扭力，紅點就是那一顆。', act: '原地重鎖；合格後紅點變綠才往下。' } },
  { key: 'tray', label: '承盤卡住', id: 'automation', t: 55, old: '工具仍能轉，以為承盤降了就開始鎖',
    use: { title: '不是自己的錯，也看得出來', see: '「承盤下降逾時」→ 不用處理，等班長復歸。', act: '照常等待，班長收到通知到場。' } },
  { key: 'fault', label: '工具故障', id: 'tool', t: 9, old: '停了也沒紀錄，不知道這顆有沒有鎖到位' },
  { key: 'done', label: '本車完成', id: 'normal', t: 60, old: '沒有完成確認',
    use: { title: '鎖完確認，安心放手', see: '「本車完成」，每顆都是綠點。', act: '放回工具，等下一台。' } },
];

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
    document.querySelectorAll('[data-demo]').forEach((b) => b.classList.toggle('on', b.dataset.demo === d.key));
    const a = state.alarm && state.alarm.level !== 'info' ? state.alarm : null;
    $('#demo-iot').innerHTML = `<b>新款</b>工具${esc(stateLabel(state))}${a ? `，廣播「${esc(a.say || a.text)}」` : ''}`;
    $('#demo-old').innerHTML = `<b>舊款</b>${esc(d.old)}`;
    drawScreens();
    if (sayIt && a?.say) speak(a.say, true);
  }
  const stateLabel = (s) => ({ ENABLED: '可鎖附', RUNNING: '鎖附中', FAULT: '故障・已鎖定' }[s.tool]
    ?? { WAIT_TRAY: '已鎖定・等承盤', DONE: '完成・已鎖定', WRONG_ZONE: '已鎖定・位置不對', NO_VEHICLE: '待機' }[s.lockReason] ?? '已鎖定');

  function drawScreens() {
    if (!current) return;
    for (const id of ['pd-device-canvas', 'pd-mini']) {
      const c = document.getElementById(id);
      if (c) drawArmScreen(c.getContext('2d'), current.state, 'L');
    }
    document.querySelectorAll('[data-use]').forEach((b) => b.classList.toggle('on', b.dataset.use === st.demo));
  }

  // ── 右側說明 ────────────────────────────────
  function specRows(keys = []) {
    return keys.map((k) => P[k]).filter(Boolean).map((it) => `<dt>${esc(it.label)}</dt><dd>${esc(it.v)}${it.unit ? ` ${esc(it.unit)}` : ''}<span class="chip chip-${it.status}">${STATUS[it.status]}</span></dd>`).join('');
  }
  function renderFeature() {
    const k = st.part;
    const p = ARM_PARTS.find((x) => x.key === k);
    if (!p) {
      const b = BASE[k];
      $('#feature-detail').innerHTML = `
        <div class="feature-head"><span class="fnum base">沿用</span><div><h3>${esc(b.title)}</h3>
          <p class="muted small">工廠原有部件，新舊款相同</p></div></div>
        <div class="feature-vs"><div><p>${esc(b.text)}</p></div></div>`;
    } else {
      $('#feature-detail').innerHTML = `
        <div class="feature-head"><span class="fnum">${NUM[p.n]}</span><div><h3>${esc(p.title)}</h3>
          <div class="pchips">${p.principles.map((n) => `<span class="pchip p${n}">原則${'一二三'[n - 1]}・${PRINCIPLES[n].short}</span>`).join('')}</div></div></div>
        ${k === 'screen' ? '<div class="mini-screen"><canvas id="pd-mini" width="480" height="320" aria-label="手臂螢幕目前畫面"></canvas><a href="#pd-screen" class="link" data-scroll="pd-screen">看手臂螢幕對師傅的作用</a></div>' : ''}
        <div class="feature-vs">
          <div class="vs-old"><i>舊款</i><p>${esc(p.before)}</p></div>
          <div class="vs-new"><i>新款</i><p>${esc(p.what)}</p></div>
        </div>
        ${p.spec?.length ? `<dl class="feature-spec">${specRows(p.spec)}</dl>` : ''}
        <dl class="feature-more"><dt>為什麼這樣設計</dt><dd>${esc(p.why)}</dd><dt>故障時</dt><dd>${esc(p.fault)}</dd></dl>`;
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
  // 「看手臂螢幕的作用」：捲到下方區塊，不改網址 hash（hash 用來切換頁面）
  $('#feature-detail').addEventListener('click', (e) => {
    const a = e.target.closest('[data-scroll]');
    if (!a) return;
    e.preventDefault();
    document.getElementById(a.dataset.scroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

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
  $('#feature-list').innerHTML = ARM_PARTS.map((p) => `<button type="button" data-feature="${p.key}"><span>${NUM[p.n]}</span>${esc(p.title)}</button>`).join('');
  $('#feature-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-feature]');
    if (b) selectPart(b.dataset.feature);
  });
  document.querySelectorAll('[data-pmode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.pmode)));
  $('#product-spin').addEventListener('change', (e) => (controls.autoRotate = e.target.checked));
  $('#product-new').addEventListener('change', renderFeature);
  $('#product-back').addEventListener('click', () => overview());
  $('#demo-list').innerHTML = DEMOS.map((d) => `<button type="button" data-demo="${d.key}">${d.label}</button>`).join('');
  $('#demo-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-demo]');
    if (!b) return;
    unlockAudio();
    st.demo = b.dataset.demo;
    applyDemo(true);
  });

  // 手臂螢幕區塊：作用清單（點了切到那個時刻）
  $('#pd-uses').innerHTML = DEMOS.filter((d) => d.use).map((d, i) => `
    <button type="button" data-use="${d.key}">
      <span class="n">${i + 1}</span>
      <span class="u"><b>${esc(d.use.title)}</b><span>${esc(d.use.see)}</span><em>${esc(d.use.act)}</em></span>
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
  $('#pd-screen-spec').innerHTML = specRows(['screenSize', 'screenBrightness', 'screenRating', 'screenDistance', 'screenMount']);

  // 新舊對照表與尺寸
  $('#product-table').innerHTML = `<thead><tr><th>功能</th><th>舊款（現有手臂）</th><th>新款（IoT 改良）</th></tr></thead><tbody>${
    ARM_PARTS.map((p) => `<tr><th>${NUM[p.n]} ${esc(p.title)}</th><td data-label="舊款">${esc(p.before)}</td><td data-label="新款">${esc(p.what)}</td></tr>`).join('')
  }<tr><th>每顆螺絲履歷</th><td data-label="舊款">沒有紀錄，客訴時查不到是哪一顆。</td><td data-label="新款">每顆的扭力、角度、時間、結果與錯誤分類都留下來，可篩選、匯出。</td></tr></tbody>`;
  $('#product-spec').innerHTML = specRows(['link1', 'link2', 'columnDrop', 'tubeLength', 'toolLength', 'railY']);

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
  const BOLT = { PENDING: 0x4a5568, OK: 0x3ccf6b, NG: 0xe0303a };
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
    // 放大中且部件在動（例如工具移到另一顆螺絲）時，鏡頭跟著部件
    if (st.focused && !tween) {
      const f = arms.iot.getPartFocus(st.focused);
      if (f && f.target.distanceTo(controls.target) > 0.002) {
        const delta = f.target.clone().sub(controls.target);
        controls.target.add(delta);
        camera.position.add(delta);
      }
    }
    if (st.mode === 'plant' && plant && current) {
      plant.env.tray.position.y = -P.trayDrop.v * current.trayPos;
      const s = current.state;
      for (const id of SEQUENCE.L) {
        s.bolts[id].forEach((b, i) => {
          const m = plant.env.bolts[id][i].material;
          m.color.setHex(BOLT[b]);
          m.emissive.setHex(b === 'PENDING' ? 0 : BOLT[b]);
        });
      }
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
  };
}
