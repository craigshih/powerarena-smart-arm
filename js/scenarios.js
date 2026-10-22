// 情境腳本與播放引擎（UI 層）。只透過 arm-logic 的事件介面驅動狀態機，
// 同一份腳本可以即時播放（main.js），也可以離線跑出追溯資料（generateHistory）。
//
// 腳本時間軸為示意，已壓縮：每顆螺絲約 4.5 秒、承盤依節拍在 45 秒開始下降。
// 實際工站一階段約 78 秒，整合進場域模型時改用場域模型的時間軸即可。

import { createArmLogic } from './arm-logic.js';
import { SPEC } from './arm-params.js';

export const TRAY_DUE = 45;
const STEP = 4.5; // 每顆螺絲的節奏（示意）

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 一側師傅的動作，依序往後排時間
class Track {
  constructor(side, steps, ctx, t = 0) {
    Object.assign(this, { side, steps, ctx, t });
  }
  at(t) { this.t = t; return this; }
  wait(dt) { this.t += dt; return this; }
  push(step, dt = 0) { this.steps.push({ side: this.side, ...step, t: +(this.t + dt).toFixed(2) }); return this; }
  note(text, dt = 0) { return this.push({ note: text }, dt); }
  move(zoneId, boltIndex) {
    this.push({ move: { zoneId, boltIndex } });
    this.push({ ev: { type: 'tool:position', zoneId } }, 1.2);
    this.t += 1.4;
    return this;
  }
  rest() {
    this.push({ move: null });
    this.push({ ev: { type: 'tool:position', zoneId: null } }, 0.5);
    this.t += 1;
    return this;
  }
  trigger() { this.push({ ev: { type: 'tool:trigger' } }); this.t += 0.4; return this; }
  // 工具回報扭力。torque 省略時取該區域目標扭力 ±4%
  torque(zoneId, torque, angle) {
    const sp = this.ctx.spec[zoneId];
    const r = this.ctx.rand;
    const tq = torque ?? sp.torque.v * (1 + (r() - 0.5) * 0.08);
    const ang = angle ?? 50 + r() * 40;
    this.push({ ev: { type: 'tool:torque', torqueNm: tq, angleDeg: ang } }, 1.2);
    this.t += 1.2;
    return this;
  }
  bolt(zoneId, i, opt = {}) {
    const t0 = this.t;
    this.move(zoneId, i).trigger().torque(opt.torqueZone ?? zoneId, opt.torque, opt.angle);
    this.t = t0 + STEP;
    return this;
  }
  bolts(zoneId, n, from = 0) {
    for (let i = from; i < n; i++) this.bolt(zoneId, i);
    return this;
  }
  // 原地重鎖（扭力 NG 後）
  retry(zoneId, torque) {
    const t0 = this.t;
    this.trigger().torque(zoneId, torque);
    this.t = t0 + STEP - 1.4;
    return this;
  }
}

function base(ctx, variant) {
  const steps = [];
  const L = new Track('L', steps, ctx);
  const R = new Track('R', steps, ctx);
  const all = (t, step) => steps.push({ side: 'all', t, ...step });
  all(0.5, { ev: { type: 'cycle:start', trayDueAt: TRAY_DUE } });

  // 右側：第一階段 3 顆，之後等承盤
  R.at(2).bolts('Z1R', 3).rest().note('右側第一階段完成，工具自動鎖住；師傅放下工具等待，不用按任何按鈕');

  // 左側依情境變化
  variant(L, all, ctx);

  // 承盤（自動化錯誤情境自行處理）
  if (!ctx.customTray) {
    all(TRAY_DUE, { ev: { type: 'tray:lowering' } });
    all(TRAY_DUE + 4, { ev: { type: 'tray:lowered' } });
  }
  const cStart = ctx.cStart ?? TRAY_DUE + 5;
  if (!ctx.customC) L.at(cStart).bolts('Z2L', 2).rest();
  R.at(cStart + 0.8).bolts('Z2R', 2).rest();

  steps.sort((a, b) => a.t - b.t);
  return steps;
}

