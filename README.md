# 改良版鎖附手臂｜互動原型

引擎組裝站（引擎腳與變速箱組裝）IoT 防錯提案的網頁原型。純前端，Three.js 0.160.0 由 CDN 載入，不需建置。

## 怎麼打開

```bash
python3 -m http.server 8795
```

打開 http://localhost:8795 。因為使用 ES module，不能直接雙擊 `index.html`。可用網址 hash 直接開分頁：`#arm`、`#settings`、`#screen`、`#trace`、`#compare`。

## 畫面

- **手臂與情境**：3D 手臂（可旋轉、點部件看說明）＋ 7 種情境播放（中文語音，右上角可靜音）。
- **師傅設定**：只設定扭力、容差、角度。
- **站旁螢幕**：大字步驟與警示，可全螢幕。
- **事後追溯**：每顆螺絲一筆履歷，可篩選、匯出 CSV／JSON。
- **現況 vs 改良後**：對照三大痛點、三項原則、否決點子、故障對策。

## 改良點與業主原則

原則：① 不增加動作 ② 從工具思考 ③ 妥善率

| # | 改良點 | 原則 |
|---|---|---|
| 1 | 工具內建致能／鎖定（依承盤 PLC 訊號、計數） | ①② |
| 2 | 扭力／角度感測，當場判 OK／NG | ② |
| 3 | 握把 LED 環＋震動（工具內建，不是外掛） | ① |
| 4 | 控制器三色燈＋喇叭（固定在軌道吊架） | ①③ |
| 5 | 關節編碼器（選配，評估中） | ①②③ |
| 6 | 承盤 PLC 訊號 I/O | ②③ |
| 7 | 班長鑰匙開關（降級模式） | ③ |

**編碼器評估結論**：不違反原則一、二；原則三有風險但可控（輸送線位置補償、螺絲間距約 0.1 m、需定期校正）。建議只判到「區域」、列為第二期選配；編碼器故障時只關閉順序檢查，承盤連鎖照常。

## 假設值

全部集中在 [`js/arm-params.js`](js/arm-params.js)，每項格式 `{ v, unit, label, src, status }`，狀態為 `confirmed`／`derived`／`assumed`。主要假設：

- 扭力：引擎腳 65 N·m、變速箱 50 N·m、車身固定點 90 N·m，容差 ±10%；角度 30–120°
- 螺絲數：Z1L 3、Z1R 3、Z1T 2、Z2L 2、Z2R 2；SOP 順序 L：Z1L → Z1T → B → Z2L，R：Z1R → B → Z2R
- 階段時間上限 90 秒（業主答 60–90 秒的上限），剩 15 秒預警
- 承盤開始下降 8 秒沒降到底 → 自動化錯誤
- 手臂幾何（臂長、平衡器長度等）、工位代號、電池門檻、通訊逾時
- 情境時間軸為示意、已壓縮（每顆約 4.5 秒，承盤 45 秒下降）

## 整合介面

座標與場域模型一致：公尺、Y 向上、車頭 +Z、+X 為車輛左側；高台面 y = 1.42；吊點 x = ±0.925、y = 3.99。

```js
import { createSmartArm } from './js/arm-model.js';
import { createArmLogic } from './js/arm-logic.js';

const arm = createSmartArm({ side: 'L' });   // THREE.Group，原點＝軌道吊點，預設已放在吊點
scene.add(arm);                               // 需要場景有 CSS2DRenderer 才看得到標籤
const logic = createArmLogic({ side: 'L', vin, operator, epoch: Date.now() });

const { state, records, alerts } = logic.dispatch({ type: 'cycle:start', t: 0, trayDueAt: T.checkpoint });
arm.setState(state);
arm.setToolTarget(new THREE.Vector3(x, y, z)); // 世界座標；setToolRest() 回待命
arm.update(dt, time);                          // 每幀
```

- `js/arm-params.js`：所有數值、`ZONES`、`SEQUENCE`、`SPEC`、`boltPosition()`
- `js/arm-logic.js`：純狀態機（不碰 DOM／Three.js），另有 `signalsFor(state)`（燈號）、`describe(state)`（螢幕文字）
- `js/arm-model.js`：3D 模型、`ARM_PARTS`（改良點說明）
- `js/scenarios.js`、`js/main.js`、`index.html`、`css/`：UI 層

承盤事件只由一側的實例記錄（`stationEvents: true`），另一側設 `false`，避免追溯資料重複。

### 輸入事件

`cycle:start`、`tool:position`（編碼器回報區域）、`tool:trigger`、`tool:torque`、`tray:lowering`、`tray:lowered`、`tool:fault`、`tool:recover`、`bypass:on`、`bypass:off`、`timer`

### 事件紀錄

```json
{ "ts": "", "vin": "", "station": "", "side": "", "operator": "", "zoneId": "", "boltIndex": 0, "phase": "", "type": "", "torqueNm": 0, "angleDeg": 0, "result": "", "errorCategory": "" }
```

`boltIndex` 從 0 起算；不適用的欄位為 `null`。`result`：`OK`、`NG`、`BLOCKED`、`WARN`、`FAULT`、`INFO`。`errorCategory`：`AUTOMATION`（自動化錯誤）、`TOOL`（工具錯誤）、`OPERATION`（作業異常）或空字串。

| type | 說明 | errorCategory |
|---|---|---|
| CYCLE_START | 車輛進站 | |
| TOOL_ENABLED | 工具致能 | |
| TOOL_LOCKED | 工具鎖定（等承盤、完成） | |
| TIGHTEN_OK | 鎖附 OK | |
| TIGHTEN_NG | 鎖附 NG（扭力不足／過高、角度異常） | OPERATION |
| EARLY_ATTEMPT | 提前鎖附（已攔下） | OPERATION |
| SEQUENCE_ERROR | 順序錯誤（已攔下，需編碼器） | OPERATION |
| PHASE_WARNING | 即將超時 | |
| TIMEOUT | 超過鎖附時間 | OPERATION |
| PHASE_COMPLETE | 階段完成 | |
| TRAY_LOWERING | 承盤開始下降 | |
| TRAY_LOWERED | 承盤下降完成 | |
| AUTOMATION_FAULT | 承盤逾時、未依節拍下降 | AUTOMATION |
| TOOL_FAULT | 通訊中斷、電池、感測器異常 | TOOL |
| TOOL_RECOVERED | 工具恢復 | |
| BYPASS_ON / BYPASS_OFF | 班長鑰匙降級模式 | |
| CYCLE_COMPLETE | 本車完成 | |
