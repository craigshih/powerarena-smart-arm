// 改良版鎖附手臂參數：長度單位公尺、時間秒、角度度、扭力 N·m。
// 座標系與場域模型（powerarena-station-twin）一致：
//   Y 向上；車頭朝 +Z；+X 為車輛左側。地板 y = 0，高台面 y = 1.42。
//
// 每個參數都標註來源與狀態：
//   confirmed — 訪綱中業主直接回答的數值
//   derived   — 由已確認數值推算
//   assumed   — 目前為合理假設，待業主或工具供應商補充

export const SRC = {
  V2: '10/16 訪綱 2',
  V1: '10/07 訪綱',
  TWIN: '場域模型 params.js',
  ASM: '假設值',
};

const p = (v, unit, label, src, status, note = '') => ({ v, unit, label, src, status, note });

export const P = {
  // ── 場域座標（沿用場域模型）──────────────────
  platformHeight: p(1.42, 'm', '地板到高台面', SRC.V2, 'confirmed'),
  platformInnerX: p(0.845, 'm', '兩側高台內緣 |x|', SRC.V2, 'derived', '高台間距 1.69 ÷ 2'),
  bayWidth: p(1.935, 'm', '引擎室寬', SRC.V2, 'confirmed'),
  railY: p(3.99, 'm', '上方工具軌道吊點高度', SRC.TWIN, 'derived', '高台 1.42 ＋ 吊架 2.62 − 0.05'),
  railX: p(0.925, 'm', '上方工具軌道吊點 |x|', SRC.TWIN, 'derived', '高台內緣 ＋ 0.08'),
  railZMin: p(-0.7, 'm', '台車可移動範圍（後端 z）', SRC.TWIN, 'derived', '吊架後柱 z = −0.8 內縮'),
  railZMax: p(3.4, 'm', '台車可移動範圍（前端 z）', SRC.TWIN, 'derived', '門型吊架 z = 3.55 內縮'),

  // ── 手臂幾何 ──────────────────────────────
  columnDrop: p(0.42, 'm', '台車到水平臂的垂直距離', SRC.ASM, 'assumed'),
  link1: p(0.45, 'm', '第一節水平臂長', SRC.ASM, 'assumed'),
  link2: p(0.42, 'm', '第二節水平臂長', SRC.ASM, 'assumed'),
  tubeLength: p(0.6, 'm', '平衡器外管長', SRC.ASM, 'assumed'),
  toolLength: p(0.36, 'm', '鎖附工具全長（含套筒）', SRC.ASM, 'assumed'),
  trolleyLead: p(0.3, 'm', '台車落後工具的距離', SRC.ASM, 'assumed', '讓兩節臂保持彎曲、不打直'),

  // ── 承盤與時序 ────────────────────────────
  trayDrop: p(0.45, 'm', '承盤下降距離', SRC.V2, 'derived', '業主估 0.40–0.50 m'),
  trayDuration: p(4, 's', '承盤下降歷時', SRC.V2, 'confirmed', '目測約 4 秒'),
  trayFaultTimeout: p(8, 's', '承盤下降逾時判定', SRC.ASM, 'assumed', '正常 4 秒的兩倍'),
  phaseNominal: p(78, 's', '單一階段標準鎖附時間', SRC.V2, 'derived', '業主答 60–90 秒，取中間值'),
  phaseLimit: p(90, 's', '單一階段鎖附時間上限', SRC.V2, 'derived', '取業主答 60–90 秒的上限'),
  phaseWarnLead: p(15, 's', '超時前預警', SRC.ASM, 'assumed'),
  checkpointLead: p(2, 's', '檢查點前完成緩衝', SRC.V1, 'confirmed', '實際秒數待技術人員確認'),
  alarmHold: p(4, 's', '一次性警示的顯示時間', SRC.ASM, 'assumed', '提前鎖附、順序錯誤'),

  // ── 工具與感測 ────────────────────────────
  batteryLowPct: p(15, '%', '電池低電量門檻', SRC.ASM, 'assumed', '若採無線工具'),
  commTimeout: p(0.5, 's', '通訊中斷判定', SRC.ASM, 'assumed', '超過即視為斷線，工具預設鎖住'),
  encoderZoneTol: p(0.06, 'm', '編碼器區域判定容差', SRC.ASM, 'assumed', '只判斷到「哪個區域」，不到哪一顆'),

  // ── 手臂螢幕 ──────────────────────────────
  screenSize: p(10.1, '吋', '手臂螢幕尺寸', SRC.ASM, 'assumed', '工業級觸控面板，只顯示不需操作'),
  screenBrightness: p(1000, 'nits', '螢幕亮度', SRC.ASM, 'assumed', '廠房頂燈下仍看得清楚'),
  screenRating: p('IP65・防震', '', '防護等級', SRC.ASM, 'assumed', '油污、粉塵與手臂晃動'),
  screenDistance: p(0.5, 'm', '師傅眼睛到螢幕距離', SRC.ASM, 'assumed', '彎腰鎖附時'),
  screenMount: p('平衡器外管下端', '', '安裝位置', SRC.ASM, 'assumed', '跟著工具移動，不在工具本體'),

  // ── 追溯欄位 ──────────────────────────────
  station: p('ENG-07', '', '工位代號', SRC.ASM, 'assumed'),
};

