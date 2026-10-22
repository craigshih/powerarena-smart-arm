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
