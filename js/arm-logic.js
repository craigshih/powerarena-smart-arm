// 改良版鎖附手臂的控制邏輯：純狀態機，不碰 DOM 也不碰 Three.js。
//
// 一側（L 或 R）一個實例。輸入事件（皆帶 t，單位秒，從本車進站起算）：
//   cycle:start   { vin, operator, trayDueAt }   車輛進站，開始 A 階段
//   tool:position { zoneId | null }              關節編碼器回報工具所在區域（選配）
//   tool:trigger  { zoneId? }                    作業員按下扳機
//   tool:torque   { torqueNm, angleDeg }         工具回報這一顆的扭力與角度
//   tray:lowering / tray:lowered                 承盤 PLC 訊號
//   tool:fault    { code }  /  tool:recover      扭矩槍訊號中斷等工具異常與恢復
//   bypass:on / bypass:off                       班長鑰匙開關（降級模式）
//   timer                                        定時檢查（超時、承盤逾時）
//
// 輸出：dispatch() 回傳 { state, records, alerts }。records 是新增的事件紀錄，
// 格式固定為 README 所列的 JSON；alerts 是這次新觸發的提示（含語音文字）。

import { P, SEQUENCE, SPEC, zoneById } from './arm-params.js';

export const CATEGORY = {
  AUTOMATION: '系統異常 A：承盤異常',
  TOOL: '系統異常 B：扭矩槍訊號中斷',
  OPERATION: '作業異常',
};

// type → 中文、預設結果、錯誤分類
export const EVENT_TYPES = {
  CYCLE_START: { label: '車輛進站', result: 'INFO', category: '' },
  TOOL_ENABLED: { label: '工具致能', result: 'INFO', category: '' },
  TOOL_LOCKED: { label: '工具鎖定', result: 'INFO', category: '' },
  TIGHTEN_OK: { label: '鎖附 OK', result: 'OK', category: '' },
  TIGHTEN_NG: { label: '鎖附 NG', result: 'NG', category: 'OPERATION' },
  EARLY_ATTEMPT: { label: '降前鎖附（已攔下）', result: 'BLOCKED', category: 'OPERATION' },
  SEQUENCE_ERROR: { label: '錯誤步驟（已攔下）', result: 'BLOCKED', category: 'OPERATION' },
  PHASE_WARNING: { label: '即將超時', result: 'WARN', category: '' },
  TIMEOUT: { label: '超過鎖附時間', result: 'NG', category: 'OPERATION' },
  PHASE_COMPLETE: { label: '階段完成', result: 'INFO', category: '' },
  TRAY_LOWERING: { label: '承盤開始下降', result: 'INFO', category: '' },
  TRAY_LOWERED: { label: '承盤下降完成', result: 'INFO', category: '' },
  AUTOMATION_FAULT: { label: '承盤異常', result: 'FAULT', category: 'AUTOMATION' },
  TOOL_FAULT: { label: '扭矩槍訊號中斷', result: 'FAULT', category: 'TOOL' },
  TOOL_RECOVERED: { label: '扭矩槍恢復', result: 'INFO', category: '' },
  BYPASS_ON: { label: '降級模式開啟', result: 'WARN', category: '' },
  BYPASS_OFF: { label: '降級模式關閉', result: 'INFO', category: '' },
  CYCLE_COMPLETE: { label: '本車完成', result: 'OK', category: '' },
};

export const RESULT_LABEL = { OK: 'OK', NG: 'NG', BLOCKED: '已攔下', WARN: '警告', FAULT: '故障', INFO: '資訊' };

export const FAULT_TEXT = {
  COMM_LOST: '扭矩槍與控制器訊號中斷',
  BATTERY_LOW: '電池電量不足',
  TRANSDUCER: '扭力感測器異常',
  TRAY_STUCK: '承盤下降逾時',
  TRAY_NOT_STARTED: '承盤未依節拍下降',
};