// 鎖附區域：id、階段、位置沿用場域模型的 ZONES（pos.y 以高台面為 0）。
// 螺絲數量、位置皆為假設。
export const ZONES = [
  { id: 'Z1L', phase: 'A', side: 'L', label: '左引擎腳', pos: [0.56, 0.62, 1.78], size: [0.26, 0.22, 0.26], bolts: 3 },
  { id: 'Z1R', phase: 'A', side: 'R', label: '右引擎腳', pos: [-0.56, 0.62, 1.78], size: [0.26, 0.22, 0.26], bolts: 3 },
  { id: 'Z1T', phase: 'A', side: 'L', label: '變速箱固定點', pos: [0.5, 0.48, 1.34], size: [0.24, 0.2, 0.24], bolts: 2 },
  { id: 'Z2L', phase: 'C', side: 'L', label: '車身固定點（左）', pos: [0.72, 0.3, 1.5], size: [0.2, 0.18, 0.5], bolts: 2 },
  { id: 'Z2R', phase: 'C', side: 'R', label: '車身固定點（右）', pos: [-0.72, 0.3, 1.5], size: [0.2, 0.18, 0.5], bolts: 2 },
];

// SOP 順序：每側依序鎖附的區域（假設）。B 為承盤下降，兩側共用。
export const SEQUENCE = {
  L: ['Z1L', 'Z1T', 'Z2L'],
  R: ['Z1R', 'Z2R'],
};
export const SEQUENCE_STATUS = p('L：Z1L → Z1T → B → Z2L；R：Z1R → B → Z2R', '', 'SOP 鎖附順序', SRC.ASM, 'assumed');

// 每個區域的鎖附規格（扭力、容差、角度窗）。師傅設定頁只改這裡的值。
const spec = (zone, torque, tol, angleMin, angleMax, pset) => ({
  torque: p(torque, 'N·m', `${zone} 目標扭力`, SRC.ASM, 'assumed'),
  tol: p(tol, '%', `${zone} 扭力容差 ±`, SRC.ASM, 'assumed'),
  angleMin: p(angleMin, '°', `${zone} 最小角度`, SRC.ASM, 'assumed'),
  angleMax: p(angleMax, '°', `${zone} 最大角度`, SRC.ASM, 'assumed'),
  pset: p(pset, '', `${zone} 控制器程式號（Pset）`, SRC.ASM, 'assumed'),
});

export const SPEC = {
  Z1L: spec('左引擎腳', 65, 10, 30, 120, 1),
  Z1R: spec('右引擎腳', 65, 10, 30, 120, 1),
  Z1T: spec('變速箱固定點', 50, 10, 30, 120, 2),
  Z2L: spec('車身固定點（左）', 90, 10, 30, 120, 3),
  Z2R: spec('車身固定點（右）', 90, 10, 30, 120, 3),
};

export const zoneById = (id) => ZONES.find((z) => z.id === id);
export const zonesFor = (side, phase) => SEQUENCE[side].map(zoneById).filter((z) => !phase || z.phase === phase);

// 螺絲世界座標：沿區域較長的水平邊平均分布，高度取區域中心。
export function boltPosition(zoneId, index) {
  const z = zoneById(zoneId);
  const H = P.platformHeight.v;
  const n = z.bolts;
  const f = n === 1 ? 0 : (index / (n - 1) - 0.5) * 0.6;
  const alongZ = z.size[2] >= z.size[0];
  return [
    z.pos[0] + (alongZ ? 0 : f * z.size[0]),
    H + z.pos[1],
    z.pos[2] + (alongZ ? f * z.size[2] : 0),
  ];
}

// 手臂吊點（世界座標）。createSmartArm 預設放在這裡，場域模型整合時可覆寫。
export function armMount(side) {
  const s = side === 'L' ? 1 : -1;
  return [s * P.railX.v, P.railY.v, 0];
}

// 參數表分組（UI 與 README 共用）
export const PARAM_GROUPS = [
  ['場域座標（沿用場域模型）', ['platformHeight', 'platformInnerX', 'bayWidth', 'railY', 'railX', 'railZMin', 'railZMax']],
  ['手臂幾何', ['columnDrop', 'link1', 'link2', 'tubeLength', 'toolLength', 'trolleyLead']],
  ['承盤與時序', ['trayDrop', 'trayDuration', 'trayFaultTimeout', 'phaseNominal', 'phaseLimit', 'phaseWarnLead', 'checkpointLead', 'alarmHold']],
  ['工具與感測', ['batteryLowPct', 'commTimeout', 'encoderZoneTol', 'station']],
  ['手臂螢幕', ['screenSize', 'screenBrightness', 'screenRating', 'screenDistance', 'screenMount']],
];
