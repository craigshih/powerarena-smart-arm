// 「手臂介紹」頁（UI 層）：只有手臂本身，放在攝影棚式的展示台上。
// 以新款（含手臂螢幕）為主，可切舊款、或兩支並排對比；點編號看每個新功能；
// 下方的狀態按鈕把新舊兩支手臂切到同一個時刻，看工具、燈號與螢幕的差別。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { P, armMount, boltPosition } from './arm-params.js';
import { createSmartArm, ARM_PARTS, PRINCIPLES } from './arm-model.js';
import { scenarioById, createRun } from './scenarios.js';

const NUM = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
const NEW_KEYS = ARM_PARTS.map((p) => p.key);
const HANG_Y = P.railY.v;

// 狀態示範：情境、時刻（秒）；舊款同一時刻會怎樣
export const DEMOS = [
  { key: 'ready', label: '可鎖附', id: 'normal', t: 9.5, old: '隨時可轉，沒有任何提示', oldRun: false },
  { key: 'running', label: '鎖附中', id: 'normal', t: 8.0, old: '鎖附中，但不回報扭力', oldRun: true },
  { key: 'wait', label: '等承盤', id: 'normal', t: 30, old: '仍然能轉：這時候鎖下去就是提前鎖附', oldRun: false },
  { key: 'early', label: '提前鎖附', id: 'early', t: 31, old: '工具照轉，車身固定點提前鎖上', oldRun: true },
  { key: 'ng', label: '扭力不足', id: 'ng', t: 9.6, old: '沒有量測，被當成鎖好了', oldRun: false },
  { key: 'fault', label: '工具故障', id: 'tool', t: 9, old: '停了也沒紀錄，不知道這顆有沒有鎖到位', oldRun: false },
  { key: 'done', label: '本車完成', id: 'normal', t: 60, old: '沒有完成確認', oldRun: false },
];

function demoAt(d, spec) {
  const run = createRun(scenarioById(d.id), { encoder: true, spec, vin: 'TWPA2026E00000001', epoch: Date.parse('2026-10-24T08:00:00+08:00') });
  for (let x = 0; x < d.t; x += 0.25) run.advance(Math.min(x + 0.25, d.t));
  return { state: run.states.L, target: run.targets.L };
}