export const PHASE_LABEL = { IDLE: '等待車輛', A: '步驟 1 鎖下方螺絲', B: '步驟 2 承盤下降', C: '步驟 3 鎖上方螺絲', DONE: '本車完成' };
// 畫面上一律用場域模型的步驟編號（1 鎖下方、2 承盤下降、3 鎖上方）；事件紀錄的 phase 欄位仍是 A／B／C
export const PHASE_STEP = { A: '1', B: '2', C: '3' };

export const TOOL_TEXT = {
  ENABLED: '可鎖附',
  RUNNING: '鎖附中',
  FAULT: '故障・已鎖定',
  LOCKED: {
    NO_VEHICLE: '待機',
    WAIT_TRAY: '已鎖定・等承盤',
    WRONG_ZONE: '已鎖定・位置不對',
    DONE: '完成・已鎖定',
  },
};

const PRIORITY = { info: 0, warn: 1, alarm: 2, fault: 3 };

export function createArmLogic(options = {}) {
  const cfg = {
    side: 'L',
    vin: '',
    operator: '',
    station: P.station.v,
    encoder: true, // 有關節編碼器時才知道工具在哪個區域
    stationEvents: true, // 承盤事件只由一側記錄，避免追溯資料重複
    epoch: Date.now(), // t = 0 對應的時間（毫秒）
    spec: SPEC,
    params: P,
    ...options,
  };
  const order = SEQUENCE[cfg.side];
  const log = [];
  let s;
  let out;

  const zonesOf = (phase) => order.filter((id) => zoneById(id).phase === phase);
  const v = (key) => cfg.params[key].v;

  function reset() {
    s = {
      side: cfg.side,
      vin: cfg.vin,
      operator: cfg.operator,
      station: cfg.station,
      encoder: cfg.encoder,
      bypass: false,
      t: 0,
      phase: 'IDLE',
      tray: 'UP',
      trayAt: null,
      trayDueAt: null,
      tool: 'LOCKED',
      lockReason: 'NO_VEHICLE',
      fault: null,
      automationFault: null,
      toolZone: null,
      bolts: Object.fromEntries(order.map((id) => [id, Array(zoneById(id).bolts).fill('PENDING')])),
      attempt: null,
      rework: null,
      phaseStart: null,
      deadline: null,
      warned: false,
      timedOut: false,
      alarms: [],
      last: null,
    };
  }
  reset();

  // ── 查詢 ───────────────────────────────────
  function nextBolt(phase) {
    for (const id of zonesOf(phase)) {
      const i = s.bolts[id].findIndex((b) => b !== 'OK');
      if (i >= 0) return { zoneId: id, boltIndex: i };
    }
    return null;
  }
  const phaseDone = (phase) => nextBolt(phase) === null;
  const expected = () => s.rework || (s.phase === 'A' || s.phase === 'C' ? nextBolt(s.phase) : null);
  const nextInZone = (id) => {
    const i = s.bolts[id]?.findIndex((b) => b !== 'OK') ?? -1;
    return i >= 0 ? i : null;
  };
  const trayReady = () => s.tray === 'DOWN' || s.bypass;

  // ── 紀錄與提示 ─────────────────────────────
  function rec(type, extra = {}) {
    const meta = EVENT_TYPES[type];
    const r = {
      ts: new Date(cfg.epoch + s.t * 1000).toISOString(),
      vin: s.vin,
      station: s.station,
      side: s.side,
      operator: s.operator,
      zoneId: '',
      boltIndex: null,
      phase: s.phase === 'IDLE' ? '' : s.phase === 'DONE' ? 'C' : s.phase,
      type,
      torqueNm: null,
      angleDeg: null,
      result: meta.result,
      errorCategory: meta.category,
      ...extra,
    };
    log.push(r);
    out.records.push(r);
    return r;
  }

  function alarm(type, level, text, say = '', hold = null) {
    s.alarms = s.alarms.filter((a) => a.type !== type);
    const a = { type, level, text, say, at: s.t, until: hold == null ? null : s.t + hold };
    s.alarms.push(a);
    out.alerts.push({ ...a, side: s.side });
  }
  const clearAlarm = (...types) => (s.alarms = s.alarms.filter((a) => !types.includes(a.type)));
  function topAlarm() {
    let top = null;
    for (const a of s.alarms) {
      if (!top || PRIORITY[a.level] > PRIORITY[top.level] || (PRIORITY[a.level] === PRIORITY[top.level] && a.at >= top.at)) top = a;
    }
    return top;
  }

  // ── 階段 ───────────────────────────────────
  function startC() {
    s.phase = 'C';
    s.phaseStart = s.t;
    s.deadline = s.t + v('phaseLimit');
    s.warned = false;
    s.timedOut = false;
    alarm('READY_C', 'info', '承盤已下降，可以鎖附', '可以鎖附', 3);
  }

  function advancePhase() {
    if (s.phase === 'A' && phaseDone('A')) {
      rec('PHASE_COMPLETE', { phase: 'A' });
      clearAlarm('PHASE_WARNING', 'TIMEOUT');
      if (trayReady()) startC();
      else {
        s.phase = 'B';
        s.deadline = null;
        alarm('DONE_A', 'info', '下方螺絲完成，等待承盤下降', '', 3);
      }
    }
    if (s.phase === 'B' && trayReady()) startC();
    if (s.phase === 'C' && phaseDone('C')) {
      rec('PHASE_COMPLETE', { phase: 'C' });
      clearAlarm('PHASE_WARNING', 'TIMEOUT', 'READY_C');
      s.phase = 'DONE';
      s.deadline = null;
      rec('CYCLE_COMPLETE');
      alarm('DONE', 'info', '本車鎖附完成', '', 3);
    }
  }

  function timeout(phase) {
    s.timedOut = true;
    const n = nextBolt(phase);
    const left = zonesOf(phase).reduce((k, id) => k + s.bolts[id].filter((b) => b !== 'OK').length, 0);
    rec('TIMEOUT', { phase, zoneId: n?.zoneId ?? '', boltIndex: n?.boltIndex ?? null });
    clearAlarm('PHASE_WARNING');
    alarm('TIMEOUT', 'alarm', `超過鎖附時間：步驟 ${PHASE_STEP[phase]} 還有 ${left} 顆`, '超過鎖附時間，請盡快完成');
  }

  function automationFault(code) {
    s.automationFault = code;
    if (code === 'TRAY_STUCK') s.tray = 'STUCK';
    if (cfg.stationEvents) rec('AUTOMATION_FAULT', { phase: 'B' });
    alarm('AUTOMATION_FAULT', 'fault', `${FAULT_TEXT[code]}，步驟 3 暫停`, '承盤未下降，請通知班長');
  }

  // ── 工具狀態（含智能鎖定的致能／鎖定紀錄）────────────
  function refreshTool() {
    const prev = { tool: s.tool, reason: s.lockReason };
    let tool = 'ENABLED';
    let reason = '';
    if (s.fault) [tool, reason] = ['FAULT', 'FAULT'];
    else if (s.attempt) tool = 'RUNNING';
    else if (s.phase === 'IDLE') [tool, reason] = ['LOCKED', 'NO_VEHICLE'];
    else if (s.phase === 'DONE') [tool, reason] = ['LOCKED', 'DONE'];
    else if (s.phase === 'B') [tool, reason] = ['LOCKED', 'WAIT_TRAY'];
    else if (s.encoder && s.toolZone && s.toolZone !== expected()?.zoneId) [tool, reason] = ['LOCKED', 'WRONG_ZONE'];
    s.tool = tool;
    s.lockReason = reason;
    if (tool === 'ENABLED' && prev.tool === 'LOCKED' && ['NO_VEHICLE', 'WAIT_TRAY'].includes(prev.reason)) {
      rec('TOOL_ENABLED');
    }
    if (tool === 'LOCKED' && ['WAIT_TRAY', 'DONE'].includes(reason) && !(prev.tool === 'LOCKED' && prev.reason === reason)) {
      rec('TOOL_LOCKED');
    }
  }

  // ── 事件處理 ───────────────────────────────
  const handlers = {
    'cycle:start'(e) {
      const keepEncoder = s.encoder;
      reset();
      s.encoder = keepEncoder;
      s.t = e.t ?? 0;
      s.vin = e.vin ?? cfg.vin;
      s.operator = e.operator ?? cfg.operator;
      s.trayDueAt = e.trayDueAt ?? null;
      s.phase = 'A';
      s.phaseStart = s.t;
      s.deadline = Math.min(s.t + v('phaseLimit'), s.trayDueAt == null ? Infinity : s.trayDueAt - v('checkpointLead'));
      rec('CYCLE_START');
    },

    'tool:position'(e) {
      s.toolZone = e.zoneId ?? null;
    },

    'tool:trigger'(e) {
      if (s.fault || s.attempt || s.phase === 'IDLE' || s.phase === 'DONE') return;
      const zoneId = e.zoneId ?? (s.encoder ? s.toolZone : null);
      const zone = zoneId ? zoneById(zoneId) : null;
      if (zone && zone.side !== s.side) return;

      // 下方螺絲還沒鎖就跑去鎖上方：錯誤步驟（需要編碼器才知道工具在哪個孔位）
      const skippedA = zone && zone.phase === 'C' && s.phase === 'A' && !phaseDone('A');
      // 下方鎖完、承盤還沒降下來就要鎖上方：降前鎖附，控制器不讓工具轉
      if (!skippedA && (s.phase === 'B' || (zone && zone.phase === 'C' && !trayReady()))) {
        const target = zone ?? zoneById(nextBolt('C')?.zoneId ?? zonesOf('C')[0]);
        rec('EARLY_ATTEMPT', { zoneId: target.id, boltIndex: nextInZone(target.id) });
        alarm('EARLY_ATTEMPT', 'alarm', '降前鎖附！承盤尚未下降', '降前鎖附！降前鎖附！', v('alarmHold'));
        return;
      }

      const exp = expected();
      if (!exp) return;
      if (zone && zone.id !== exp.zoneId) {
        const want = zoneById(exp.zoneId).label;
        rec('SEQUENCE_ERROR', { zoneId: zone.id, boltIndex: nextInZone(zone.id) });
        alarm('SEQUENCE_ERROR', 'alarm', `錯誤步驟：請先鎖${want}`, `錯誤步驟，請先鎖${want}`, v('alarmHold'));
        return;
      }
      s.attempt = { ...exp };
    },

    'tool:torque'(e) {
      if (!s.attempt) return;
      const { zoneId, boltIndex } = s.attempt;
      s.attempt = null;
      const sp = cfg.spec[zoneId];
      const target = sp.torque.v;
      const lo = +(target * (1 - sp.tol.v / 100)).toFixed(1);
      const hi = +(target * (1 + sp.tol.v / 100)).toFixed(1);
      const torqueNm = +e.torqueNm.toFixed(1);
      const angleDeg = Math.round(e.angleDeg);
      let reason = '';
      if (torqueNm < lo) reason = 'LOW';
      else if (torqueNm > hi) reason = 'HIGH';
      else if (angleDeg < sp.angleMin.v || angleDeg > sp.angleMax.v) reason = 'ANGLE';
      const base = { zoneId, boltIndex, torqueNm, angleDeg };
      s.last = { ...base, result: reason ? 'NG' : 'OK', reason, lo, hi };

      if (!reason) {
        s.bolts[zoneId][boltIndex] = 'OK';
        if (s.rework && s.rework.zoneId === zoneId && s.rework.boltIndex === boltIndex) s.rework = null;
        clearAlarm('TIGHTEN_NG', 'TOOL_RECOVERED');
        rec('TIGHTEN_OK', base);
        advancePhase();
        return;
      }
      s.bolts[zoneId][boltIndex] = 'NG';
      s.rework = { zoneId, boltIndex };
      rec('TIGHTEN_NG', base);
      const msg = {
        LOW: [`扭力不足 ${torqueNm} N·m（下限 ${lo}）`, '扭力不足，請重鎖'],
        HIGH: [`扭力過高 ${torqueNm} N·m（上限 ${hi}）`, '扭力過高，請檢查後重鎖'],
        ANGLE: [`角度異常 ${angleDeg}°（${sp.angleMin.v}–${sp.angleMax.v}°）`, '角度異常，請重鎖'],
      }[reason];
      alarm('TIGHTEN_NG', 'alarm', msg[0], msg[1]);
    },

    'tray:lowering'() {
      if (s.tray === 'DOWN') return;
      s.tray = 'LOWERING';
      s.trayAt = s.t;
      if (cfg.stationEvents) rec('TRAY_LOWERING', { phase: 'B' });
      if (s.phase === 'A' && !s.timedOut && !phaseDone('A')) timeout('A');
    },

    'tray:lowered'() {
      if (s.tray === 'DOWN') return;
      s.tray = 'DOWN';
      s.automationFault = null;
      clearAlarm('AUTOMATION_FAULT');
      if (cfg.stationEvents) rec('TRAY_LOWERED', { phase: 'B' });
      advancePhase();
    },

    'tool:fault'(e) {
      if (s.fault) return;
      const aborted = s.attempt;
      s.attempt = null;
      s.fault = e.code || 'COMM_LOST';
      rec('TOOL_FAULT', { zoneId: aborted?.zoneId ?? '', boltIndex: aborted?.boltIndex ?? null });
      const comm = s.fault === 'COMM_LOST'; // 系統異常 B 專指扭矩槍訊號中斷，其他工具問題照舊叫工具異常
      alarm('TOOL_FAULT', 'fault', `${comm ? '系統異常 B' : '工具異常'}：${FAULT_TEXT[s.fault] ?? s.fault}`, comm ? '扭矩槍訊號中斷，請通知班長' : '工具異常，請通知班長');
    },

    'tool:recover'() {
      if (!s.fault) return;
      s.fault = null;
      clearAlarm('TOOL_FAULT');
      rec('TOOL_RECOVERED');
      alarm('TOOL_RECOVERED', 'info', '工具恢復，從未完成的那一顆繼續', '工具恢復', 3);
    },

    'bypass:on'() {
      if (s.bypass) return;
      s.bypass = true;
      rec('BYPASS_ON');
      alarm('BYPASS', 'warn', '降級模式：承盤連鎖暫停，全程記錄', '已切換降級模式');
      advancePhase();
    },

    'bypass:off'() {
      if (!s.bypass) return;
      s.bypass = false;
      clearAlarm('BYPASS');
      rec('BYPASS_OFF');
    },

    timer() {
      const ph = s.phase === 'A' || s.phase === 'C' ? s.phase : null;
      if (ph && s.deadline != null && Number.isFinite(s.deadline)) {
        const left = s.deadline - s.t;
        if (!s.warned && left <= v('phaseWarnLead')) {
          s.warned = true;
          if (left > 0) {
            rec('PHASE_WARNING', { phase: ph });
            const n = Math.ceil(left);
            alarm('PHASE_WARNING', 'warn', `步驟 ${PHASE_STEP[ph]} 剩 ${n} 秒`, `還剩${n}秒`);
          }
        }
        if (!s.timedOut && left <= 0) timeout(ph);
      }
      if (!s.automationFault) {
        if (s.tray === 'LOWERING' && s.t - s.trayAt > v('trayFaultTimeout')) automationFault('TRAY_STUCK');
        else if (s.tray === 'UP' && s.trayDueAt != null && s.t > s.trayDueAt + v('trayFaultTimeout')) automationFault('TRAY_NOT_STARTED');
      }
    },
  };

  function snapshot() {
    const st = structuredClone(s);
    st.alarm = topAlarm();
    st.expected = expected();
    st.counts = Object.fromEntries(['A', 'C'].map((ph) => {
      const ids = zonesOf(ph);
      const total = ids.reduce((k, id) => k + s.bolts[id].length, 0);
      const done = ids.reduce((k, id) => k + s.bolts[id].filter((b) => b === 'OK').length, 0);
      return [ph, { done, total }];
    }));
    st.remaining = s.deadline != null && Number.isFinite(s.deadline) && (s.phase === 'A' || s.phase === 'C')
      ? Math.max(0, s.deadline - s.t) : null;
    return st;
  }

  function dispatch(e) {
    out = { records: [], alerts: [] };
    if (e.t != null) s.t = Math.max(s.t, e.t);
    const h = handlers[e.type];
    if (h) h(e);
    s.alarms = s.alarms.filter((a) => a.until == null || a.until > s.t);
    refreshTool();
    return { state: snapshot(), ...out };
  }

  return {
    dispatch,
    getState: snapshot,
    get records() { return log.slice(); },
    setSpec(spec) { cfg.spec = spec; },
    setEncoder(on) {
      s.encoder = !!on;
      if (!on) s.toolZone = null;
      return dispatch({ type: 'noop' });
    },
    reset() { reset(); log.length = 0; },
  };
}

