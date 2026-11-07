// 工站環境（UI 層）：直接使用場域模型（powerarena-station-twin）的 buildStation，
// 所有 3D 畫面的高台、車輛、引擎、承盤、四個螺絲孔位、滑軌、吊架與攝影機都和場域模型一致。
// 場域模型裡的靜態作業員與舊式懸吊工具會藏起來，改由會動的作業員與改良版手臂取代。
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { buildStation } from './twin/scene.js';
import { PHASE_COLOR } from './twin/params.js';

const STATUS_COLOR = { OK: 0x3ccf6b, NG: 0xe0303a, DONE: 0x8fa3bf, HIDDEN: 0x8fa3bf, EARLY: 0xff5a1f };

export function buildEnvironment(root, { frustums = false, dims = false, tags = false, stepTags = true } = {}) {
  const station = buildStation(root);

  // CSS2DRenderer 不會沿用父層的 visible，要把圖層內的文字標籤一起切換
  function setLayer(name, on) {
    const layer = station.layers[name];
    if (!layer) return;
    layer.visible = on;
    layer.traverse((o) => { if (o.isCSS2DObject) o.visible = on && (o.element.classList.contains('tag-step') ? stepTagsOn : tagsOn); });
  }
  let tagsOn = tags;
  let stepTagsOn = stepTags;
  function setTags(all, steps = stepTagsOn) {
    tagsOn = all;
    stepTagsOn = steps;
    for (const layer of Object.values(station.layers)) {
      layer.traverse((o) => {
        if (!o.isCSS2DObject) return;
        const isStep = o.element.classList.contains('tag-step');
        o.visible = layer.visible && (isStep ? steps : all);
      });
    }
  }

  // 拿掉打開的引擎蓋：作業員的手會穿過它，不符合現場（twin 的複製檔不改，在這裡藏起來）
  station.layers.vehicle.traverse((o) => { if (o.isGroup && Math.abs(o.rotation.x + 1.2) < 1e-6) o.visible = false; });
  // 散熱器外框、螺絲支架（鋼材）和深色本體有共面的面，會互相閃爍出鋸齒狀殘影；讓鋼材略為往前畫
  station.layers.vehicle.traverse((o) => {
    if (o.isMesh && o.material.color?.getHex() === 0x6b7280 && !o.material.polygonOffset) {
      Object.assign(o.material, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    }
  });
  // 承盤感測器：裝在承盤車頭那一面，跟著承盤上下；LED 綠＝回傳中、紫閃＝回報卡住
  const traySensor = new THREE.Group();
  const sensorLed = new THREE.MeshStandardMaterial({ color: 0x1e232c, emissive: 0x3ccf6b, emissiveIntensity: 1.2, roughness: 0.3 });
  {
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b3446, roughness: 0.5, metalness: 0.4 });
    const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; traySensor.add(o); return o; };
    add(new THREE.BoxGeometry(0.14, 0.07, 0.04), dark, 0, 0, 0);
    add(new THREE.CylinderGeometry(0.004, 0.004, 0.1, 6), dark, 0.055, 0.085, 0);
    add(new THREE.SphereGeometry(0.012, 12, 8), sensorLed, -0.04, 0.0, 0.022);
    add(new THREE.CylinderGeometry(0.014, 0.014, 0.01, 16), new THREE.MeshStandardMaterial({ color: 0x9fb4cc, roughness: 0.2, metalness: 0.6 }), 0.02, 0, 0.022).rotation.x = Math.PI / 2;
    const info = { title: '⑩ 承盤感測器', id: 'env-tray-iot', rows: [
      ['作用', '持續回傳承盤高度、下降進度與是否到位，和 PLC 訊號互相比對'], ['回傳', '約每 0.1 秒一次（假設）'], ['位置', '承盤車頭那一面（示意，待確認）']] };
    traySensor.traverse((o) => { if (o.isMesh) o.userData.info = info; });
    const tray = station.tray;
    tray.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(tray);
    const c = bb.getCenter(new THREE.Vector3());
    traySensor.position.copy(tray.worldToLocal(new THREE.Vector3(c.x + 0.3, bb.max.y - 0.045, bb.max.z + 0.022)));
    tray.add(traySensor);
    const el = document.createElement('div');
    el.className = 'tag tag-step tag-iot';
    el.textContent = '⑩ 承盤';
    const tag = new CSS2DObject(el);
    tag.center.set(0.5, 1);
    tag.position.set(0, 0.2, 0);
    traySensor.add(tag);
  }
  function setTraySensor(mode, time) {
    const blink = Math.floor(time * 2.8) % 2 === 0;
    sensorLed.emissive.setHex(mode === 'stuck' ? 0xb07cff : 0x3ccf6b);
    sensorLed.emissiveIntensity = mode === 'stuck' ? (blink ? 2.4 : 0.3) : 0.9 + 0.5 * Math.sin(time * 10);
  }

  setLayer('people', false);
  setLayer('frustums', frustums);
  setLayer('dims', dims);
  setTags(tags, stepTags);

  const pickables = [];
  for (const [name, layer] of Object.entries(station.layers)) {
    if (name === 'people' || name === 'frustums' || name === 'dims') continue;
    layer.traverse((o) => { if (o.isMesh && o.userData.info) pickables.push(o); });
  }

  // 螺絲孔位上色：未鎖（步驟色）、OK 綠、NG 紅；下一顆外圈脈動
  function paintBolts(states, time) {
    for (const z of station.zones) {
      const s = states[z.cfg.side];
      if (!s) continue;
      const st = s.bolts?.[z.cfg.id]?.[0] ?? 'PENDING';
      const cur = s.expected?.zoneId === z.cfg.id && (s.phase === 'A' || s.phase === 'C');
      z.ringMat.color.setHex(st === 'PENDING' ? PHASE_COLOR[z.cfg.phase] : STATUS_COLOR[st]);
      z.ring.scale.setScalar(cur ? 1.2 + 0.18 * Math.sin(time * 6) : 1);
      z.material.opacity = cur ? 0.24 : 0.06;
      z.edges.material.opacity = cur ? 0.95 : 0.35;
    }
  }

  // 工站三色燈：依最嚴重的警示亮燈
  function setAndon(level, time) {
    const [red, yellow, green] = station.lamps;
    const blink = Math.floor(time * 2.8) % 2 === 0;
    red.emissiveIntensity = level >= 2 ? (blink ? 2.2 : 0.4) : 0.05;
    yellow.emissiveIntensity = level === 1 ? (blink ? 2.2 : 0.3) : 0.05;
    green.emissiveIntensity = level < 1 ? 1.6 : 0.05;
  }

  return {
    station,
    tray: station.tray,
    traySensor,
    setTraySensor,
    pickables,
    setLayer,
    setTags,
    paintBolts,
    setAndon,
  };
}

// 廠房背景：頂燈、鋼柱、牆面、地坪與遠處的其他工站，讓「作業員視角」看起來像真的車廠。
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