const normalA = (L) => L.at(1.5).bolts('Z1L', 3).bolts('Z1T', 2).rest();

export const SCENARIOS = [
  {
    id: 'normal',
    title: '正常流程',
    short: 'A 鎖滿 → 承盤下降 → C 鎖滿',
    expect: '每顆 OK；A 鎖滿後工具自動鎖住，承盤降下後自動開放 C。',
    build: (ctx) => base(ctx, (L) => {
      normalA(L).note('左側第一階段完成，握把燈轉黃：工具已鎖定，等承盤');
    }),
  },
  {
    id: 'early',
    title: '提前鎖附',
    short: '承盤還沒降就去鎖車身固定點',
    expect: '工具不轉；握把紅燈閃、震動；廣播「提前鎖附！」；師傅放開扳機等承盤。',
    build: (ctx) => base(ctx, (L) => {
      normalA(L);
      L.at(29).note('等承盤時，師傅順手想先鎖車身固定點').move('Z2L', 0).trigger();
      L.wait(1.4).note('聽到「提前鎖附！」，握把燈閃紅並震動；師傅放開扳機，把工具放回待命位置').rest();
    }),
  },
  {
    id: 'ng',
    title: '扭力不足',
    short: '第 2 顆只鎖到 52 N·m',
    expect: '判 NG、不計數；廣播「扭力不足，請重鎖」；原地重鎖 OK 後才往下。',
    build: (ctx) => base(ctx, (L) => {
      L.at(1.5).bolt('Z1L', 0);
      L.note('套筒沒有完全咬合（假設原因），扭力只到 52 N·m', 2.6).bolt('Z1L', 1, { torque: 52, angle: 41 });
      L.note('聽到「扭力不足，請重鎖」；師傅調整套筒，原地再扣一次扳機').retry('Z1L', 66);
      L.bolt('Z1L', 2).bolts('Z1T', 2).rest();
    }),
  },
  {
    id: 'timeout',
    title: '超過鎖附時間',
    short: '變速箱螺絲對不準，第一階段拖過檢查點',
    expect: '剩 15 秒先預警；超過檢查點判 TIMEOUT 並通知班長；不停線，師傅補完最後一顆。',
    build: (ctx) => base(ctx, (L) => {
      L.at(1.5).bolts('Z1L', 3);
      L.move('Z1T', 0).note('變速箱第 1 顆套筒對不上，師傅反覆調整');
      L.wait(13).note('聽到「還剩 15 秒」語音提醒，加快調整');
      L.wait(11.5).trigger().torque('Z1T');
      L.wait(1.4).bolt('Z1T', 1);
      L.note('聽到「超過鎖附時間」：師傅照常補完最後一顆，系統記錄超時給班長追蹤', -2.2).rest();
    }),
  },
  {
    id: 'sequence',
    title: '順序錯誤',
    short: '先鎖變速箱、跳過左引擎腳',
    expect: '需要關節編碼器：工具停在錯的區域時鎖住，握把黃燈閃；扣扳機時廣播「順序錯誤」。',
    needsEncoder: true,
    build: (ctx) => base(ctx, (L) => {
      L.at(1.5).note('師傅憑習慣先去鎖變速箱固定點').move('Z1T', 0);
      if (ctx.encoder) {
        L.trigger().torque('Z1T');
        L.wait(0.4).note('工具不轉、握把黃燈閃；廣播「順序錯誤，請先鎖左引擎腳」，師傅改去左引擎腳');
        L.wait(1.2).bolts('Z1L', 3).bolts('Z1T', 2).rest();
      } else {
        // 沒有編碼器：控制器只會照順序換程式，實際鎖的位置和紀錄對不上
        L.trigger().torque('Z1L');
        L.wait(0.4).note('沒有編碼器：控制器以為這顆是左引擎腳，用 65 N·m 鎖了變速箱螺絲，紀錄卻顯示 OK');
        L.wait(1.4).bolt('Z1T', 1, { torqueZone: 'Z1L' }).bolt('Z1L', 0, { torqueZone: 'Z1L' });
        L.note('後兩顆引擎腳反而用變速箱的 50 N·m 鎖：扭力不足，但紀錄仍是 OK', 1.8);
        L.bolt('Z1L', 1, { torqueZone: 'Z1T' }).bolt('Z1L', 2, { torqueZone: 'Z1T' }).rest();
      }
    }),
  },
  {
    id: 'automation',
    title: '自動化錯誤',
    short: '承盤下降到一半卡住',
    expect: '8 秒內沒收到「下降完成」判自動化錯誤；C 不開放；廣播請班長；復歸後自動續做。',
    build: (ctx) => {
      ctx.customTray = true;
      ctx.cStart = 63.5;
      return base(ctx, (L, all) => {
        normalA(L).note('左側第一階段完成，工具已鎖定，等承盤');
        all(TRAY_DUE, { ev: { type: 'tray:lowering' } });
        all(TRAY_DUE + 2, { trayStop: true });
        all(TRAY_DUE + 8.6, { note: '承盤 8 秒沒降到底：控制器判「自動化錯誤」。師傅照常等待，不用處理；班長收到通知到場' });
        all(60, { note: '班長確認承盤卡住，按下承盤復歸（處置紀錄歸在自動化錯誤）' });
        all(60, { ev: { type: 'tray:lowering' } });
        all(62.2, { ev: { type: 'tray:lowered' } });
      });
    },
  },
  {
    id: 'tool',
    title: '工具錯誤',
    short: '鎖附中通訊中斷',
    expect: '工具立刻停止並鎖住（失效即安全），這一顆不計數；班長恢復後從同一顆重鎖。',
    build: (ctx) => base(ctx, (L) => {
      L.at(1.5).bolt('Z1L', 0);
      L.move('Z1L', 1).trigger();
      L.push({ ev: { type: 'tool:fault', code: 'COMM_LOST' } }, 0.5);
      L.note('工具與控制器通訊中斷（假設：接頭鬆脫），工具立刻停轉並鎖住，這一顆不計數', 0.7);
      L.wait(3.5).note('班長重新插好接頭，控制器自我檢查通過');
      L.push({ ev: { type: 'tool:recover' } }, 0.3);
      L.wait(1).note('師傅從同一顆重鎖').trigger().torque('Z1L');
      L.wait(1.4).bolt('Z1L', 2).bolts('Z1T', 2).rest();
    }),
  },
];

