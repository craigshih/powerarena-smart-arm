// 會動的作業員（UI 層）：站在高台內緣，依工具位置伸手、彎腰、轉頭；
// 等待時會轉身做別的事；聽到提示時會轉頭看控制器並放開工具。
//
//   const op = createOperator({ side: 'L' });
//   scene.add(op);
//   op.update(dt, time, { grip, top, look, mode, react });  // 每幀
//   op.say('「降前鎖附！」', 'voice');                       // 頭上對話框
//
// mode：'work'（雙手握工具）、'wait'（放下工具做別的事）。react：提示來源的世界座標（轉頭看）。

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const _up = new THREE.Vector3(0, 1, 0);
const v3 = () => new THREE.Vector3();

function limb(mesh, a, b) {
  const dir = v3().subVectors(b, a);
  const len = Math.max(dir.length(), 1e-4);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.scale.set(1, len, 1);
  mesh.quaternion.setFromUnitVectors(_up, dir.divideScalar(len));
}

export function createOperator({ side = 'L', height = 1.75, platformY = 1.42, x = null, z = 1.55, vest = 0xf2c230 } = {}) {
  const s = side === 'L' ? 1 : -1;
  const k = height / 1.75;
  const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...o });
  const M = {
    pants: mat(0x2b3446),
    shirt: mat(0x56657f),
    vest: mat(vest, { roughness: 0.6, emissive: vest, emissiveIntensity: 0.05 }),
    stripe: mat(0xdfe6ee, { roughness: 0.3, metalness: 0.2 }),
    skin: mat(0xd7b49a, { roughness: 0.6 }),
    helmet: mat(0xf5f6f8, { roughness: 0.35 }),
    glove: mat(0x2f3540, { roughness: 0.9 }),
    boot: mat(0x1a1d22),
  };
  const mesh = (geo, m, px = 0, py = 0, pz = 0) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(px, py, pz);
    o.castShadow = true;
    o.receiveShadow = true;
    return o;
  };

  const root = new THREE.Group();
  root.name = `operator-${side}`;
  // 車身比兩側高台間距寬，葉子板懸在高台上方（外緣 x = ±0.9675）；作業員站在外側、越過開口伸手，
  // 腿與腰不能進到葉子板裡
  const baseX = x ?? s * 1.09;
  root.position.set(baseX, platformY, z);
  root.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2; // 面向引擎室（本地 +Z 朝前）

  // 腿（不跟著上半身轉）
  const hipY = 0.9 * k;
  for (const dx of [-0.1, 0.1]) {
    root.add(mesh(new THREE.CapsuleGeometry(0.068 * k, 0.72 * k, 4, 10), M.pants, dx * k, hipY / 2 + 0.04, 0));
    root.add(mesh(new THREE.BoxGeometry(0.11 * k, 0.07 * k, 0.26 * k), M.boot, dx * k, 0.035 * k, 0.04 * k));
  }

  // 上半身：hips（轉向）→ spine（彎腰）→ 頭
  const hips = new THREE.Group();
  hips.position.y = hipY;
  root.add(hips);
  hips.add(mesh(new THREE.BoxGeometry(0.34 * k, 0.16 * k, 0.2 * k), M.pants, 0, 0.02, 0));
  const spine = new THREE.Group();
  spine.position.y = 0.06 * k;
  hips.add(spine);
  spine.add(mesh(new THREE.CapsuleGeometry(0.17 * k, 0.3 * k, 4, 12), M.shirt, 0, 0.3 * k, 0));
  const vestMesh = mesh(new THREE.CylinderGeometry(0.185 * k, 0.18 * k, 0.4 * k, 14, 1, true), M.vest, 0, 0.27 * k, 0);
  vestMesh.material.side = THREE.DoubleSide;
  spine.add(vestMesh);
  spine.add(mesh(new THREE.CylinderGeometry(0.187 * k, 0.187 * k, 0.03 * k, 14, 1, true), M.stripe, 0, 0.2 * k, 0));
  spine.add(mesh(new THREE.CylinderGeometry(0.05 * k, 0.055 * k, 0.08 * k, 10), M.skin, 0, 0.6 * k, 0));
  const shoulders = { R: new THREE.Object3D(), L: new THREE.Object3D() };
  shoulders.R.position.set(-0.2 * k, 0.5 * k, 0); // 本地 −X 是作業員的右手邊（面向 +Z）
  shoulders.L.position.set(0.2 * k, 0.5 * k, 0);
  spine.add(shoulders.R, shoulders.L);
  for (const sh of Object.values(shoulders)) sh.add(mesh(new THREE.SphereGeometry(0.065 * k, 12, 10), M.shirt));

  const head = new THREE.Group();
  head.position.y = 0.7 * k;
  spine.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.1 * k, 20, 16), M.skin, 0, 0.04 * k, 0));
  const helmet = mesh(new THREE.SphereGeometry(0.118 * k, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.helmet, 0, 0.07 * k, 0);
  head.add(helmet);
  head.add(mesh(new THREE.BoxGeometry(0.2 * k, 0.015 * k, 0.09 * k), M.helmet, 0, 0.07 * k, 0.1 * k));
  const eyes = mesh(new THREE.BoxGeometry(0.11 * k, 0.025 * k, 0.02 * k), M.glove, 0, 0.05 * k, 0.095 * k);
  head.add(eyes);

  // 手臂：上臂、前臂、手套（每幀依目標重算）
  const arms = {};
  for (const h of ['R', 'L']) {
    const upper = mesh(new THREE.CylinderGeometry(0.052 * k, 0.046 * k, 1, 10), M.shirt);
    const fore = mesh(new THREE.CylinderGeometry(0.044 * k, 0.038 * k, 1, 10), M.skin);
    const elbow = mesh(new THREE.SphereGeometry(0.048 * k, 16, 12), M.shirt);
    const hand = mesh(new THREE.SphereGeometry(0.045 * k, 18, 14), M.glove);
    root.add(upper, fore, elbow, hand);
    arms[h] = { upper, fore, elbow, hand, cur: null };
  }
  const UPPER = 0.3 * k;
  const FORE = 0.3 * k;

  // 頭上的對話框
  const bubbleEl = document.createElement('div');
  bubbleEl.className = 'bubble';
  const bubble = new CSS2DObject(bubbleEl);
  bubble.center.set(0.5, 1);
  bubble.position.set(0, 0.32 * k, 0);
  head.add(bubble);
  bubble.visible = false;
  let bubbleUntil = 0;
  let clock = 0;
  function say(text, kind = 'voice', hold = 3) {
    if (!text) { bubble.visible = false; return; }
    bubbleEl.textContent = text;
    bubbleEl.dataset.kind = kind;
    bubble.visible = true;
    bubbleUntil = clock + hold;
  }

  // 平滑後的姿勢
  const pose = { yaw: 0, lean: 0, headYaw: 0, headPitch: 0, z: root.position.z, x: root.position.x };
  const damp = (cur, to, rate, dt) => cur + (to - cur) * (1 - Math.exp(-rate * dt));
  let idleT = 0;

  const tmp = v3();
  function localOf(world) { return root.worldToLocal(tmp.copy(world)).clone(); }

  // 讓某個本地方向的水平角（相對 +Z）
  const yawTo = (p) => Math.atan2(p.x, p.z);

  function solveArm(h, target, dt, pole) {
    const a = arms[h];
    const S = root.worldToLocal(shoulders[h].getWorldPosition(v3()));
    if (!a.cur) a.cur = target.clone();
    a.cur.lerp(target, 1 - Math.exp(-10 * dt));
    let T = a.cur.clone();
    const dir = v3().subVectors(T, S);
    let d = dir.length();
    const max = UPPER + FORE - 0.005;
    if (d > max) { dir.multiplyScalar(max / d); d = max; T = v3().addVectors(S, dir); }
    dir.normalize();
    const along = (UPPER * UPPER - FORE * FORE + d * d) / (2 * d);
    const hgt = Math.sqrt(Math.max(UPPER * UPPER - along * along, 0));
    const p = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
    const E = v3().copy(S).addScaledVector(dir, along).addScaledVector(p, hgt);
    limb(a.upper, S, E);
    limb(a.fore, E, T);
    a.elbow.position.copy(E);
    a.hand.position.copy(T);
  }

  function update(dt, time, ctx = {}) {
    clock = time;
    if (bubble.visible && time > bubbleUntil) bubble.visible = false;
    const working = ctx.mode === 'work' && ctx.grip;
    idleT = working ? 0 : idleT + dt;

    // 身體目標
    let yaw = 0;
    let lean = 0.05 + Math.sin(time * 1.3) * 0.01;
    let headYaw = 0;
    let headPitch = 0.15;
    let stepZ = root.userData.homeZ ?? z;
    let stepX = baseX;
    if (working) {
      const g = localOf(ctx.grip);
      yaw = THREE.MathUtils.clamp(yawTo(g) * 0.3, -0.2, 0.2); // 幾乎正對車身彎腰，頭才不會轉進工具上方的吊管
      const shoulderY = 1.38 * k;
      lean = THREE.MathUtils.clamp((shoulderY - g.y) * 1.1 + (Math.hypot(g.x, g.z) - 0.35) * 0.6, 0.05, 1.0); // 站在葉子板外側，鎖下方要彎腰越過開口
      headPitch = THREE.MathUtils.clamp(0.25 + lean * 0.6, 0.2, 0.9);
      // 站在工具旁邊 0.24 m（右手那一側），彎腰時頭在吊管旁邊、不會穿過去
      stepZ = THREE.MathUtils.clamp((ctx.top ?? ctx.grip).z - s * 0.24, z - 0.6, z + 0.6);
    } else if (idleT > 2.5) {
      // 等待時轉身做別的事（拿零件、看別處），不會一直盯著前方
      const phase = Math.floor((idleT - 2.5) / 5) % 2;
      yaw = phase === 0 ? 1.9 : 1.2;
      headYaw = phase === 0 ? 0.3 : -0.2;
      headPitch = 0.35;
      lean = 0.12;
    }
    if (ctx.react) {
      const r = localOf(ctx.react);
      const hy = Math.atan2(r.x, r.z) - pose.yaw;
      headYaw = THREE.MathUtils.clamp(hy, -1.3, 1.3);
      headPitch = -0.15;
      lean = Math.min(lean, 0.1);
      if (!working) yaw = THREE.MathUtils.clamp(yawTo(r) * 0.5, -1, 1);
    }
    pose.yaw = damp(pose.yaw, yaw, 4, dt);
    pose.lean = damp(pose.lean, lean, 4, dt);
    pose.headYaw = damp(pose.headYaw, headYaw, 6, dt);
    pose.headPitch = damp(pose.headPitch, headPitch, 6, dt);
    pose.z = damp(pose.z, stepZ, 2.5, dt);
    pose.x = damp(pose.x, stepX, 2.5, dt);
    root.position.z = pose.z;
    root.position.x = pose.x;
    hips.rotation.y = pose.yaw;
    spine.rotation.x = pose.lean;
    head.rotation.set(pose.headPitch * 0.8, pose.headYaw, 0);
    root.updateMatrixWorld(true);

    // 手的目標
    let rT;
    let lT;
    if (working) {
      rT = localOf(ctx.grip);
      lT = localOf(ctx.top ?? ctx.grip);
      lT.y += 0.03; // 扶在工具頂蓋上，不要壓到上方螺絲的支架
      if (ctx.react) { rT.y += 0.06; rT.z -= 0.05; } // 聽到提示：鬆開扳機、手微微抬起
    } else {
      const sway = Math.sin(time * 1.1) * 0.01;
      if (idleT > 2.5) {
        // 轉身時一隻手抬起（拿東西）
        const busy = 0.5 + 0.5 * Math.sin(time * 1.6);
        rT = v3(-0.22 * k, (0.95 + busy * 0.25) * k, 0.32 * k).applyAxisAngle(_up, pose.yaw);
        lT = v3(0.22 * k, 0.86 * k, 0.12 * k + sway).applyAxisAngle(_up, pose.yaw);
      } else {
        rT = v3(-0.24 * k, 0.83 * k, 0.08 * k + sway).applyAxisAngle(_up, pose.yaw);
        lT = v3(0.24 * k, 0.83 * k, 0.08 * k - sway).applyAxisAngle(_up, pose.yaw);
      }
    }
    solveArm('R', rT, dt, v3(-0.7, -1, -0.3));
    solveArm('L', lT, dt, v3(0.7, -1, -0.3));
  }

  root.userData.homeZ = z;
  return Object.assign(root, { side, update, say, head });
}