export function createProductView(deps) {
  const { $, esc, speak, getSpec } = deps;
  const host = $('#product-view');

  // ── 攝影棚 ─────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x18202b);
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
  const floorY = P.platformHeight.v;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3.2, 64), new THREE.MeshStandardMaterial({ color: 0x1b222d, roughness: 0.6, metalness: 0.2 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY;
  floor.receiveShadow = true;
  scene.add(floor);
  for (const r of [1.2, 2.0, 2.8]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.008, 96), new THREE.MeshBasicMaterial({ color: 0x2a3446 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = floorY + 0.002;
    scene.add(ring);
  }

  // 一段上方軌道（工廠原有），手臂掛在上面
  const railMat = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5, metalness: 0.2 });
  function makeRail(x) {
    const g = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 3.6), railMat);
    beam.position.set(x, HANG_Y + 0.06, 0.6);
    beam.castShadow = true;
    g.add(beam);
    scene.add(g);
    return g;
  }

  // 兩支手臂：舊款與新款（新款含手臂螢幕）
  const arms = {
    old: createSmartArm({ side: 'L', legacy: true, mount: false }),
    iot: createSmartArm({ side: 'L', labels: true, mount: false }),
  };
  const rails = { old: makeRail(0), iot: makeRail(0) };
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

  // 展示姿勢：工具停在左引擎腳上方（相對吊點的位移）
  const mount = new THREE.Vector3(...armMount('L'));
  const POSE = new THREE.Vector3(...boltPosition('Z1L', 1)).sub(mount).add(new THREE.Vector3(0, 0.12, -0.25));
  function poseFor(arm, target) {
    const local = target ? new THREE.Vector3(...boltPosition(target.zoneId, target.boltIndex)).sub(mount).add(new THREE.Vector3(0, 0.03, 0)) : POSE;
    arm.setToolTarget(arm.position.clone().add(local));
  }

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
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 50);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.2;
  controls.maxDistance = 9;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.8;
  controls.addEventListener('start', () => { controls.autoRotate = false; $('#product-spin').checked = false; });

  const st = { mode: 'iot', part: 'screen', demo: 'ready' };

  // 模式：新款、舊款、並排對比
  function setMode(mode) {
    st.mode = mode;
    const both = mode === 'both';
    arms.old.visible = mode !== 'iot';
    arms.iot.visible = mode !== 'old';
    rails.old.visible = arms.old.visible;
    rails.iot.visible = arms.iot.visible;
    const xs = both ? { old: -0.75, iot: 0.95 } : { old: 0.3, iot: 0.3 };
    for (const k of ['old', 'iot']) {
      arms[k].tags.forEach((t) => (t.visible = arms[k].visible)); // CSS2D 標籤不會跟著父物件隱藏
      arms[k].position.set(xs[k], HANG_Y, 0);
      rails[k].position.x = xs[k];
      titles[k].visible = both && arms[k].visible;
      titles[k].position.set(xs[k], HANG_Y + 0.42, 0.6);
    }
    applyDemo(false);
    for (const k of ['old', 'iot']) arms[k].setToolTarget(arms[k].position.clone().add(currentLocal[k]), { instant: true });
    // 整支手臂（軌道到工具）都要入鏡：高約 2.6 m
    if (both) {
      camera.position.set(3.4, 4.35, 5.0);
      controls.target.set(0.1, 3.0, 0.65);
    } else {
      camera.position.set(2.95, 4.15, 3.95);
      controls.target.set(0.05, 3.0, 0.65);
    }
    controls.update();
    document.querySelectorAll('[data-pmode]').forEach((b) => b.classList.toggle('on', b.dataset.pmode === mode));
    $('#product-view').classList.toggle('show-tags', mode !== 'old');
    renderFeature();
  }

  // 狀態示範（兩支手臂切到同一時刻）
  const currentLocal = { old: POSE.clone(), iot: POSE.clone() };
  let demoCache = new Map();
  function applyDemo(sayIt = true) {
    const d = DEMOS.find((x) => x.key === st.demo);
    if (!demoCache.has(d.key)) demoCache.set(d.key, demoAt(d, getSpec()));
    const { state, target } = demoCache.get(d.key);
    arms.iot.setState(state);
    arms.old.setState({ tool: d.oldRun ? 'RUNNING' : 'ENABLED' });
    for (const k of ['old', 'iot']) {
      currentLocal[k] = target ? new THREE.Vector3(...boltPosition(target.zoneId, target.boltIndex)).sub(mount).add(new THREE.Vector3(0, 0.03, 0)) : POSE.clone();
      poseFor(arms[k], target);
    }
    document.querySelectorAll('[data-demo]').forEach((b) => b.classList.toggle('on', b.dataset.demo === d.key));
    const a = state.alarm && state.alarm.level !== 'info' ? state.alarm : null;
    $('#demo-iot').innerHTML = `<b>新款</b>工具${esc(stateLabel(state))}${a ? `，廣播「${esc(a.say || a.text)}」` : ''}`;
    $('#demo-old').innerHTML = `<b>舊款</b>${esc(d.old)}`;
    if (sayIt && a?.say) speak(a.say, true);
  }
  const stateLabel = (s) => ({ ENABLED: '可鎖附', RUNNING: '鎖附中', FAULT: '故障・已鎖定' }[s.tool]
    ?? { WAIT_TRAY: '已鎖定・等承盤', DONE: '完成・已鎖定', WRONG_ZONE: '已鎖定・位置不對', NO_VEHICLE: '待機' }[s.lockReason] ?? '已鎖定');

  // 功能說明
  function renderFeature() {
    const p = ARM_PARTS.find((x) => x.key === st.part);
    $('#feature-detail').innerHTML = `
      <div class="feature-head"><span class="fnum">${NUM[p.n]}</span><div><h3>${esc(p.title)}</h3>
        <div class="pchips">${p.principles.map((n) => `<span class="pchip p${n}">原則${'一二三'[n - 1]}・${PRINCIPLES[n].short}</span>`).join('')}</div></div></div>
      <div class="feature-vs">
        <div class="vs-old"><i>舊款</i><p>${esc(p.before)}</p></div>
        <div class="vs-new"><i>新款</i><p>${esc(p.what)}</p></div>
      </div>
      <dl class="feature-more"><dt>為什麼這樣設計</dt><dd>${esc(p.why)}</dd><dt>故障時</dt><dd>${esc(p.fault)}</dd></dl>`;
    document.querySelectorAll('[data-feature]').forEach((b) => b.classList.toggle('on', b.dataset.feature === st.part));
    arms.iot.highlight($('#product-new').checked ? NEW_KEYS : st.part);
  }
  function selectPart(k) {
    st.part = k;
    renderFeature();
  }

  // 3D 上的編號標籤可以直接點
  for (const t of arms.iot.tags) {
    const k = t.element.dataset.part;
    if (!k) continue;
    t.element.addEventListener('click', () => selectPart(k));
  }

  $('#feature-list').innerHTML = ARM_PARTS.map((p) => `<button type="button" data-feature="${p.key}"><span>${NUM[p.n]}</span>${esc(p.title)}</button>`).join('');
  $('#feature-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-feature]');
    if (b) selectPart(b.dataset.feature);
  });
  document.querySelectorAll('[data-pmode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.pmode)));
  $('#product-spin').addEventListener('change', (e) => (controls.autoRotate = e.target.checked));
  $('#product-new').addEventListener('change', renderFeature);
  $('#demo-list').innerHTML = DEMOS.map((d) => `<button type="button" data-demo="${d.key}">${d.label}</button>`).join('');
  $('#demo-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-demo]');
    if (!b) return;
    deps.unlockAudio();
    st.demo = b.dataset.demo;
    applyDemo(true);
  });

  // 新舊對照表與部件清單
  $('#product-table').innerHTML = `<thead><tr><th>功能</th><th>舊款（現有手臂）</th><th>新款（IoT 改良）</th></tr></thead><tbody>${
    ARM_PARTS.map((p) => `<tr><th>${NUM[p.n]} ${esc(p.title)}</th><td data-label="舊款">${esc(p.before)}</td><td data-label="新款">${esc(p.what)}</td></tr>`).join('')
  }<tr><th>每顆螺絲履歷</th><td data-label="舊款">沒有紀錄，客訴時查不到是哪一顆。</td><td data-label="新款">每顆的扭力、角度、時間、結果與錯誤分類都留下來，可篩選、匯出。</td></tr></tbody>`;
  const geo = ['link1', 'link2', 'columnDrop', 'tubeLength', 'toolLength', 'railY'];
  $('#product-spec').innerHTML = geo.map((k) => `<dt>${esc(P[k].label)}</dt><dd>${P[k].v} ${esc(P[k].unit)}<span class="chip chip-${P[k].status}">${{ confirmed: '已確認', derived: '推算', assumed: '假設' }[P[k].status]}</span></dd>`).join('');

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

  function frame(dt, time) {
    controls.update();
    arms.old.update(dt, time);
    arms.iot.update(dt, time);
    renderer.render(scene, camera);
    labels.render(scene, camera);
  }

  setMode('iot');
  applyDemo(false);
  return {
    frame,
    resize,
    refresh() { demoCache = new Map(); applyDemo(false); },
  };
}
