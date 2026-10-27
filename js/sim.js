// 「現行 vs IoT」實境對比（UI 層）。
// 同一位師傅、同一段動作同時播放兩次：左邊是現行手臂（工具隨時能轉、沒有回饋與紀錄），
// 右邊是連上 IoT 的改良手臂（狀態機控制致能與鎖定）。
// 現行手臂沒有自己的狀態機：IoT 狀態機攔下或判定的每一件事，在現行手臂上就是「沒被發現的問題」。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { P, SEQUENCE, zoneById, boltPosition } from './arm-params.js';
import { createSmartArm } from './arm-model.js';
import { SCENARIOS, scenarioById, createRun } from './scenarios.js';
import { buildEnvironment } from './environment.js';
import { createOperator } from './operator.js';
import { createAlertFx } from './alert-fx.js';

// 現行手臂上同一時刻會發生什麼（依訪綱理解，待業主確認）
const LEGACY_TEXT = {
  EARLY_ATTEMPT: '工具照轉：承盤還撐著就把上方螺絲鎖上了，沒有任何提示',
  TIGHTEN_NG: '沒有量測：扭力不足的這一顆被當成鎖好了',
  SEQUENCE_ERROR: '先鎖上方也鎖得下去，沒有人知道',
  PHASE_WARNING: '沒有倒數提醒',
  TIMEOUT: '沒有人知道已經超時，事後也查不到',
  AUTOMATION_FAULT: '承盤卡住，但工具仍然能轉；以為承盤降了就開始鎖，等於提前鎖附',
  TOOL_FAULT: '工具停了，這一顆有沒有鎖到位沒有紀錄',
};

const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function makeWorld(legacy) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(legacy ? 0x0b0d11 : 0x0a0e14);
  scene.fog = new THREE.Fog(scene.background, 12, 30);
  scene.add(new THREE.HemisphereLight(0xbcd3ff, 0x1a1f28, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(5, 11, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 30 });
  scene.add(sun);
  const fill = new THREE.PointLight(0xffe2b0, 14, 8);
  fill.position.set(0, 4.2, 2);
  scene.add(fill);
  const env = buildEnvironment(scene);
  const arms = { L: createSmartArm({ side: 'L', labels: false, legacy }), R: createSmartArm({ side: 'R', labels: false, legacy }) };
  const ops = { L: createOperator({ side: 'L' }), R: createOperator({ side: 'R' }) };
  scene.add(arms.L, arms.R, ops.L, ops.R);
  return { scene, env, arms, ops };
}