export const scenarioById = (id) => SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];

// ── 播放引擎 ─────────────────────────────────────
// 依時間推進腳本，把事件送進左右兩個狀態機，並回報這段時間內的輸出。
export function createRun(scenario, opts = {}) {
  const o = {
    encoder: true,
    spec: SPEC,
    vin: 'TWPA2026A00012345',
    epoch: Date.now(),
    operators: { L: 'A1024', R: 'A1037' },
    seed: 7,
    ...opts,
  };
  const ctx = { encoder: o.encoder, spec: o.spec, rand: rng(o.seed) };
  const steps = scenario.build(ctx);
  const duration = Math.ceil(steps[steps.length - 1].t + 3);
  const logic = {
    L: createArmLogic({ side: 'L', encoder: o.encoder, spec: o.spec, epoch: o.epoch, vin: o.vin, operator: o.operators.L, stationEvents: true }),
    R: createArmLogic({ side: 'R', encoder: o.encoder, spec: o.spec, epoch: o.epoch, vin: o.vin, operator: o.operators.R, stationEvents: false }),
  };
  const states = { L: logic.L.getState(), R: logic.R.getState() };
  const targets = { L: null, R: null };
  const tray = { pos: 0, from: 0, startT: null, stopped: false };
  let idx = 0;
  let t = 0;

  function send(side, ev, out) {
    for (const k of side === 'all' ? ['L', 'R'] : [side]) {
      const r = logic[k].dispatch({ ...ev, t: ev.t ?? t });
      states[k] = r.state;
      out.records.push(...r.records);
      out.alerts.push(...r.alerts);
    }
  }

  function trayAt(time) {
    if (tray.startT == null || tray.stopped) return tray.pos;
    return Math.min(1, tray.from + (time - tray.startT) / 4);
  }

  function advance(toT) {
    const out = { records: [], alerts: [], notes: [], moves: [], steps: [] };
    toT = Math.min(toT, duration);
    while (idx < steps.length && steps[idx].t <= toT) {
      const st = steps[idx++];
      t = st.t;
      out.steps.push(st);
      send('all', { type: 'timer' }, out);
      if (st.ev) {
        send(st.side, st.ev, out);
        if (st.ev.type === 'tray:lowering') Object.assign(tray, { from: tray.pos, startT: t, stopped: false });
        if (st.ev.type === 'tray:lowered') Object.assign(tray, { pos: 1, startT: null, stopped: false });
      }
      if (st.trayStop) Object.assign(tray, { pos: trayAt(t), stopped: true });
      if (st.note) out.notes.push({ t, side: st.side, text: st.note });
      if ('move' in st) {
        targets[st.side] = st.move;
        out.moves.push({ side: st.side, target: st.move });
      }
    }
    t = Math.max(t, toT);
    send('all', { type: 'timer' }, out);
    if (tray.startT != null && !tray.stopped) tray.pos = trayAt(t);
    return out;
  }

  return {
    scenario, steps, duration, logic, states, targets,
    get t() { return t; },
    get trayPos() { return tray.pos; },
    get done() { return t >= duration; },
    advance,
    // 標出時間軸上的提示位置（播放前先離線跑一次）
    markers() {
      const probe = createRun(scenario, { ...o });
      const marks = [];
      for (let x = 0; x <= duration; x += 0.25) {
        for (const a of probe.advance(x).alerts) {
          if (a.level !== 'info') marks.push({ t: x, level: a.level, type: a.type, side: a.side });
        }
      }
      return marks;
    },
  };
}

