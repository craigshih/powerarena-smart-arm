# 改良版鎖附手臂｜互動原型

引擎組裝站（引擎腳與變速箱組裝）IoT 防錯提案的網頁原型。純前端，Three.js 0.160.0 由 CDN 載入，不需建置。

## 怎麼打開

線上版：https://craigshih.github.io/powerarena-smart-arm/

本機：

```bash
python3 -m http.server 8795
```

打開 http://localhost:8795 。因為使用 ES module，不能直接雙擊 `index.html`。網站預設打開「廠房情境」。可用網址 hash 直接開分頁：`#station`、`#product`、`#arm`、`#settings`、`#sim`、`#compare`、`#trace`（舊的 `#screen` 會捲到手臂螢幕區塊）。網址加 `?debug` 時可在主控台用 `__step(dt, n)` 手動推進畫面（背景分頁不跑動畫時測試用）。

## 畫面

導覽列四大項，所在大項會展開子項。整體以 mock-up 為主，文字精簡，細節口頭說明。畫面用詞與同事的主管端模組統一：降前鎖附、扭力不足、錯誤步驟、系統異常 A：承盤異常、系統異常 B：扭矩槍訊號中斷、智能鎖定、機器手臂 L／R。

- **廠房情境**（預設首頁）：場域模型（powerarena-station-twin）的情境站：3 分鐘標準作業時間軸、1-2-3 流程條、三支攝影機子畫面與標註框、視角與圖層，懸吊工具換成改良版手臂與會動的師傅。
- **手臂**
  - **介紹**：只有手臂本身的 3D 展示。新款、舊款、並排、廠房實境四種顯示；點部件會放大到那個部件，右側一行「新款 vs 舊款」。狀態按鈕把手臂切到不同時刻，每個狀態有自己的顏色、圖示、工具光暈與狀態徽章，並對準工具與手臂螢幕。下方是手臂螢幕實機放大與它對師傅的作用。
  - **情境演練**：7 種情境播放（中文語音，可靜音）。右側每側一塊：手臂螢幕畫面、聲音、師傅處置。七種情境各有自己的 3D 示警（顏色、圖示、光柱、標記、畫面邊框），出錯時鏡頭可自動跟過去。
  - **鎖附參數設定**：只設扭力、容差、角度。
- **現在 vs 改良後**
  - **實境對比**：同一位師傅、同一段動作，左邊現行手臂、右邊 IoT 手臂。章節按鈕（開始、出錯的那一刻、承盤下降、鎖上方、完成）與時間軸可直接跳到要看的地方。
  - **對照表**：三大痛點、三項原則、故障時，各一行。
- **異常事件追溯**：每顆螺絲一筆履歷，可篩選，匯出 PDF（A4 橫式）、CSV、JSON。

所有 3D 場景（高台、車輛、散熱器、四個螺絲孔位、承盤、滑軌、吊架、攝影機）都直接使用場域模型的 `buildStation`，見 `js/twin/`。

## 改良點與業主原則

原則：① 不增加動作 ② 從工具思考 ③ 妥善率

| # | 改良點 | 原則 |
|---|---|---|
| 1 | 工具內建智能鎖定（依承盤 PLC 訊號、計數致能／鎖定） | ①② |
| 2 | 扭力／角度感測，當場判 OK／NG | ② |
| 3 | 握把 LED 環＋震動（工具內建，不是外掛） | ① |
| 4 | 控制器三色燈＋喇叭（固定在軌道吊架） | ①③ |
| 5 | 關節編碼器（選配，評估中） | ①②③ |
| 6 | 承盤 PLC 訊號 I/O | ②③ |
| 7 | 班長鑰匙開關（降級模式） | ③ |
| 8 | 手臂螢幕（裝在平衡器外管下端，跟著工具移動、面向師傅） | ①③ |

**手臂螢幕**：低頭看工具時螢幕就在視線裡，錯了當場看得到哪一顆、怎麼修正。螢幕裝在手臂外管上、不在工具本體；業主曾否決「在鎖附機器上加裝裝置」，這個位置是否可接受需再確認。

**編碼器評估結論**：不違反原則一、二；原則三有風險但可控（輸送線位置補償、螺絲間距約 0.1 m、需定期校正）。建議只判到「區域」、列為第二期選配；編碼器故障時只關閉順序檢查，承盤連鎖照常。

## 假設值

全部集中在 [`js/arm-params.js`](js/arm-params.js)，每項格式 `{ v, unit, label, src, status }`，狀態為 `confirmed`／`derived`／`assumed`。主要假設：

- 螺絲孔位與順序沿用場域模型（團隊現場紀錄）：步驟 1 左下 Z1L、右下 Z1R → 步驟 2 承盤下降 → 步驟 3 左上 Z2L、右上 Z2R，各 1 顆；孔位座標為示意
- 扭力：下方 65 N·m、上方 90 N·m，容差 ±10%；角度 30–120°
- 階段時間上限 90 秒（業主答 60–90 秒的上限），剩 15 秒預警
- 承盤開始下降 8 秒沒降到底 → 系統異常 A：承盤異常
- 錯誤步驟＝下方還沒鎖就去鎖上方（需編碼器）；降前鎖附＝下方鎖完、承盤還沒降就去鎖上方
- 手臂幾何、手臂螢幕與零件規格、工位代號、電池門檻、通訊逾時
- 情境演練與實境對比的時間軸為示意、已壓縮（每顆約 4.5 秒，承盤 26 秒下降）；廠房情境用場域模型的 3 分鐘時間軸

