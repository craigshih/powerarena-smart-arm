// 「手臂螢幕」展示頁（UI 層）。
// 上方：廠房裡的師傅肩後視角（3D）＋ 螢幕實機放大，兩者同步播放情境。
// 下方：螢幕給師傅的作用（用同一套狀態機跑到指定時刻、截下螢幕畫面）。
// 螢幕畫面一律由 arm-model 的 drawArmScreen 繪製，與 3D 模型上的螢幕完全一致。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { P, boltPosition } from './arm-params.js';
import { createSmartArm, drawArmScreen } from './arm-model.js';
import { SCENARIOS, scenarioById, createRun } from './scenarios.js';
import { buildEnvironment, addFactoryBackdrop } from './environment.js';
import { createOperator } from './operator.js';
import { createAlertFx } from './alert-fx.js';

// 螢幕給師傅的作用：情境、時刻（秒）、側
export const USES = [
  { id: 'normal', t: 9.5, title: '知道現在該鎖哪一顆', see: '大字步驟 A；白框標出下一顆是左引擎腳第 3 顆。', act: '照白框鎖，不用靠記憶記順序。', p: [1] },
  { id: 'timeout', t: 30, title: '知道還剩多少時間', see: '右上角倒數變黃，底部提示「第一階段剩 13 秒」。', act: '加快完成這一階段，不必抬頭找時鐘。', p: [1] },
  { id: 'ng', t: 9.6, title: '鎖不好，當場知道是哪一顆', see: '整面變紅：「扭力不足 52 N·m」，紅點就是那一顆。', act: '原地重鎖；合格後紅點變綠才往下。', p: [2] },
  { id: 'early', t: 31, title: '被攔下時，知道為什麼', see: '「提前鎖附！承盤尚未下降」→「放開扳機，等承盤降下」。', act: '放開扳機等承盤，不會以為工具壞了。', p: [1, 2] },
  { id: 'automation', t: 55, title: '不是自己的錯，也看得出來', see: '「承盤下降逾時」→「不用處理，等班長復歸承盤」。', act: '照常等待；班長收到通知到場處理。', p: [3] },
  { id: 'normal', t: 60, title: '鎖完確認，安心放手', see: '「本車完成」，這一側每顆都是綠點。', act: '放回工具，等下一台車。', p: [1] },
];

const PCHIP = { 1: '原則一・不增加動作', 2: '原則二・從工具思考', 3: '原則三・妥善率' };
const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// 跑到某個時刻的狀態（靜音、不播動畫）
function stateAt(id, t, side, spec) {
  const run = createRun(scenarioById(id), { encoder: true, spec, vin: 'TWPA2026D00000001', epoch: Date.parse('2026-10-22T08:00:00+08:00') });
  for (let x = 0; x < t; x += 0.25) run.advance(Math.min(x + 0.25, t));
  return run.states[side];
}

