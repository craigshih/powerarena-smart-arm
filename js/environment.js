// 工站環境（UI 層）：高台、上方軌道、車輛、引擎、承盤、鎖附區域與螺絲。
// 「手臂與情境」與「現行 vs IoT」兩個畫面共用。座標沿用場域模型。
import * as THREE from 'three';
import { P, ZONES, SPEC, boltPosition } from './arm-params.js';

export function buildEnvironment(root) {
  const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.1, ...o });
  const M = {
    floor: mat(0x0d1118, { roughness: 1 }),
    platform: mat(0x2f3a52),
    platformTop: mat(0x3d4a66, { roughness: 0.6 }),
    rail: mat(0xf2c230, { roughness: 0.5 }),
    steel: mat(0x6b7280, { metalness: 0.6, roughness: 0.4 }),
    shell: mat(0x4d6680, { roughness: 0.45, metalness: 0.35, transparent: true, opacity: 0.22, depthWrite: false }),
    engine: mat(0x8a929e, { roughness: 0.5, metalness: 0.6 }),
    trans: mat(0x6f7884, { roughness: 0.5, metalness: 0.6 }),
    bracket: mat(0x555d6b, { roughness: 0.5, metalness: 0.6 }),
    tray: mat(0xd2552c, { roughness: 0.6 }),
    worker: mat(0x7b8aa6),
    workerDark: mat(0x3b4459),
    hat: mat(0xf2c230, { roughness: 0.4 }),
    skin: mat(0xd7b49a),
  };
  const box = (w, h, d, m, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y, z);
    o.castShadow = o.receiveShadow = true;
    return o;
  };
  const span = (x0, x1, y0, y1, z0, z1, m) => box(x1 - x0, y1 - y0, z1 - z0, m, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const out = { pickables: [], bolts: {} };
  const info = (obj, data) => obj.traverse((o) => { if (o.isMesh) { o.userData.info = data; out.pickables.push(o); } });

  const H = P.platformHeight.v;
  const inner = P.platformInnerX.v;
  const W = 0.9;
  const z0 = -2.6;
  const z1 = 4.2;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), M.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);
  const grid = new THREE.GridHelper(40, 80, 0x1a2333, 0x131a26);
  grid.position.y = 0.002;
  root.add(grid);

  for (const s of [1, -1]) {
    const g = new THREE.Group();
    const xa = s * inner;
    const xb = s * (inner + W);
    g.add(span(Math.min(xa, xb), Math.max(xa, xb), 0, H - 0.04, z0, z1, M.platform));
    g.add(span(Math.min(xa, xb), Math.max(xa, xb), H - 0.04, H, z0, z1, M.platformTop));
    const edge = span(Math.min(xa, xa + s * 0.04), Math.max(xa, xa + s * 0.04), H, H + 0.006, z0, z1, M.rail);
    g.add(edge);
    const xr = s * (inner + W - 0.03);
    for (let z = z0 + 0.1; z <= z1; z += 1.35) g.add(box(0.04, 1.05, 0.04, M.rail, xr, H + 0.525, z));
    g.add(span(xr - 0.02, xr + 0.02, H + 1.03, H + 1.07, z0 + 0.1, z1 - 0.1, M.rail));
    info(g, { title: s > 0 ? '作業高台（左）' : '作業高台（右）', id: 'env-platform', rows: [['高台面', `y = ${H} m（已確認）`], ['內緣', `x = ±${inner} m（推算）`], ['現場', '空間狹窄，僅一人可側向通行']] });
    root.add(g);

    // 上方工具軌道與吊架（位置沿用場域模型）
    const rail = new THREE.Group();
    const rx = s * P.railX.v;
    rail.add(span(rx - 0.05, rx + 0.05, P.railY.v + 0.01, P.railY.v + 0.11, -0.9, 3.6, M.rail));
    for (const pz of [-0.85, 3.6]) rail.add(box(0.08, P.railY.v + 0.11 - H, 0.08, M.rail, s * (inner + 0.2), (P.railY.v + 0.11 + H) / 2, pz));
    for (const pz of [-0.85, 3.6]) rail.add(span(Math.min(rx, s * (inner + 0.2)) - 0.04, Math.max(rx, s * (inner + 0.2)) + 0.04, P.railY.v + 0.05, P.railY.v + 0.11, pz - 0.04, pz + 0.04, M.rail));
    info(rail, { title: '上方工具軌道', id: 'env-rail', rows: [['吊點', `x = ±${P.railX.v}、y = ${P.railY.v} m（沿用場域模型）`], ['說明', '手臂原點設在這個吊點，台車沿軌道前後移動']] });
    root.add(rail);
  }
  root.add(span(-(inner + 0.24), inner + 0.24, P.railY.v + 0.05, P.railY.v + 0.12, 3.56, 3.64, M.rail));

  // 車輛（簡化）、引擎、變速箱
  const car = new THREE.Group();
  for (const s of [1, -1]) car.add(span(s * 0.92, s * 0.965, 1.55, 2.37, -2.3, 2.3, M.shell));
  car.add(span(-0.965, 0.965, 1.55, 1.8, 2.22, 2.32, M.shell));
  car.add(span(-0.9, 0.9, 2.37, 2.95, -1.7, 0.55, M.shell));
  info(car, { title: '車輛（簡化）', id: 'env-car', rows: [['引擎室寬', `${P.bayWidth.v} m（已確認）`], ['說明', '只畫出外形，方便看到手臂與鎖附區域']] });
  root.add(car);
  const pt = new THREE.Group();
  pt.add(span(-0.35, 0.35, 1.52, 2.22, 1.45, 2.05, M.engine));
  pt.add(span(0.2, 0.62, 1.55, 2.02, 1.05, 1.48, M.trans));
  for (const s of [1, -1]) pt.add(span(Math.min(s * 0.35, s * 0.66), Math.max(s * 0.35, s * 0.66), 1.94, 2.02, 1.66, 1.9, M.bracket));
  for (const s of [1, -1]) pt.add(span(Math.min(s * 0.62, s * 0.86), Math.max(s * 0.62, s * 0.86), 1.66, 1.72, 1.3, 1.7, M.bracket));
  info(pt, { title: '引擎與變速箱', id: 'env-powertrain', rows: [['說明', '螺絲已預鎖在引擎上，師傅不需要逐顆拿螺絲'], ['問題', '不在拿螺絲，而在「用工具提早鎖」']] });
  root.add(pt);

  // 承盤
  const tray = new THREE.Group();
  tray.add(span(-0.62, 0.62, 1.44, 1.5, 1.15, 2.2, M.tray));
  tray.add(box(0.12, 1.44, 0.12, M.steel, 0, 0.72, 1.68));
  info(tray, { title: '自動升降承盤', id: 'env-tray', rows: [['下降', `${P.trayDrop.v} m、約 ${P.trayDuration.v} 秒（業主估）`], ['訊號', '「開始下降」「下降完成」接到兩側工具控制器'], ['逾時', `${P.trayFaultTimeout.v} 秒沒降到底判自動化錯誤（假設）`]] });
  root.add(tray);
  out.tray = tray;

  // 鎖附區域與螺絲
  const zones = new THREE.Group();
  for (const z of ZONES) {
    const color = z.phase === 'A' ? 0xff8a3d : 0x3dd6d0;
    const geo = new THREE.BoxGeometry(...z.size);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, depthWrite: false }));
    m.position.set(z.pos[0], H + z.pos[1], z.pos[2]);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75 })));
    zones.add(m);
    info(m, { title: `${z.label}（${z.id}）`, id: `zone-${z.id}`, rows: [['階段', z.phase === 'A' ? 'A 第一階段' : 'C 第二階段'], ['螺絲', `${z.bolts} 顆（假設）`], ['規格', `${SPEC[z.id].torque.v} N·m ±${SPEC[z.id].tol.v}%、${SPEC[z.id].angleMin.v}–${SPEC[z.id].angleMax.v}°（假設）`]] });
    out.bolts[z.id] = Array.from({ length: z.bolts }, (_, i) => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.017, 14, 10), new THREE.MeshStandardMaterial({ color: 0x5d6a80, emissive: 0x000000, roughness: 0.4 }));
      b.position.fromArray(boltPosition(z.id, i));
      zones.add(b);
      return b;
    });
  }
  root.add(zones);
  out.zones = zones;

  return out;
}