## 整合介面

座標與場域模型一致：公尺、Y 向上、車頭 +Z、+X 為車輛左側；高台面 y = 1.42；吊點 x = ±0.925、y = 3.99。

```js
import { createSmartArm } from './js/arm-model.js';
import { createArmLogic } from './js/arm-logic.js';

const arm = createSmartArm({ side: 'L' });   // THREE.Group，原點＝軌道吊點，預設已放在吊點
// createSmartArm({ side, legacy: true }) 畫出現行手臂（沒有控制器、編碼器、LED 環、手臂螢幕）
scene.add(arm);                               // 需要場景有 CSS2DRenderer 才看得到標籤
const logic = createArmLogic({ side: 'L', vin, operator, epoch: Date.now() });

const { state, records, alerts } = logic.dispatch({ type: 'cycle:start', t: 0, trayDueAt: T.checkpoint });
arm.setState(state);
arm.setToolTarget(new THREE.Vector3(x, y, z)); // 世界座標；setToolRest() 回待命
arm.update(dt, time);                          // 每幀
arm.getGrip();  arm.getToolTop();  arm.getControllerPos();   // 握把、工具頂端、控制器燈號的世界座標
drawArmScreen(canvas.getContext('2d'), state, 'L');          // 把手臂螢幕畫面畫到任何 canvas（基準 480 × 320）
```

- `js/arm-params.js`：所有數值、`ZONES`、`SEQUENCE`、`SPEC`、`boltPosition()`
- `js/arm-logic.js`：純狀態機（不碰 DOM／Three.js），另有 `signalsFor(state)`（燈號）、`describe(state)`（螢幕文字）
- `js/arm-model.js`：3D 模型、`ARM_PARTS`（改良點說明）
- `js/twin/params.js`、`js/twin/scene.js`：從場域模型原封不動複製（標明 commit），場域模型更新時整份重新複製
- UI 層：`js/station-view.js`（廠房情境）、`js/scenarios.js`（情境腳本與播放引擎）、`js/environment.js`（工站環境）、`js/operator.js`（會動的師傅 `createOperator({ side })`）、`js/sim.js`（現行 vs IoT 實境）、`js/alert-fx.js`（3D 示警 `createAlertFx(scene)`）、`js/product-view.js`（手臂介紹）、`js/main.js`、`index.html`、`css/`

承盤事件只由一側的實例記錄（`stationEvents: true`），另一側設 `false`，避免追溯資料重複。

### 輸入事件

`cycle:start`、`tool:position`（編碼器回報區域）、`tool:trigger`、`tool:torque`、`tray:lowering`、`tray:lowered`、`tool:fault`、`tool:recover`、`bypass:on`、`bypass:off`、`timer`

### 事件紀錄

```json
{ "ts": "", "vin": "", "station": "", "side": "", "operator": "", "zoneId": "", "boltIndex": 0, "phase": "", "type": "", "torqueNm": 0, "angleDeg": 0, "result": "", "errorCategory": "" }
```

`boltIndex` 從 0 起算；不適用的欄位為 `null`。`result`：`OK`、`NG`、`BLOCKED`、`WARN`、`FAULT`、`INFO`。`errorCategory`：`AUTOMATION`（系統異常 A：承盤異常）、`TOOL`（系統異常 B：扭矩槍訊號中斷）、`OPERATION`（作業異常）或空字串。

| type | 說明 | errorCategory |
|---|---|---|
| CYCLE_START | 車輛進站 | |
| TOOL_ENABLED | 工具致能 | |
| TOOL_LOCKED | 工具鎖定（等承盤、完成） | |
| TIGHTEN_OK | 鎖附 OK | |
| TIGHTEN_NG | 鎖附 NG（扭力不足／過高、角度異常） | OPERATION |
| EARLY_ATTEMPT | 降前鎖附（已攔下） | OPERATION |
| SEQUENCE_ERROR | 錯誤步驟（已攔下，需編碼器） | OPERATION |
| PHASE_WARNING | 即將超時 | |
| TIMEOUT | 超過鎖附時間 | OPERATION |
| PHASE_COMPLETE | 階段完成 | |
| TRAY_LOWERING | 承盤開始下降 | |
| TRAY_LOWERED | 承盤下降完成 | |
| AUTOMATION_FAULT | 系統異常 A：承盤異常（逾時、未依節拍下降） | AUTOMATION |
| TOOL_FAULT | 系統異常 B：扭矩槍訊號中斷（電池、感測器異常也記在這類） | TOOL |
| TOOL_RECOVERED | 扭矩槍恢復 | |
| BYPASS_ON / BYPASS_OFF | 班長鑰匙降級模式 | |
| CYCLE_COMPLETE | 本車完成 | |