export function createScreenView(deps) {
  const { $, esc, speak, chime, unlockAudio, getSpec } = deps;

  // ── 3D：廠房裡的師傅肩後視角 ─────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b2028);
  scene.fog = new THREE.Fog(0x1b2028, 9, 26);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2f38, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(3, 10, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 25 });
  scene.add(sun);
  const env = buildEnvironment(scene);
  addFactoryBackdrop(scene);
  const arms = { L: createSmartArm({ side: 'L', labels: false }), R: createSmartArm({ side: 'R', labels: false }) };
  const ops = { L: createOperator({ side: 'L' }), R: createOperator({ side: 'R' }) };
  scene.add(arms.L, arms.R, ops.L, ops.R);
  const fx = createAlertFx(scene);

  const host = $('#pov-view');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.domElement.className = 'labels';
  host.appendChild(labels.domElement);
  const camera = new THREE.PerspectiveCamera(46, 1, 0.05, 80);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 0.5;
  controls.maxDistance = 10;
  // 從師傅肩膀後方、略高的位置看：手、工具與手臂螢幕都在畫面裡
  const CAM = {
    L: { pos: [2.25, 4.05, 3.75], tgt: [0.55, 2.75, 1.4] },
    R: { pos: [-2.25, 4.05, 3.75], tgt: [-0.55, 2.75, 1.4] },
  };

  // ── 螢幕實機 ─────────────────────────────
  const device = $('#device-canvas');
  const dctx = device.getContext('2d');
  let deviceKey = '';

  const st = { id: 'normal', side: 'L', run: null, playing: false, speed: 2 };

  function setCamera(side) {
    camera.position.set(...CAM[side].pos);
    controls.target.set(...CAM[side].tgt);
    controls.update();
  }

  const toolPoint = (t) => new THREE.Vector3(...boltPosition(t.zoneId, t.boltIndex)).add(new THREE.Vector3(0, 0.03, 0));

  function apply(out, silent) {
    fx.onRecords(out.records, { pops: !silent });
    for (const m of out.moves) {
      if (m.target) arms[m.side].setToolTarget(toolPoint(m.target));
      else arms[m.side].setToolRest();
    }
    for (const a of out.alerts) {
      ops[a.side].say(`「${a.say || a.text}」`, a.level === 'info' ? 'info' : 'voice', 3.2);
      if (!silent && a.side === st.side) {
        if (a.level !== 'info') chime(a.level);
        speak(a.say, a.level === 'alarm' || a.level === 'fault');
      }
    }
    for (const side of ['L', 'R']) arms[side].setState(st.run.states[side]);
  }

  function load(id, { autoplay = false, at = 0 } = {}) {
    st.id = id;
    st.run = createRun(scenarioById(id), { encoder: true, spec: getSpec(), vin: 'TWPA2026D00000001', epoch: Date.now() });
    fx.reset();
    for (const side of ['L', 'R']) { arms[side].setToolRest({ instant: true }); ops[side].say(''); }
    for (let x = 0; x < at; x += 0.25) apply(st.run.advance(Math.min(x + 0.25, at)), true);
    apply(st.run.advance(st.run.t), true);
    for (const side of ['L', 'R']) {
      const t = st.run.targets[side];
      if (t) arms[side].setToolTarget(toolPoint(t), { instant: true });
    }
    $('#pov-scenario').value = id;
    deviceKey = '';
    st.playing = autoplay;
    sync();
  }

  function sync() {
    $('#pov-play').textContent = st.playing ? '暫停' : '播放';
    document.querySelectorAll('[data-pov-side]').forEach((b) => b.classList.toggle('on', b.dataset.povSide === st.side));
    $('#device-side').textContent = st.side === 'L' ? '左側手臂' : '右側手臂';
  }

  function drawDevice() {
    const s = st.run.states[st.side];
    const key = JSON.stringify([st.side, s.phase, s.tray, s.tool, s.lockReason, s.alarm?.type, s.alarm?.text, s.bolts, s.expected, s.remaining == null ? null : Math.ceil(s.remaining)]);
    if (key === deviceKey) return;
    deviceKey = key;
    drawArmScreen(dctx, s, st.side);
  }

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
    if (st.playing) {
      apply(st.run.advance(st.run.t + dt * st.speed), false);
      if (st.run.done) { st.playing = false; sync(); }
    }
    const run = st.run;
    env.tray.position.y = -P.trayDrop.v * run.trayPos;
    for (const side of ['L', 'R']) {
      arms[side].update(dt, time);
      const target = run.targets[side];
      const a = run.states[side].alarm;
      ops[side].update(dt, time, {
        mode: target ? 'work' : 'wait',
        grip: target ? arms[side].getGrip() : null,
        top: target ? arms[side].getToolTop() : null,
        react: a && a.level !== 'info' && run.t - a.at < 2.5 ? arms[side].getControllerPos() : null,
      });
    }
    fx.update(dt, time, { states: run.states, arms, tray: env.tray });
    if (host.dataset.fx !== fx.mood) host.dataset.fx = fx.mood;
    renderer.render(scene, camera);
    labels.render(scene, camera);
    drawDevice();
    $('#pov-fill').style.width = `${(run.t / run.duration) * 100}%`;
    $('#pov-time').textContent = `${fmtT(run.t)} / ${fmtT(run.duration)}`;
  }

  // ── 作用卡片（靜態截圖）────────────────────────
  function renderUses() {
    const spec = getSpec();
    $('#uses').innerHTML = USES.map((u, i) => `
      <article class="use">
        <div class="use-shot"><canvas width="480" height="320" data-use="${i}"></canvas></div>
        <div class="use-body">
          <h4><span class="n">${i + 1}</span>${esc(u.title)}</h4>
          <dl><dt>師傅看到</dt><dd>${esc(u.see)}</dd><dt>師傅怎麼做</dt><dd>${esc(u.act)}</dd></dl>
          <div class="use-foot">${u.p.map((n) => `<span class="pchip p${n}">${PCHIP[n]}</span>`).join('')}
            <button class="link" type="button" data-use-play="${i}">在上面播放這一段</button></div>
        </div>
      </article>`).join('');
    USES.forEach((u, i) => {
      const c = $(`canvas[data-use="${i}"]`);
      drawArmScreen(c.getContext('2d'), stateAt(u.id, u.t, 'L', spec), 'L');
    });
  }

  // ── 控制 ─────────────────────────────────
  $('#pov-scenario').innerHTML = SCENARIOS.map((s, i) => `<option value="${s.id}">${i + 1}. ${s.title}</option>`).join('');
  $('#pov-scenario').addEventListener('change', (e) => { unlockAudio(); load(e.target.value, { autoplay: true }); });
  $('#pov-play').addEventListener('click', () => {
    unlockAudio();
    if (st.run.done) load(st.id, { autoplay: true });
    else { st.playing = !st.playing; sync(); }
  });
  $('#pov-restart').addEventListener('click', () => { unlockAudio(); load(st.id, { autoplay: true }); });
  for (const b of document.querySelectorAll('[data-pov-side]')) {
    b.addEventListener('click', () => { st.side = b.dataset.povSide; setCamera(st.side); deviceKey = ''; sync(); });
  }
  $('#device-full').addEventListener('click', () => {
    const el = $('#device');
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => {});
  });
  $('#device-notes').addEventListener('change', (e) => $('#device').classList.toggle('notes', e.target.checked));
  $('#uses').addEventListener('click', (e) => {
    const b = e.target.closest('[data-use-play]');
    if (!b) return;
    const u = USES[+b.dataset.usePlay];
    unlockAudio();
    if (st.side !== 'L') { st.side = 'L'; setCamera('L'); }
    load(u.id, { autoplay: true, at: Math.max(0, u.t - 3) });
    $('#pov-stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // 規格（假設值，來自參數檔）
  $('#screen-spec').innerHTML = ['screenSize', 'screenBrightness', 'screenRating', 'screenDistance', 'screenMount']
    .map((k) => `<dt>${esc(P[k].label)}</dt><dd>${esc(P[k].v)}${P[k].unit ? ` ${esc(P[k].unit)}` : ''}<span class="chip chip-assumed">假設</span><small>${esc(P[k].note)}</small></dd>`).join('');

  setCamera('L');
  renderUses();
  load('normal', { at: 9.5 });
  return {
    frame,
    resize,
    refresh() { renderUses(); },
    pause() { st.playing = false; sync(); },
  };
}