export function createSim(deps) {
  const { $, esc, speak, chime, unlockAudio, getSpec } = deps;
  const worlds = { old: makeWorld(true), iot: makeWorld(false) };
  const fx = createAlertFx(worlds.iot.scene); // 只有 IoT 手臂有示警；現行手臂什麼都沒有
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 60);
  // 從師傅肩膀後方看：師傅的手、工具、手臂螢幕與螺絲都在畫面裡
  const SIDE_CAM = {
    L: { pos: [1.45, 3.65, 4.0], tgt: [0.8, 2.55, 1.5] },
    R: { pos: [-1.45, 3.65, 4.0], tgt: [-0.8, 2.55, 1.5] },
  };
  const target = new THREE.Vector3(...SIDE_CAM.L.tgt);
  camera.position.set(...SIDE_CAM.L.pos);
  camera.lookAt(target);

  const views = {};
  for (const key of ['old', 'iot']) {
    const host = $(`#sim-view-${key}`);
    const r = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(r.domElement);
    const lr = new CSS2DRenderer();
    lr.domElement.className = 'labels';
    host.appendChild(lr.domElement);
    const c = new OrbitControls(camera, r.domElement);
    c.target.copy(target);
    c.maxPolarAngle = Math.PI * 0.495;
    c.minDistance = 0.8;
    c.maxDistance = 12;
    c.update();
    views[key] = { host, r, lr, c };
  }
  // 兩個畫面共用同一台攝影機：拖其中一個，兩邊一起轉
  for (const key of ['old', 'iot']) {
    views[key].c.addEventListener('change', () => {
      for (const other of ['old', 'iot']) if (other !== key) views[other].c.target.copy(views[key].c.target);
    });
  }

  const st = { id: 'early', side: 'L', run: null, playing: false, speed: 2, legacy: null, counts: null, chapters: [] };

  function resetLegacy() {
    const bolts = {};
    for (const side of ['L', 'R']) for (const id of SEQUENCE[side]) bolts[id] = Array(zoneById(id).bolts).fill('PENDING');
    st.legacy = { bolts, spinUntil: { L: -1, R: -1 }, missed: [] };
    st.counts = { blocked: 0, records: 0 };
  }

  const newRun = () => createRun(scenarioById(st.id), { encoder: true, spec: getSpec(), vin: 'TWPA2026C00000001', epoch: Date.now() });
  function restart() {
    st.run = newRun();
    resetLegacy();
    fx.reset();
    for (const w of Object.values(worlds)) {
      for (const side of ['L', 'R']) {
        w.arms[side].setToolRest({ instant: true });
        w.ops[side].say('');
      }
    }
    apply(st.run.advance(0), true);
  }
  function load(id, autoplay = false) {
    st.id = id;
    restart();
    $('#sim-scenario').value = id;
    buildChapters();
    st.playing = autoplay;
    syncButton();
  }

  // 跳到指定時刻：重新跑一次（不出聲），手臂直接就位
  function seek(t) {
    restart();
    for (let x = 0; x < t; x += 0.25) apply(st.run.advance(Math.min(x + 0.25, t)), true);
    for (const w of Object.values(worlds)) {
      for (const side of ['L', 'R']) {
        const target = st.run.targets[side];
        if (target) w.arms[side].setToolTarget(toolPoint(target), { instant: true });
        else w.arms[side].setToolRest({ instant: true });
      }
    }
    renderStatus();
  }

  // 章節按鈕：開始、每種警示的前一刻、承盤下降、鎖上方、完成
  const ALERT_LABEL = { EARLY_ATTEMPT: '提前鎖附', SEQUENCE_ERROR: '順序錯誤', TIGHTEN_NG: '扭力不足', PHASE_WARNING: '即將超時',
    TIMEOUT: '超時', AUTOMATION_FAULT: '承盤卡住', TOOL_FAULT: '工具故障' };
  function buildChapters() {
    const run = st.run;
    const marks = run.markers();
    const list = [{ t: 0, label: '開始' }];
    const seen = new Set();
    for (const m of marks) {
      if (seen.has(m.type) || !ALERT_LABEL[m.type]) continue;
      seen.add(m.type);
      list.push({ t: Math.max(0, m.t - 1.5), label: ALERT_LABEL[m.type], alert: m.level });
    }
    const tray = run.steps.find((x) => x.ev?.type === 'tray:lowering');
    if (tray) list.push({ t: Math.max(0, tray.t - 1), label: '承盤下降' });
    const lowered = run.steps.filter((x) => x.ev?.type === 'tray:lowered').pop();
    const upper = run.steps.find((x) => x.move && zoneById(x.move.zoneId)?.phase === 'C' && (!lowered || x.t >= lowered.t));
    if (upper) list.push({ t: upper.t, label: '鎖上方' });
    list.push({ t: Math.max(0, run.duration - 4), label: '完成' });
    list.sort((a, b) => a.t - b.t);
    st.chapters = list;
    $('#sim-chapters').innerHTML = list.map((c, i) => `<button type="button" data-ch="${i}" class="${c.alert ? `ch-${c.alert}` : ''}"><span class="num">${fmtT(c.t)}</span>${c.label}</button>`).join('');
    const slider = $('#sim-slider');
    slider.max = run.duration;
    const color = { warn: '#f0b545', alarm: '#e0303a', fault: '#ff5c8a' };
    const dedupe = new Set();
    $('#sim-marks').innerHTML = marks.filter((m) => {
      const k = `${m.type}@${Math.round(m.t)}`;
      if (dedupe.has(k)) return false;
      dedupe.add(k);
      return true;
    }).map((m) => `<i style="left:${(m.t / run.duration) * 100}%;--c:${color[m.level]}"></i>`).join('');
  }

  const toolPoint = (t) => new THREE.Vector3(...boltPosition(t.zoneId, t.boltIndex)).add(new THREE.Vector3(0, 0.03, 0));

  function apply(out, silent = false) {
    const { run, legacy } = st;
    for (const s of out.steps) {
      if (s.ev?.type === 'tool:trigger') legacy.spinUntil[s.side] = s.t + 1.2;
    }
    for (const m of out.moves) {
      for (const w of Object.values(worlds)) {
        if (m.target) w.arms[m.side].setToolTarget(toolPoint(m.target));
        else w.arms[m.side].setToolRest();
      }
    }
    fx.onRecords(out.records, { pops: !silent });
    for (const r of out.records) {
      if (r.type === 'TIGHTEN_OK' || r.type === 'TIGHTEN_NG') st.counts.records++;
      if (['EARLY_ATTEMPT', 'SEQUENCE_ERROR', 'TIGHTEN_NG', 'TOOL_FAULT', 'AUTOMATION_FAULT'].includes(r.type)) st.counts.blocked++;
      const b = r.zoneId ? legacy.bolts[r.zoneId] : null;
      if (r.type === 'TIGHTEN_OK' && b && b[r.boltIndex] === 'PENDING') b[r.boltIndex] = 'DONE';
      if (r.type === 'TIGHTEN_NG' && b) b[r.boltIndex] = 'HIDDEN';
      if (r.type === 'EARLY_ATTEMPT' && b) b[r.boltIndex] = 'EARLY';
      if (r.type === 'SEQUENCE_ERROR' && b && b[r.boltIndex] === 'PENDING') b[r.boltIndex] = 'DONE';
      if (LEGACY_TEXT[r.type]) legacy.missed.push(r.type);
    }
    for (const a of out.alerts) {
      worlds.iot.ops[a.side].say(`「${a.say || a.text}」`, a.level === 'info' ? 'info' : 'voice', 3.2);
      if (a.level !== 'info' && LEGACY_TEXT[a.type]) worlds.old.ops[a.side].say('（沒有任何提示）', 'think', 3.2);
      if (!silent) {
        if (a.level !== 'info') chime(a.level);
        speak(a.say, a.level === 'alarm' || a.level === 'fault');
      }
    }
    for (const side of ['L', 'R']) worlds.iot.arms[side].setState(run.states[side]);
    renderStatus();
  }

  function syncButton() {
    $('#sim-play').textContent = st.playing ? '暫停' : '播放';
  }

  let lastStatus = '';
  function renderStatus() {
    const { run, legacy, counts, side } = st;
    const s = run.states[side];
    const spinning = run.t < legacy.spinUntil[side];
    const total = SEQUENCE[side].flatMap((id) => legacy.bolts[id]);
    const tightened = total.filter((b) => b !== 'PENDING').length;
    const early = total.filter((b) => b === 'EARLY').length;
    const a = s.alarm && s.alarm.level !== 'info' ? s.alarm : null;
    const iotTool = { ENABLED: '可鎖附', RUNNING: '鎖附中', FAULT: '故障・已鎖定' }[s.tool] ?? '已鎖定';
    const missed = legacy.missed.length;
    const oldHtml = `
      <dl class="sim-kv">
        <dt>工具</dt><dd>${spinning ? '<b class="t-run">鎖附中</b>' : '隨時可轉'}</dd>
        <dt>提示</dt><dd class="muted">${a ? '沒有' : '—'}</dd>
        <dt>已鎖</dt><dd>${tightened} 顆${early ? ` <b class="t-warn">（${early} 顆提前）</b>` : ''}</dd>
        <dt>問題</dt><dd><b class="${missed ? 't-bad' : ''}">${missed ? `${missed} 件沒被發現` : '—'}</b></dd>
      </dl>`;
    const iotHtml = `
      <dl class="sim-kv">
        <dt>工具</dt><dd><b class="${s.tool === 'ENABLED' || s.tool === 'RUNNING' ? 't-ok' : 't-warn'}">${iotTool}</b></dd>
        <dt>提示</dt><dd>${a ? `<b class="t-bad">「${esc(a.say || a.text)}」</b>` : '—'}</dd>
        <dt>已鎖</dt><dd>${s.counts.A.done + s.counts.C.done} / ${s.counts.A.total + s.counts.C.total} 顆・紀錄 ${counts.records} 筆</dd>
        <dt>問題</dt><dd><b class="${counts.blocked ? 't-ok' : ''}">${counts.blocked ? `${counts.blocked} 件當場處理` : '—'}</b></dd>
      </dl>`;
    const html = oldHtml + iotHtml + Math.floor(run.t * 10) + side;
    if (html === lastStatus) return;
    lastStatus = html;
    $('#sim-status-old').innerHTML = oldHtml;
    $('#sim-status-iot').innerHTML = iotHtml;
    $('#sim-fill').style.width = `${(run.t / run.duration) * 100}%`;
    $('#sim-slider').value = run.t;
    $('#sim-time').textContent = `${fmtT(run.t)} / ${fmtT(run.duration)}`;
    let cur = 0;
    st.chapters.forEach((c, i) => { if (run.t >= c.t - 0.01) cur = i; });
    document.querySelectorAll('#sim-chapters [data-ch]').forEach((b) => b.classList.toggle('on', +b.dataset.ch === cur));
  }

  function resize() {
    for (const v of Object.values(views)) {
      const w = v.host.clientWidth;
      const h = v.host.clientHeight;
      if (!w || !h) continue;
      v.r.setSize(w, h, false);
      v.lr.setSize(w, h);
      camera.aspect = w / h;
    }
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  for (const v of Object.values(views)) ro.observe(v.host);

  function frame(dt, time) {
    if (st.playing) {
      apply(st.run.advance(st.run.t + dt * st.speed));
      if (st.run.done) { st.playing = false; syncButton(); }
    }
    const { run, legacy } = st;
    for (const [key, w] of Object.entries(worlds)) {
      w.env.tray.position.y = -P.trayDrop.v * run.trayPos;
      for (const side of ['L', 'R']) {
        const arm = w.arms[side];
        if (key === 'old') arm.setState({ tool: run.t < legacy.spinUntil[side] ? 'RUNNING' : 'ENABLED' });
        arm.update(dt, time);
        const s = run.states[side];
        const a = s.alarm;
        const reacting = key === 'iot' && a && a.level !== 'info' && run.t - a.at < 2.5;
        w.ops[side].update(dt, time, {
          mode: run.targets[side] ? 'work' : 'wait',
          grip: run.targets[side] ? arm.getGrip() : null,
          top: run.targets[side] ? arm.getToolTop() : null,
          react: reacting ? arm.getControllerPos() : null,
        });
      }
      // 現行手臂沒有「下一顆」提示，只看得到鎖了沒（提前鎖上的標成橘紅）
      w.env.paintBolts(key === 'old'
        ? { L: { bolts: legacy.bolts }, R: { bolts: legacy.bolts } }
        : run.states, time);
      const v = views[key];
      if (key === 'iot') {
        fx.update(dt, time, { states: run.states, arms: w.arms, tray: w.env.tray });
        if (v.host.dataset.fx !== fx.mood) v.host.dataset.fx = fx.mood;
      }
      v.r.render(w.scene, camera);
      v.lr.render(w.scene, camera);
    }
    renderStatus();
  }

  // ── 控制 ─────────────────────────────────
  $('#sim-scenario').innerHTML = SCENARIOS.map((s, i) => `<option value="${s.id}">${i + 1}. ${s.title}</option>`).join('');
  $('#sim-scenario').addEventListener('change', (e) => { unlockAudio(); load(e.target.value, true); });
  $('#sim-play').addEventListener('click', () => {
    unlockAudio();
    if (st.run.done) load(st.id, true);
    else { st.playing = !st.playing; syncButton(); }
  });
  $('#sim-chapters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ch]');
    if (!b) return;
    unlockAudio();
    seek(st.chapters[+b.dataset.ch].t);
    st.playing = true;
    syncButton();
  });
  $('#sim-slider').addEventListener('input', (e) => seek(+e.target.value));
  for (const b of document.querySelectorAll('[data-sim-speed]')) {
    b.addEventListener('click', () => {
      st.speed = +b.dataset.simSpeed;
      document.querySelectorAll('[data-sim-speed]').forEach((x) => x.classList.toggle('on', x === b));
    });
  }

  function setSide(side) {
    st.side = side;
    const c = SIDE_CAM[side];
    camera.position.set(...c.pos);
    for (const v of Object.values(views)) { v.c.target.set(...c.tgt); v.c.update(); }
    document.querySelectorAll('[data-sim-side]').forEach((x) => x.classList.toggle('on', x.dataset.simSide === side));
    renderStatus();
  }
  for (const b of document.querySelectorAll('[data-sim-side]')) b.addEventListener('click', () => setSide(b.dataset.simSide));

  load(st.id);
  return {
    frame,
    resize,
    pause() { st.playing = false; syncButton(); },
    play(id) { load(id ?? st.id, true); },
  };
}
