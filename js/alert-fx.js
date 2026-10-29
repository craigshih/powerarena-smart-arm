// 3D 示警效果（UI 層）：讓七種情境在畫面上一眼就分得出來。
// 每一種警示有自己的顏色、圖示、標記形狀與指向的位置：
//   降前鎖附    紅   ⛔  上方那顆螺絲打叉＋承盤框黃閃「承盤未降」
//   錯誤步驟    洋紅 ⇄   錯的區域打叉、對的那顆綠圈，中間拉一條箭頭
//   扭力不足    紅   ✕   NG 那顆快速脈動，標籤寫實際扭力與下限
//   即將超時    黃   ⏱   下一顆外圍倒數圈
//   超過時間    橘紅 ⏱   同上，圈變滿紅
//   承盤異常    紫   ⚙   承盤整個框起來閃紫，標示「不是作業員的錯」
//   訊號中斷    橘   ⚡   工具外圍光暈
//   正常        綠   ✓   每鎖好一顆冒出綠勾與扭力值，完成時「本車完成」
//
//   const fx = createAlertFx(scene);
//   fx.onRecords(records);                              // 取得事件位置、產生 OK 綠勾
//   fx.update(dt, time, { states, arms, tray });        // 每幀
//   host.dataset.fx = fx.mood;                          // 畫面邊框顏色（CSS）

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { P, boltPosition, zoneById } from './arm-params.js';

const ICON = {
  stop: '<path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z"/><path d="M8 12h8"/>',
  swap: '<path d="M4 8h14l-4-4M20 16H6l4 4"/>',
  x: '<circle cx="12" cy="12" r="10"/><path d="M8 8l8 8M16 8l-8 8"/>',
  clock: '<circle cx="12" cy="13" r="9"/><path d="M12 8v5l3 2M9 2h6"/>',
  gear: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

export const FX = {
  EARLY_ATTEMPT: { mood: 'operation', color: 0xe0303a, icon: 'stop', title: '降前鎖附' },
  SEQUENCE_ERROR: { mood: 'sequence', color: 0xff4fd8, icon: 'swap', title: '錯誤步驟' },
  TIGHTEN_NG: { mood: 'operation', color: 0xff3b4f, icon: 'x', title: '扭力不足' },
  PHASE_WARNING: { mood: 'warn', color: 0xf0b545, icon: 'clock', title: '即將超時' },
  TIMEOUT: { mood: 'timeout', color: 0xff7a1a, icon: 'clock', title: '超過鎖附時間' },
  AUTOMATION_FAULT: { mood: 'automation', color: 0xb07cff, icon: 'gear', title: '承盤異常' },
  TOOL_FAULT: { mood: 'tool', color: 0xff8a3d, icon: 'bolt', title: '扭矩槍訊號中斷' },
};
const MOOD_RANK = { '': 0, ok: 1, warn: 2, timeout: 3, sequence: 4, operation: 4, tool: 5, automation: 5 };

const additive = (color, opacity) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});

function makeLabel(cls = '') {
  const el = document.createElement('div');
  el.className = `fx-label ${cls}`;
  const obj = new CSS2DObject(el);
  obj.center.set(0.5, 1);
  obj.visible = false;
  return { el, obj, html: '' };
}
function setLabel(l, html, cls) {
  if (l.html !== html) { l.el.innerHTML = html; l.html = html; }
  if (cls && l.cls !== cls) { l.el.className = `fx-label ${cls}`; l.cls = cls; }
  l.obj.visible = true;
}