// 工具與控制器的燈號（由狀態推導，模型與畫面共用）
// ring：工具握把 LED 環；stack：控制器三色燈（red / yellow / green：'on' | 'blink' | 'off'）
export function signalsFor(state) {
  const a = state.alarm;
  const stack = { red: 'off', yellow: 'off', green: 'off' };
  let ring = 'off';
  let ringBlink = false;
  switch (state.tool) {
    case 'FAULT': ring = 'red'; ringBlink = true; stack.red = 'blink'; break;
    case 'RUNNING': ring = 'blue'; stack.green = 'on'; break;
    case 'ENABLED': ring = 'green'; stack.green = 'on'; break;
    default:
      if (state.lockReason === 'WRONG_ZONE') { ring = 'yellow'; ringBlink = true; stack.green = 'on'; }
      else if (state.lockReason === 'WAIT_TRAY') { ring = 'yellow'; stack.yellow = 'on'; }
      else if (state.lockReason === 'DONE') { stack.green = 'on'; }
  }
  let haptic = false;
  if (a && (a.level === 'alarm' || a.level === 'fault')) {
    stack.red = a.level === 'fault' ? 'blink' : 'on';
    if (['EARLY_ATTEMPT', 'SEQUENCE_ERROR', 'TIGHTEN_NG'].includes(a.type)) {
      ring = 'red';
      ringBlink = a.type !== 'TIGHTEN_NG';
      haptic = true;
    }
  } else if (a && a.level === 'warn') {
    stack.yellow = 'blink';
  }
  const label = state.tool === 'LOCKED' ? TOOL_TEXT.LOCKED[state.lockReason] ?? '已鎖定' : TOOL_TEXT[state.tool];
  return { ring, ringBlink, stack, haptic, label };
}

// 手臂螢幕的大字步驟
export function describe(state) {
  const tray = { UP: '承盤撐起', LOWERING: '承盤下降中', DOWN: '承盤已下降', STUCK: '承盤異常' }[state.tray];
  switch (state.phase) {
    case 'IDLE': return { step: '—', title: '等待車輛進站', sub: '工具待機', tone: 'muted', tray };
    case 'A': return {
      step: '1', title: '鎖下方螺絲', tone: 'orange', tray,
      sub: state.tray === 'UP' ? '左下、右下' : `${tray}・請補完下方螺絲`,
    };
    case 'B': return {
      step: '2', title: state.tray === 'LOWERING' ? '承盤下降中' : '等待承盤下降', tone: 'yellow', tray,
      sub: '下方螺絲完成・工具已鎖定',
    };
    case 'C': return { step: '3', title: '鎖上方螺絲', sub: '左上、右上', tone: 'teal', tray };
    default: return { step: '✓', title: '本車完成', sub: '工具已鎖定，等待下一台', tone: 'green', tray };
  }
}
