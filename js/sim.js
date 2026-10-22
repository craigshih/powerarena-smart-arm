// 「現行 vs IoT」實境對比（UI 層）。
// 同一位師傅、同一段動作同時播放兩次：左邊是現行手臂（工具隨時能轉、沒有回饋與紀錄），
// 右邊是連上 IoT 的改良手臂（狀態機控制致能與鎖定）。
// 現行手臂沒有自己的狀態機：IoT 狀態機攔下或判定的每一件事，在現行手臂上就是「沒被發現的問題」。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { P, SEQUENCE, zoneById, boltPosition } from './arm-params.js';
import { EVENT_TYPES } from './arm-logic.js';
import { createSmartArm } from './arm-model.js';
import { SCENARIOS, scenarioById, createRun } from './scenarios.js';
import { buildEnvironment } from './environment.js';
import { createOperator } from './operator.js';

// 現行手臂上同一時刻會發生什麼（依訪綱理解，待業主確認）
const LEGACY_TEXT = {
  EARLY_ATTEMPT: '工具照轉：承盤還撐著就把車身固定點鎖上了，沒有任何提示',
  TIGHTEN_NG: '沒有量測：扭力不足的這一顆被當成鎖好了',
  SEQUENCE_ERROR: '順序錯了也鎖得下去，沒有人知道',
  PHASE_WARNING: '沒有倒數提醒',
  TIMEOUT: '沒有人知道已經超時，事後也查不到',
  AUTOMATION_FAULT: '承盤卡住，但工具仍然能轉；以為承盤降了就開始鎖，等於提前鎖附',
  TOOL_FAULT: '工具停了，這一顆有沒有鎖到位沒有紀錄',
};

export const OUTCOME = {
  normal: {
    act: '依 SOP 完成兩側 12 顆',
    legacy: '結果一樣完成，但沒有任何扭力、角度紀錄。之後若有異音或客訴，查不到這台車哪一顆有問題。',
    iot: '每顆都有扭力、角度、時間紀錄。A 鎖滿自動鎖住、承盤降下自動開放 C，師傅沒有多做任何動作。',
  },
  early: {
    act: '等承盤時，順手想先鎖車身固定點',
    legacy: '工具照轉，車身固定點在承盤撐起時就鎖緊。沒有聲音、沒有燈號，師傅不知道做錯；要等後段品檢或客訴才可能發現。',
    iot: '工具不轉，握把紅燈閃並震動、廣播「提前鎖附！」。師傅當場放開扳機，等承盤降下再鎖；留下一筆「提前鎖附（已攔下）」。',
  },
  ng: {
    act: '套筒沒咬合，第 2 顆只鎖到 52 N·m',
    legacy: '沒有量測，這一顆被當成鎖好了，直接流到下一站。',
    iot: '當場判 NG、不計數，廣播「扭力不足，請重鎖」。原地重鎖到合格才往下，兩筆紀錄都留下。',
  },
  timeout: {
    act: '變速箱螺絲對不準，第一階段拖過檢查點',
    legacy: '沒有倒數，也沒有人知道已經超時；事後查不到是哪一台、哪一顆拖到。',
    iot: '剩 15 秒語音預警；超時當下廣播並記錄，班長事後查得到是變速箱第 1 顆對不準。不停線。',
  },
  sequence: {
    act: '憑習慣先鎖變速箱，跳過左引擎腳',
    legacy: '先鎖變速箱也鎖得下去，工具不知道自己在哪；順序錯了沒有人發現。',
    iot: '（關節編碼器手臂）工具停在錯的區域就鎖住、握把黃燈閃；扣扳機時廣播「順序錯誤，請先鎖左引擎腳」。',
  },
  automation: {
    act: '承盤下降到一半卡住，師傅在等',
    legacy: '工具仍然能轉。師傅若以為承盤已降而開始鎖第二階段，就是提前鎖附；也分不出是設備還是人的問題。',
    iot: '8 秒沒收到「下降完成」就判自動化錯誤，第二階段維持鎖定並通知班長；紀錄歸在「自動化錯誤」，不算師傅的錯。',
  },
  tool: {
    act: '鎖到一半，工具通訊中斷',
    legacy: '工具停了，但這一顆到底有沒有鎖到位沒有紀錄；師傅可能直接跳到下一顆。',
    iot: '工具立刻停轉並鎖住（失效即安全），這一顆不計數；班長恢復後從同一顆重鎖，紀錄歸在「工具錯誤」。',
  },
};