export function createAlertFx(scene) {
  const root = new THREE.Group();
  root.name = 'alert-fx';
  scene.add(root);

  // 每一側一組標記
  function makeSet() {
    const g = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.11, 1, 24, 1, true), additive(0xffffff, 0.45));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.013, 8, 40), additive(0xffffff, 0.95));
    ring.rotation.x = Math.PI / 2;
    const cross = new THREE.Group();
    for (const r of [Math.PI / 4, -Math.PI / 4]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.022, 0.022), additive(0xffffff, 0.95));
      bar.rotation.y = r;
      cross.add(bar);
    }
    const target = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 8, 40), additive(0x3ccf6b, 0.95));
    target.rotation.x = Math.PI / 2;
    const timer = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.125, 48, 1, 0, Math.PI * 2), additive(0xf0b545, 0.9));
    timer.rotation.x = -Math.PI / 2;
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16), additive(0xff8a3d, 0.25));
    const label = makeLabel();
    g.add(beam, ring, cross, target, timer, halo, label.obj);
    root.add(g);
    return { g, beam, ring, cross, target, timer, halo, label, arrow: null, arrowKey: '' };
  }
  const sets = { L: makeSet(), R: makeSet() };

  // 承盤外框（降前鎖附：黃「承盤未降」；承盤異常：紫）
  const trayBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), additive(0xb07cff, 0.18));
  const trayEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xb07cff, transparent: true }));
  trayBox.add(trayEdges);
  const trayLabel = makeLabel();
  root.add(trayBox, trayLabel.obj);
  const _box = new THREE.Box3();
  const _v = new THREE.Vector3();

  // 正常鎖好一顆：綠勾往上飄
  const pops = [];
  const lastRec = { L: {}, R: {} };
  const done = { L: null, R: null };
  let clock = 0;

  function onRecords(records, { pops: showPops = true } = {}) {
    for (const r of records) {
      if (!r.side) continue;
      lastRec[r.side][r.type] = r;
      if (r.type === 'TIGHTEN_OK' && r.zoneId && showPops) {
        const l = makeLabel('fx-pop');
        l.el.innerHTML = `${svg('check')}<b>${r.torqueNm} N·m</b>`;
        l.obj.visible = true;
        const p = new THREE.Vector3(...boltPosition(r.zoneId, r.boltIndex));
        l.obj.position.copy(p).add(new THREE.Vector3(0, 0.06, 0));
        root.add(l.obj);
        pops.push({ l, t0: clock, base: l.obj.position.y });
      }
      if (r.type === 'CYCLE_COMPLETE') done[r.side] = showPops ? clock : null;
      if (r.type === 'CYCLE_START') done[r.side] = null;
    }
  }

  function reset() {
    for (const p of pops) p.l.obj.removeFromParent();
    pops.length = 0;
    lastRec.L = {};
    lastRec.R = {};
    done.L = done.R = null;
  }

  const boltVec = (b) => (b?.zoneId ? new THREE.Vector3(...boltPosition(b.zoneId, b.boltIndex ?? 0)) : null);

  function hideSet(S) {
    for (const k of ['beam', 'ring', 'cross', 'target', 'timer', 'halo']) S[k].visible = false;
    S.label.obj.visible = false;
    if (S.arrow) S.arrow.visible = false;
  }

  function place(S, pos, color, { beam = true, ring = true, pulse = 1, time }) {
    const k = 1 + 0.25 * Math.sin(time * 6 * pulse);
    if (beam) {
      S.beam.visible = true;
      S.beam.material.color.setHex(color);
      S.beam.scale.set(1, 1.5, 1);
      S.beam.position.copy(pos).add(_v.set(0, 0.76, 0));
      S.beam.material.opacity = 0.32 + 0.18 * Math.sin(time * 5);
    }
    if (ring) {
      S.ring.visible = true;
      S.ring.material.color.setHex(color);
      S.ring.position.copy(pos);
      S.ring.scale.setScalar(k);
    }
  }

  function setArrow(S, from, to, color) {
    const key = `${from.toArray().map((x) => x.toFixed(3))}|${to.toArray().map((x) => x.toFixed(3))}`;
    if (key !== S.arrowKey) {
      if (S.arrow) { S.arrow.geometry.dispose(); S.arrow.removeFromParent(); }
      const mid = from.clone().lerp(to, 0.5).add(_v.set(0, 0.22, 0));
      const curve = new THREE.QuadraticBezierCurve3(from.clone().add(_v.set(0, 0.03, 0)), mid, to.clone().add(_v.set(0, 0.03, 0)));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.008, 6), additive(color, 0.95));
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.06, 12), additive(color, 0.95));
      const tip = curve.getPoint(1);
      const dir = curve.getTangent(1);
      head.position.copy(tip);
      head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      tube.add(head);
      S.g.add(tube);
      S.arrow = tube;
      S.arrowKey = key;
    }
    S.arrow.visible = true;
  }

  const labelHtml = (fx, title, detail) => `${svg(fx.icon)}<b>${title}</b>${detail ? `<span>${detail}</span>` : ''}`;

  let mood = '';

  function update(dt, time, ctx) {
    clock = time;
    const { states, arms, tray } = ctx;
    let best = '';
    let trayMode = null;

    for (const side of ['L', 'R']) {
      const S = sets[side];
      hideSet(S);
      const s = states[side];
      const a = s.alarm && s.alarm.level !== 'info' ? s.alarm : null;
      const fx = a ? FX[a.type] : null;

      if (!fx) {
        // 完成：綠色「本車完成」
        if (done[side] != null && time - done[side] < 3) {
          const ids = Object.keys(s.bolts);
          const p = new THREE.Vector3(...boltPosition(ids[0], 0));
          place(S, p, 0x3ccf6b, { beam: true, ring: true, time, pulse: 0.5 });
          S.label.obj.position.copy(p).add(_v.set(0, 0.95, 0));
          setLabel(S.label, labelHtml({ icon: 'check' }, '本車完成', `${side === 'L' ? '左' : '右'}側每顆 OK`), 'fx-ok');
          if (MOOD_RANK.ok > MOOD_RANK[best]) best = 'ok';
        }
        continue;
      }
      if (MOOD_RANK[fx.mood] > MOOD_RANK[best]) best = fx.mood;
      const label = (pos, title, detail, lift = 0.95) => {
        S.label.obj.position.copy(pos).add(_v.set(0, lift, 0));
        setLabel(S.label, labelHtml(fx, title, detail), `fx-${fx.mood}`);
      };

      switch (a.type) {
        case 'EARLY_ATTEMPT': {
          const r = lastRec[side].EARLY_ATTEMPT;
          const p = boltVec(r && r.zoneId ? { zoneId: r.zoneId, boltIndex: r.boltIndex ?? 0 } : null);
          if (!p) break;
          place(S, p, fx.color, { time, pulse: 1.6 });
          S.cross.visible = true;
          S.cross.position.copy(p).add(_v.set(0, 0.05, 0));
          S.cross.children.forEach((c) => c.material.color.setHex(fx.color));
          label(p, '降前鎖附・工具已鎖住', '承盤還沒降，放開扳機');
          trayMode = 'early';
          break;
        }
        case 'SEQUENCE_ERROR': {
          const r = lastRec[side].SEQUENCE_ERROR;
          const wrong = boltVec(r && r.zoneId ? { zoneId: r.zoneId, boltIndex: r.boltIndex ?? 0 } : null);
          const right = boltVec(s.expected);
          if (!wrong) break;
          place(S, wrong, fx.color, { time, pulse: 1.4 });
          S.cross.visible = true;
          S.cross.position.copy(wrong).add(_v.set(0, 0.05, 0));
          S.cross.children.forEach((c) => c.material.color.setHex(fx.color));
          if (right) {
            S.target.visible = true;
            S.target.position.copy(right);
            S.target.scale.setScalar(1 + 0.3 * Math.sin(time * 5));
            setArrow(S, wrong, right, 0x3ccf6b);
          }
          label(wrong, '錯誤步驟', s.expected ? `先鎖${zoneById(s.expected.zoneId).label}（綠圈）` : '');
          break;
        }
        case 'TIGHTEN_NG': {
          const p = boltVec(s.rework);
          if (!p) break;
          place(S, p, fx.color, { time, pulse: 2.4 });
          const l = s.last;
          label(p, '扭力不足・不計數', l ? `${l.torqueNm} N·m（下限 ${l.lo}）原地重鎖` : '原地重鎖');
          break;
        }
        case 'PHASE_WARNING':
        case 'TIMEOUT': {
          const p = boltVec(s.expected) ?? boltVec(lastRec[side].TIMEOUT);
          if (!p) break;
          place(S, p, fx.color, { time, ring: false, pulse: 1 });
          S.timer.visible = true;
          S.timer.position.copy(p).add(_v.set(0, 0.002, 0));
          S.timer.material.color.setHex(fx.color);
          const frac = a.type === 'TIMEOUT' ? 1 : Math.max(0.02, (s.remaining ?? 0) / P.phaseWarnLead.v);
          S.timer.geometry.dispose();
          S.timer.geometry = new THREE.RingGeometry(0.1, 0.13, 48, 1, Math.PI / 2, Math.PI * 2 * frac);
          const n = s.remaining != null ? Math.ceil(s.remaining) : 0;
          label(p, a.type === 'TIMEOUT' ? '超過鎖附時間' : `剩 ${n} 秒`, a.type === 'TIMEOUT' ? '已記錄，盡快補完' : '加快完成這一階段');
          break;
        }
        case 'AUTOMATION_FAULT': {
          trayMode = 'automation';
          break;
        }
        case 'TOOL_FAULT': {
          const p = arms[side].getToolTip(new THREE.Vector3()).add(_v.set(0, 0.18, 0));
          S.halo.visible = true;
          S.halo.position.copy(p);
          S.halo.material.color.setHex(fx.color);
          S.halo.scale.setScalar(1 + 0.2 * Math.sin(time * 9));
          S.halo.material.opacity = Math.sin(time * 9) > 0 ? 0.32 : 0.12;
          label(p, '扭矩槍訊號中斷・已鎖住', '通知現場主管', 0.35);
          break;
        }
        default:
      }
    }

    // 承盤外框
    if (trayMode) {
      _box.setFromObject(tray);
      _box.getCenter(trayBox.position);
      _box.getSize(_v);
      trayBox.scale.set(_v.x + 0.08, Math.max(_v.y, 0.06) + 0.08, _v.z + 0.08);
      const c = trayMode === 'automation' ? FX.AUTOMATION_FAULT.color : 0xf0b545;
      trayBox.material.color.setHex(c);
      trayEdges.material.color.setHex(c);
      const on = Math.sin(time * 7) > 0;
      trayBox.material.opacity = on ? 0.28 : 0.08;
      trayEdges.material.opacity = on ? 1 : 0.4;
      trayBox.visible = true;
      trayLabel.obj.position.copy(trayBox.position).add(_v.set(0, 0.35, 0.6));
      if (trayMode === 'automation') {
        setLabel(trayLabel, labelHtml(FX.AUTOMATION_FAULT, '系統異常 A：承盤異常', '不是作業員的錯，等現場主管復歸'), 'fx-automation');
      } else {
        setLabel(trayLabel, labelHtml({ icon: 'stop' }, '承盤未下降', '上方螺絲不開放'), 'fx-warn');
      }
    } else {
      trayBox.visible = false;
      trayLabel.obj.visible = false;
    }

    // 綠勾上飄後消失
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i];
      const age = time - p.t0;
      if (age > 1.4 || age < 0) { p.l.obj.removeFromParent(); pops.splice(i, 1); continue; }
      p.l.obj.position.y = p.base + age * 0.12;
      p.l.el.style.opacity = String(Math.min(1, 2.2 - age * 1.6));
    }
    mood = best;
  }

  return {
    onRecords,
    update,
    reset,
    get mood() { return mood; },
    setVisible(v) {
      root.visible = v;
      if (!v) { // CSS2D 標籤不會跟著父物件隱藏，要個別關掉
        hideSet(sets.L);
        hideSet(sets.R);
        trayLabel.obj.visible = false;
        reset();
      }
    },
  };
}