// 一次跑完整個情境，只取事件紀錄
export function runHeadless(scenario, opts) {
  const run = createRun(scenario, opts);
  const records = [];
  for (let x = 0; x <= run.duration; x += 0.25) records.push(...run.advance(x).records);
  return records;
}

// 示範用的追溯資料：用同一套腳本與狀態機跑出昨天到今天的車
export function generateHistory({ count = 36, start = Date.parse('2026-10-21T08:00:00+08:00'), spec = SPEC } = {}) {
  const r = rng(2026);
  const plan = ['normal', 'normal', 'normal', 'ng', 'normal', 'early', 'normal', 'normal', 'timeout', 'normal', 'sequence', 'normal',
    'normal', 'early', 'normal', 'tool', 'normal', 'normal', 'ng', 'normal', 'normal', 'automation', 'normal', 'early'];
  const shifts = [{ L: 'A1024', R: 'A1037' }, { L: 'B2011', R: 'B2056' }];
  const records = [];
  for (let n = 0; n < count; n++) {
    const id = plan[n % plan.length];
    // 前一半是早班（08:00 起），後一半是晚班（20:00 起），每台間隔約一個工站節拍
    const night = n >= count / 2;
    const k = night ? n - Math.ceil(count / 2) : n;
    const epoch = start + k * 480 * 1000 + Math.floor(r() * 60) * 1000 + (night ? 12 * 3600 * 1000 : 0);
    const vin = `TWPA2026A${String(10001 + n * 7).padStart(8, '0')}`;
    records.push(...runHeadless(scenarioById(id), {
      vin, epoch, spec, encoder: true, seed: 100 + n, operators: shifts[night ? 1 : 0],
    }));
  }
  return records;
}