const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const BOLT = { PENDING: 0x4a5568, OK: 0x3ccf6b, NG: 0xe0303a, DONE: 0x8fa3bf, EARLY: 0xff8a3d, HIDDEN: 0x8fa3bf };

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

  const st = { id: 'early', side: 'L', run: null, playing: false, speed: 2, legacy: null, diff: [], counts: null };

  function resetLegacy() {
    const bolts = {};
    for (const side of ['L', 'R']) for (const id of SEQUENCE[side]) bolts[id] = Array(zoneById(id).bolts).fill('PENDING');
    st.legacy = { bolts, spinUntil: { L: -1, R: -1 }, missed: [] };
    st.diff = [];
    st.counts = { blocked: 0, records: 0 };
  }

  function load(id, autoplay = false) {
    st.id = id;
    st.run = createRun(scenarioById(id), { encoder: true, spec: getSpec(), vin: 'TWPA2026C00000001', epoch: Date.now() });
    resetLegacy();
    for (const w of Object.values(worlds)) {
      for (const side of ['L', 'R']) {
        w.arms[side].setToolRest({ instant: true });
        w.ops[side].say('');
      }
    }
    apply(st.run.advance(0), true);
    $('#sim-scenario').value = id;
    renderOutcome();
    st.playing = autoplay;
    syncButton();
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
      if (a.level !== 'info' && LEGACY_TEXT[a.type]) {
        worlds.old.ops[a.side].say('（沒有任何提示）', 'think', 3.2);
        st.diff.push({ t: run.t, side: a.side, type: a.type, iot: a.text, old: LEGACY_TEXT[a.type] });
      }
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

  function renderOutcome() {
    const o = OUTCOME[st.id];
    const sc = scenarioById(st.id);
    $('#sim-outcome').innerHTML = `<thead><tr><th>情境</th><th>師傅做了什麼</th><th>現行手臂</th><th>IoT 手臂</th></tr></thead>
      <tbody><tr><th>${esc(sc.title)}</th><td data-label="師傅做了什麼">${esc(o.act)}</td>
      <td data-label="現行手臂">${esc(o.legacy)}</td><td data-label="IoT 手臂">${esc(o.iot)}</td></tr></tbody>`;
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
    const oldHtml = `
      <dl class="sim-kv">
        <dt>工具</dt><dd>${spinning ? '<b class="t-run">鎖附中</b>' : '隨時可轉'}</dd>
        <dt>師傅聽到／看到</dt><dd class="muted">${a ? '沒有任何提示' : '—'}</dd>
        <dt>已鎖螺絲</dt><dd>${tightened} 顆（${side === 'L' ? '左' : '右'}側）${early ? `，<b class="t-warn">其中 ${early} 顆提前鎖上</b>` : ''}</dd>
        <dt>扭力紀錄</dt><dd>0 筆</dd>
        <dt>沒被發現的問題</dt><dd><b class="${legacy.missed.length ? 't-bad' : ''}">${legacy.missed.length} 件</b></dd>
      </dl>`;
    const iotHtml = `
      <dl class="sim-kv">
        <dt>工具</dt><dd><b class="${s.tool === 'ENABLED' || s.tool === 'RUNNING' ? 't-ok' : 't-warn'}">${iotTool}</b></dd>
        <dt>師傅聽到／看到</dt><dd>${a ? `<b class="t-bad">「${esc(a.say || a.text)}」</b>` : '—'}</dd>
        <dt>已鎖螺絲</dt><dd>${s.counts.A.done + s.counts.C.done} / ${s.counts.A.total + s.counts.C.total} 顆（${side === 'L' ? '左' : '右'}側）</dd>
        <dt>扭力紀錄</dt><dd>${counts.records} 筆</dd>
        <dt>當場攔下／判定</dt><dd><b class="${counts.blocked ? 't-ok' : ''}">${counts.blocked} 件</b></dd>
      </dl>`;
    const diff = st.diff.length
      ? st.diff.map((d) => `<li><time>${fmtT(d.t)}</time><span class="side">${d.side}</span><b>${EVENT_TYPES[d.type].label}</b>
          <div class="sim-cmp"><p><i>現行</i>${esc(d.old)}</p><p><i>IoT</i>${esc(d.iot)}</p></div></li>`).join('')
      : '<li class="muted">播放後，兩邊不一樣的時刻會列在這裡。</li>';
    const html = oldHtml + iotHtml + diff + run.t + side;
    if (html === lastStatus) return;
    lastStatus = html;
    $('#sim-status-old').innerHTML = oldHtml;
    $('#sim-status-iot').innerHTML = iotHtml;
    $('#sim-diff').innerHTML = diff;
    $('#sim-fill').style.width = `${(run.t / run.duration) * 100}%`;
    $('#sim-time').textContent = `${fmtT(run.t)} / ${fmtT(run.duration)}`;
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
    const pulse = 0.5 + 0.5 * Math.sin(time * 6);
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
        for (const id of SEQUENCE[side]) {
          const states = key === 'old' ? legacy.bolts[id] : s.bolts[id];
          states.forEach((b, i) => {
            const m = w.env.bolts[id][i].material;
            const cur = key === 'iot' && s.expected?.zoneId === id && s.expected.boltIndex === i && (s.phase === 'A' || s.phase === 'C');
            m.color.setHex(cur ? 0xffffff : BOLT[b]);
            m.emissive.setHex(cur ? 0xf2c230 : b === 'PENDING' ? 0x000000 : BOLT[b]);
            m.emissiveIntensity = cur ? 0.4 + pulse * 0.8 : 0.45;
          });
        }
      }
      const v = views[key];
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
  $('#sim-restart').addEventListener('click', () => { unlockAudio(); load(st.id, true); });
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