// 廠房背景：頂燈、鋼柱、牆面、地坪與遠處的其他工站，讓「師傅視角」看起來像真的車廠。
// 只有裝飾，不影響座標與互動。
export function addFactoryBackdrop(root) {
  const g = new THREE.Group();
  const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.1, ...o });

  // 環氧樹脂地坪（帶細微斑駁）與走道黃線
  const tex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#3a4048';
    x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1600; i++) {
      const v = 50 + Math.floor(Math.random() * 30);
      x.fillStyle = `rgba(${v},${v + 4},${v + 10},${0.25 + Math.random() * 0.3})`;
      x.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(24, 24);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), mat(0xffffff, { map: tex, roughness: 0.55, metalness: 0.15 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.004;
  floor.receiveShadow = true;
  g.add(floor);
  const line = mat(0xf2c230, { roughness: 0.5, emissive: 0xf2c230, emissiveIntensity: 0.08 });
  for (const x of [-3.2, 3.2]) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 40), line);
    l.rotation.x = -Math.PI / 2;
    l.position.set(x, 0.008, 0);
    g.add(l);
  }

  // 牆面（淺灰金屬浪板）
  const wall = mat(0x4a525e, { roughness: 0.9 });
  for (const x of [-11, 11]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(60, 10), wall);
    w.position.set(x, 5, 0);
    w.rotation.y = x > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(w);
  }
  const back = new THREE.Mesh(new THREE.PlaneGeometry(22, 10), wall);
  back.position.set(0, 5, -14);
  g.add(back);

  // 鋼柱與屋頂桁架
  const steel = mat(0x5b6472, { metalness: 0.5, roughness: 0.5 });
  const yellow = mat(0xd9ad2b, { roughness: 0.6 });
  for (let z = -12; z <= 14; z += 6.5) {
    for (const x of [-7, 7]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.35, 9, 0.35), steel);
      col.position.set(x, 4.5, z);
      g.add(col);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.2, 0.42), yellow);
      guard.position.set(x, 0.6, z);
      g.add(guard);
    }
    const truss = new THREE.Mesh(new THREE.BoxGeometry(14.4, 0.3, 0.25), steel);
    truss.position.set(0, 8.6, z);
    g.add(truss);
  }

  // 頂燈：一排排長條燈具
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4f7ff, emissiveIntensity: 1.6 });
  const housing = mat(0x2b3038);
  for (let z = -12; z <= 14; z += 2.6) {
    for (const x of [-4.5, -1.5, 1.5, 4.5]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 1.5), housing);
      h.position.set(x, 7.6, z);
      const tube = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 1.42), lampMat);
      tube.position.set(x, 7.55, z);
      g.add(h, tube);
    }
  }
  for (const z of [-4, 4]) {
    const light = new THREE.PointLight(0xeef3ff, 22, 14);
    light.position.set(0, 7.2, z);
    g.add(light);
  }

  // 遠處的其他工站：車身、高台、三色燈
  const body = mat(0x6f8299, { roughness: 0.4, metalness: 0.4 });
  const plat = mat(0x2f3a52);
  for (const z of [-9.5, 10]) {
    const car = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.9, 4.4), body);
    car.position.set(0, 2, z);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.2), body);
    cab.position.set(0, 2.75, z - 0.5);
    g.add(car, cab);
    for (const s of [1, -1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.42, 5), plat);
      p.position.set(s * 1.3, 0.71, z);
      g.add(p);
      const lampPost = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 8), steel);
      lampPost.position.set(s * 1.6, 1.97, z + 2.2);
      g.add(lampPost);
    }
    const andon = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 12), new THREE.MeshStandardMaterial({ color: 0x3ccf6b, emissive: 0x3ccf6b, emissiveIntensity: 1.2 }));
    andon.position.set(1.6, 2.6, z + 2.2);
    g.add(andon);
  }

  // 料架
  const rack = mat(0x2459c7, { roughness: 0.6 });
  for (const z of [-3.5, 0.5, 4.5]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 1.6), rack);
    r.position.set(-4.2, 0.9, z);
    g.add(r);
  }

  root.add(g);
  return g;
}
