# 改良版鎖附手臂｜互動原型

引擎組裝站（引擎腳與變速箱組裝）IoT 防錯提案的網頁原型。純前端，Three.js 0.160.0 由 CDN 載入，不需建置。

## 怎麼打開

線上版：https://craigshih.github.io/powerarena-smart-arm/

本機：

```bash
python3 -m http.server 8795
```

打開 http://localhost:8795 。因為使用 ES module，不能直接雙擊 `index.html`。網站預設打開「手臂介紹」。可用網址 hash 直接開分頁：`#product`、`#arm`、`#sim`、`#settings`、`#screen`、`#trace`、`#compare`。網址加 `?debug` 時可在主控台用 `__step(dt, n)` 手動推進畫面（背景分頁不跑動畫時測試用）。

## 畫面

- **手臂介紹**：只有手臂本身，放在展示台上。以新款（含手臂螢幕）為主，可切舊款或兩支並排對比、自動旋轉、標示新增部件；點 3D 上的編號或右側清單看每個新功能的「舊款 vs 新款」；下方狀態按鈕（可鎖附、鎖附中、等承盤、提前鎖附、扭力不足、工具故障、本車完成）把新舊兩支手臂切到同一時刻比較；最後是新舊對照表、沿用 vs 新增部件與手臂尺寸。
- **手臂與情境**：3D 手臂（可旋轉、點部件看說明）＋ 7 種情境播放（中文語音，右上角可靜音）。師傅會依工具位置伸手、彎腰，等待時轉身做別的事，聽到提示會轉頭；視角可切左右手臂與左右工具特寫；勾選「出錯時鏡頭對準出錯位置」時，鏡頭會自動轉到出錯的那一側。
- **3D 示警**：七種情境各有自己的顏色、圖示與標記，畫面邊框也跟著變色——提前鎖附（紅，螺絲打叉＋承盤框「承盤未下降」）、順序錯誤（洋紅，錯的區域打叉、箭頭指向綠圈那顆）、扭力不足（紅，NG 那顆脈動並寫出實際扭力與下限）、即將超時／超時（黃／橘，下一顆外圍倒數圈）、自動化錯誤（紫，整個承盤框起來）、工具錯誤（橘，工具外圍光暈）、正常（每鎖好一顆冒出綠勾與扭力，完成時「本車完成」）。「現行 vs IoT」頁只有 IoT 那一側有示警。
- **車體輸送滑軌**：坑道地面兩條導軌、枕木、承載台車與行進方向箭頭（原型中車輛靜止顯示）。
- **現行 vs IoT 實境**：同一位師傅、同一段動作同時播兩次。左邊是現行手臂（工具隨時能轉、沒有提示與紀錄），右邊是 IoT 改良手臂；下方列出這個情境的差異與「兩邊不一樣的時刻」。
- **師傅設定**：只設定扭力、容差、角度。
- **手臂螢幕**：給客戶看螢幕對師傅的作用。上方是廠房實境的師傅肩後視角（3D）與螢幕實機放大（標出畫面五個區塊），兩者同步播放情境、可全螢幕；下方六張卡片是狀態機在關鍵時刻的螢幕畫面（該鎖哪一顆、剩多少時間、哪一顆沒鎖好、被攔下的原因、不是自己的錯、鎖完確認），可一鍵跳到那一刻播放；最後是「為什麼裝在手臂上」與硬體規格（假設）。
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
| 8 | 手臂螢幕（裝在平衡器外管下端，跟著工具移動、面向師傅） | ①③ |

**手臂螢幕**：低頭看工具時螢幕就在視線裡，錯了當場看得到哪一顆、怎麼修正。螢幕裝在手臂外管上、不在工具本體；業主曾否決「在鎖附機器上加裝裝置」，這個位置是否可接受需再確認。

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
- UI 層：`js/scenarios.js`（情境腳本與播放引擎）、`js/environment.js`（工站環境）、`js/operator.js`（會動的師傅 `createOperator({ side })`）、`js/sim.js`（現行 vs IoT 實境）、`js/screen-view.js`（手臂螢幕展示）、`js/alert-fx.js`（3D 示警 `createAlertFx(scene)`）、`js/product-view.js`（手臂介紹）、`js/main.js`、`index.html`、`css/`

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
