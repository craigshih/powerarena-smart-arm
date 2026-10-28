// 「廠房情境」頁（UI 層）：場域模型（powerarena-station-twin）的情境站，裝上改良版手臂。
// 時間軸、1-2-3 流程條、三支攝影機子畫面與標註框都沿用場域模型的做法；
// 懸吊工具換成改良版手臂與會動的師傅，手臂狀態由同一套狀態機依標準流程推進。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { P as TP, ZONES as TZONES } from './twin/params.js';
import { projectBox } from './twin/scene.js';
import { SPEC } from './arm-params.js';
import { createArmLogic } from './arm-logic.js';
import { createSmartArm } from './arm-model.js';
import { buildEnvironment } from './environment.js';
import { createOperator } from './operator.js';

const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// 時間軸：與場域模型相同的 3 分鐘標準作業
const T = { window: TP.detectWindow.v, p1Start: 6, checkpoint: 6 + TP.phase1Duration.v + TP.checkpointLead.v };
T.p1End = T.checkpoint - TP.checkpointLead.v;
T.trayEnd = T.checkpoint + TP.trayDuration.v;
T.p2Start = T.trayEnd + 2;
T.p2End = T.p2Start + TP.phase2Duration.v;

export function createStationView(deps) {
  const { $ } = deps;
  const $$ = (s) => [...document.querySelectorAll(s)];
  const host = $('#st-viewport');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e14);
  const fog = new THREE.Fog(0x0a0e14, 22, 48);
  scene.fog = fog;
  scene.add(new THREE.HemisphereLight(0xbcd3ff, 0x1a1f28, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(6, 12, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004; // 避免陰影痤瘡（表面出現條紋、手和工具上的黑色鋸齒殘影）
  sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
  scene.add(sun);
  const fill = new THREE.PointLight(0xffe2b0, 18, 9);
  fill.position.set(0, 4.3, 1.8);
  scene.add(fill);

  const env = buildEnvironment(scene, { frustums: true, dims: false, tags: true });
  const { station } = env;
  const arms = { L: createSmartArm({ side: 'L', labels: false }), R: createSmartArm({ side: 'R', labels: false }) };
  const ops = { L: createOperator({ side: 'L' }), R: createOperator({ side: 'R' }) };
  scene.add(arms.L, arms.R, ops.L, ops.R);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.domElement.className = 'labels';
  host.appendChild(labels.domElement);

  const view = new THREE.PerspectiveCamera(42, 1, 0.05, 120);
  const controls = new OrbitControls(view, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 1.2;
  controls.maxDistance = 30;

  // ── 視角（與場域模型相同）─────────────────────
  const PRESETS = {
    orbit: { pos: [7.2, 6.2, 8.4], tgt: [0, 1.8, 0.8], fov: 42 },
    top: { pos: [0.01, 11.5, 1.4], tgt: [0, 1.4, 1.2], fov: 40 },
    front: { pos: [0, 4.4, 10.5], tgt: [0, 2.0, 0.6], fov: 40 },
    side: { pos: [10.5, 3.6, 1.2], tgt: [0, 2.0, 1.0], fov: 40 },
    bolts: { pos: [0, 3.65, 3.75], tgt: [0, 2.05, 1.74], fov: 34, hideFrustums: true },
  };
  for (const c of station.cameras) PRESETS[c.cfg.id] = { pos: c.pos.toArray(), tgt: c.tgt.toArray(), fov: c.vfov, cam: c };
  let tween = null;
  let active = 'orbit';
  const fitFov = (base) => {
    const a = view.aspect || 1.6;
    return a >= 1.3 ? base : (2 * Math.atan(Math.tan((base * Math.PI) / 360) * (1.3 / a)) * 180) / Math.PI;
  };
  function goPreset(key, instant = false) {
    const p = PRESETS[key];
    active = key;
    $$('[data-st-preset]').forEach((b) => b.classList.toggle('on', b.dataset.stPreset === key));
    const to = { pos: new THREE.Vector3(...p.pos), tgt: new THREE.Vector3(...p.tgt), fov: p.cam ? p.fov : fitFov(p.fov) };
    station.cameras.forEach((c) => (c.frustum.userData.hiddenByPov = p.cam ? c === p.cam : !!p.hideFrustums));
    if (instant) {
      view.position.copy(to.pos); controls.target.copy(to.tgt); view.fov = to.fov; view.updateProjectionMatrix();
      return;
    }
    tween = { t: 0, from: { pos: view.position.clone(), tgt: controls.target.clone(), fov: view.fov }, to };
  }
  $$('[data-st-preset]').forEach((b) => b.addEventListener('click', () => goPreset(b.dataset.stPreset)));
  controls.addEventListener('start', () => {
    tween = null;
    $$('[data-st-preset]').forEach((b) => b.classList.remove('on'));
    station.cameras.forEach((c) => (c.frustum.userData.hiddenByPov = false));
    active = null;
  });
  goPreset('orbit', true);

  // ── 子畫面 ─────────────────────────────────
  const pipStrip = $('#st-pips');
  const pips = station.cameras.map((c) => {
    const el = document.createElement('figure');
    el.className = 'pip';
    el.style.setProperty('--c', c.hex);
    el.innerHTML = `<div class="pip-frame"><canvas class="pip-overlay"></canvas></div><figcaption><b>${c.cfg.name}</b><span>${c.cfg.distance.v} m · ${c.cfg.bearing.v}°</span></figcaption>`;
    const frame = el.querySelector('.pip-frame');
    const r = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    frame.prepend(r.domElement);
    el.addEventListener('click', () => goPreset(c.cfg.id));
    pipStrip.appendChild(el);
    return { c, el, frame, r, overlay: el.querySelector('.pip-overlay') };
  });

  // ── 工具路徑（同場域模型）與狀態機事件 ──────────────
  const zoneCenter = (id) => {
    const z = station.zones.find((x) => x.cfg.id === id);
    return z.mesh.position.clone();
  };
  function schedule(side) {
    const out = [];
    const lay = (zones, t0, t1) => {
      const seg = (t1 - t0) / zones.length;
      zones.forEach((z, i) => out.push([t0 + i * seg + (i ? 1 : 2), t0 + (i + 1) * seg - 1.5, z]));
    };
    lay(TZONES.filter((z) => z.phase === 1 && z.side === side), T.p1Start, T.p1End);
    lay(TZONES.filter((z) => z.phase === 2 && z.side === side), T.p2Start, T.p2End);
    return out;
  }
  const plans = { L: schedule('L'), R: schedule('R') };
  const rest = {};
  for (const side of ['L', 'R']) {
    arms[side].setToolRest({ instant: true });
    arms[side].updateMatrixWorld(true);
    rest[side] = arms[side].getToolTip(new THREE.Vector3());
  }
  function toolTarget(side, t) {
    const move = 1.6;
    for (const [a, b, z] of plans[side]) {
      const bolt = zoneCenter(z.id).add(new THREE.Vector3(0, 0.03, 0));
      if (t >= a && t <= b) return bolt;
      if (t > b && t < b + move) return bolt.lerp(rest[side], ease((t - b) / move));
      if (t < a && t > a - move) return rest[side].clone().lerp(bolt, ease(1 - (a - t) / move));
    }
    return rest[side].clone();
  }
  // 每側的事件：到位 → 扣扳機 → 回報扭力 → 離開；承盤訊號兩側共用
  const events = { L: [], R: [] };
  for (const side of ['L', 'R']) {
    const ev = events[side];
    ev.push({ t: 1, type: 'cycle:start', trayDueAt: T.checkpoint, vin: 'TWPA2026S00000001', operator: side === 'L' ? 'A1024' : 'A1037' });
    for (const [a, b, z] of plans[side]) {
      ev.push({ t: a, type: 'tool:position', zoneId: z.id });
      ev.push({ t: a + 3, type: 'tool:trigger' });
      ev.push({ t: a + 5, type: 'tool:torque', torqueNm: SPEC[z.id].torque.v * (side === 'L' ? 1.01 : 0.99), angleDeg: 64 });
      ev.push({ t: b + 0.5, type: 'tool:position', zoneId: null });
    }
    ev.push({ t: T.checkpoint, type: 'tray:lowering' }, { t: T.trayEnd, type: 'tray:lowered' });
    ev.sort((x, y) => x.t - y.t);
  }
  let logic = null;
  let logicT = -1;
  let idx = { L: 0, R: 0 };
  const states = {};
  function stateAt(t) {
    if (!logic || t < logicT) {
      logic = {
        L: createArmLogic({ side: 'L', stationEvents: true, epoch: Date.parse('2026-10-27T08:00:00+08:00') }),
        R: createArmLogic({ side: 'R', stationEvents: false, epoch: Date.parse('2026-10-27T08:00:00+08:00') }),
      };
      idx = { L: 0, R: 0 };
    }
    for (const side of ['L', 'R']) {
      const ev = events[side];
      while (idx[side] < ev.length && ev[idx[side]].t <= t) states[side] = logic[side].dispatch(ev[idx[side]++]).state;
      states[side] = logic[side].dispatch({ type: 'timer', t }).state;
    }
    logicT = t;
    return states;
  }

  function phaseAt(t) {
    if (t < T.p1Start) return { key: 'ready', label: '待命', tone: 'muted' };
    if (t < T.p1End) return { key: 'A', label: '1｜鎖下方螺絲', tone: 'orange' };
    if (t < T.checkpoint) return { key: 'gate', label: '檢查點前緩衝', tone: 'yellow' };
    if (t < T.trayEnd) return { key: 'B', label: '2｜承盤下降', tone: 'yellow' };
    if (t < T.p2Start) return { key: 'gate2', label: '承盤到位', tone: 'muted' };
    if (t < T.p2End) return { key: 'C', label: '3｜鎖上方螺絲', tone: 'teal' };
    return { key: 'done', label: '本段完成', tone: 'green' };
  }
  function stepState(step, t) {
    const span = { 1: [T.p1Start, T.p1End], 2: [T.checkpoint, T.trayEnd], 3: [T.p2Start, T.p2End] }[step];
    if (t >= span[1]) return 'done';
    if (t >= span[0]) return 'now';
    return 'todo';
  }

  // ── 時間軸 ─────────────────────────────────
  let simT = 0;
  let playing = true;
  let speed = 4;
  const slider = $('#st-slider');
  slider.max = T.window;
  const track = $('#st-track');
  for (const [a, b, tone, txt] of [[T.p1Start, T.p1End, 'orange', '1 下方螺絲'], [T.checkpoint, T.trayEnd, 'yellow', '2 承盤下降'], [T.p2Start, T.p2End, 'teal', '3 上方螺絲']]) {
    const s = document.createElement('span');
    s.className = `tseg tseg-${tone}`;
    s.style.left = `${(a / T.window) * 100}%`;
    s.style.width = `${((b - a) / T.window) * 100}%`;
    const [n, ...words] = txt.split(' ');
    s.innerHTML = `<em>${n}<span> ${words.join(' ')}</span></em>`;
    track.appendChild(s);
  }
  const cp = document.createElement('span');
  cp.className = 'checkpoint';
  cp.style.left = `${(T.checkpoint / T.window) * 100}%`;
  track.appendChild(cp);
  const playBtn = $('#st-play');
  const syncPlay = () => { playBtn.classList.toggle('paused', !playing); playBtn.setAttribute('aria-label', playing ? '暫停' : '播放'); };
  playBtn.addEventListener('click', () => { playing = !playing; syncPlay(); });
  slider.addEventListener('input', () => { simT = +slider.value; });
  $$('[data-st-speed]').forEach((b) => b.addEventListener('click', () => {
    speed = +b.dataset.stSpeed;
    $$('[data-st-speed]').forEach((x) => x.classList.toggle('on', x === b));
  }));

  // ── 圖層 ───────────────────────────────────
  const narrow = matchMedia('(max-width: 767px)').matches;
  const layerState = { frustums: true, zones: true, dims: false, rail: true, labels: !narrow, bbox: true };
  const applyLayer = (k) => {
    if (k === 'labels') env.setTags(layerState.labels, true);
    else if (k !== 'bbox') env.setLayer(k, layerState[k]);
  };
  Object.keys(layerState).forEach(applyLayer);
  $$('[data-st-layer]').forEach((input) => {
    input.checked = layerState[input.dataset.stLayer];
    input.addEventListener('change', () => {
      layerState[input.dataset.stLayer] = input.checked;
      applyLayer(input.dataset.stLayer);
    });
  });

  // ── 點選物件 ─────────────────────────────────
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downAt = null;
  const pickables = [...env.pickables, ...arms.L.pickables, ...arms.R.pickables];
  renderer.domElement.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, view);
    const hit = ray.intersectObjects(pickables.filter((o) => {
      for (let p = o; p; p = p.parent) if (!p.visible) return false;
      return true;
    }), false)[0];
    const info = hit?.object.userData.info;
    const box = $('#st-info');
    if (!info) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<button type="button" class="st-info-x" aria-label="關閉">×</button><b>${info.title}</b>
      <dl>${(info.rows || []).slice(0, 4).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
  });
  $('#st-info').addEventListener('click', (e) => { if (e.target.closest('.st-info-x')) $('#st-info').hidden = true; });

  // ── 標註框（同場域模型）──────────────────────
  // 工具的標註框用一個跟著套筒走的隱形方塊，避免框到整支手臂
  const toolProbe = { L: new THREE.Group(), R: new THREE.Group() };
  for (const side of ['L', 'R']) {
    toolProbe[side].add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.38, 0.12), new THREE.MeshBasicMaterial({ visible: false })));
    scene.add(toolProbe[side]);
  }
  const bboxTargets = [
    ...['L', 'R'].map((s) => ({ obj: toolProbe[s], cls: 'tool', color: '#f2c230' })),
    ...['L', 'R'].map((s) => ({ obj: ops[s], cls: 'person', color: '#c7d2fe' })),
    { obj: station.tray, cls: 'tray', color: '#ff8a3d', skip: (c) => c.cfg.id !== 'RIGHT' },
  ];
  function drawOverlay(p) {
    const ctx = p.overlay.getContext('2d');
    const W = p.overlay.width;
    const H = p.overlay.height;
    ctx.clearRect(0, 0, W, H);
    if (!layerState.bbox) return;
    const s = W / 320;
    ctx.lineWidth = Math.max(1.5, 1.5 * s);
    ctx.font = `600 ${Math.round(10 * s)}px ui-monospace, monospace`;
    for (const b of bboxTargets) {
      if (b.skip && b.skip(p.c)) continue;
      const r = projectBox(b.obj, p.c.cam);
      if (!r || r.w * r.h < 0.0004) continue;
      ctx.strokeStyle = b.color;
      ctx.strokeRect(r.x * W, r.y * H, r.w * W, r.h * H);
      const tw = ctx.measureText(b.cls).width + 6 * s;
      ctx.fillStyle = b.color;
      ctx.fillRect(r.x * W, r.y * H - 13 * s, tw, 13 * s);
      ctx.fillStyle = '#0a0e14';
      ctx.fillText(b.cls, r.x * W + 3 * s, r.y * H - 3 * s);
    }
  }

  // ── 尺寸 ───────────────────────────────────
  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    labels.setSize(w, h);
    view.aspect = w / h;
    const p = active && PRESETS[active];
    if (p && !p.cam && !tween) view.fov = fitFov(p.fov);
    view.updateProjectionMatrix();
    for (const pp of pips) {
      const fw = pp.frame.clientWidth;
      const fh = pp.frame.clientHeight;
      if (!fw || !fh) continue;
      pp.r.setSize(fw, fh, false);
      pp.overlay.width = fw * Math.min(devicePixelRatio, 2);
      pp.overlay.height = fh * Math.min(devicePixelRatio, 2);
    }
  }
  new ResizeObserver(resize).observe(host);
  new ResizeObserver(resize).observe(pipStrip);

  // ── 每幀 ───────────────────────────────────
  let frameNo = 0;
  let lastPhase = '';
  const log = $('#st-log');
  function pushLog(text, tone) {
    const li = document.createElement('li');
    li.className = `lv-${tone}`;
    li.innerHTML = `<time>${fmt(simT)}</time><span>${text}</span>`;
    log.prepend(li);
    while (log.children.length > 6) log.lastChild.remove();
  }
  const toolText = (s) => ({ ENABLED: '可鎖附', RUNNING: '鎖附中' }[s.tool] ?? '已鎖定');
  function frame(dt, time) {
    if (playing) {
      simT += dt * speed;
      if (simT > T.window) { simT = 0; lastPhase = ''; log.innerHTML = ''; }
    }
    const t = simT;
    const st = stateAt(t);
    const ph = phaseAt(t);
    for (const el of $$('#st-flow [data-step]')) el.dataset.state = stepState(+el.dataset.step, t);
    station.tray.position.y = -ease(THREE.MathUtils.clamp((t - T.checkpoint) / TP.trayDuration.v, 0, 1)) * TP.trayDrop.v;

    for (const side of ['L', 'R']) {
      const target = toolTarget(side, t);
      arms[side].setToolTarget(target);
      arms[side].setState(st[side]);
      arms[side].update(dt, time);
      toolProbe[side].position.copy(arms[side].getToolTip(new THREE.Vector3())).add(new THREE.Vector3(0, 0.19, 0));
      const working = target.distanceTo(rest[side]) > 0.05;
      ops[side].update(dt, time, {
        mode: working ? 'work' : 'wait',
        grip: working ? arms[side].getGrip() : null,
        top: working ? arms[side].getToolTop() : null,
      });
    }
    env.paintBolts(st, time);
    const blinkYellow = ph.key === 'B' || ph.key === 'gate';
    env.setAndon(blinkYellow ? 1 : -1, time);

    if (ph.key !== lastPhase) {
      if (lastPhase) pushLog(ph.label, ph.tone === 'teal' ? 'ok' : ph.tone === 'orange' ? 'warn' : 'info');
      lastPhase = ph.key;
    }
    $('#st-phase').textContent = ph.label;
    $('#st-phase').dataset.tone = ph.tone;
    const toCp = T.checkpoint - t;
    $('#st-cp').textContent = toCp > 0 ? `${toCp.toFixed(0)} 秒` : '已通過';
    $('#st-tool').textContent = `L ${toolText(st.L)} · R ${toolText(st.R)}`;
    $('#st-time').textContent = `${fmt(t)} / ${fmt(T.window)}`;
    slider.value = t;

    if (tween) {
      tween.t = Math.min(tween.t + dt / 0.9, 1);
      const k = ease(tween.t);
      view.position.lerpVectors(tween.from.pos, tween.to.pos, k);
      controls.target.lerpVectors(tween.from.tgt, tween.to.tgt, k);
      view.fov = THREE.MathUtils.lerp(tween.from.fov, tween.to.fov, k);
      view.updateProjectionMatrix();
      if (tween.t >= 1) tween = null;
    }
    controls.update();
    for (const c of station.cameras) {
      c.frustum.visible = layerState.frustums && !c.frustum.userData.hiddenByPov;
      c.body.visible = !c.frustum.userData.hiddenByPov;
    }
    renderer.render(scene, view);
    labels.render(scene, view);

    // 子畫面隔幀更新；子畫面內不畫視錐與標註線
    if (frameNo++ % 2 === 0) {
      const vis = { f: station.layers.frustums.visible, d: station.layers.dims.visible };
      station.layers.frustums.visible = false;
      station.layers.dims.visible = false;
      scene.fog = null;
      for (const p of pips) {
        const was = p.c.body.visible;
        p.c.body.visible = false;
        p.r.render(scene, p.c.cam);
        p.c.body.visible = was;
        drawOverlay(p);
      }
      scene.fog = fog;
      station.layers.frustums.visible = vis.f;
      station.layers.dims.visible = vis.d;
    }
  }

  resize();
  return {
    frame,
    resize,
    pause() { playing = false; syncPlay(); },
    play() { playing = true; syncPlay(); },
  };
}
