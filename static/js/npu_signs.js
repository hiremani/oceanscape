// The NPU detector's traffic lights and stop signs that the map doesn't have (npu.js keeps them; the ones matched to
// the map's are already drawn by mapfeatures.js). Ground-fixed in the scene's world group, facing the way the car
// came, faded by how sure the placement is and how long since it was last seen. The detector says nothing about a
// light's state, so its lamps stay dark: the lit light ahead is the car camera's (furniture.js).
import * as THREE from '../vendor/three.module.min.js';
import { buildSignalHead, makeSign, LIGHT_SCALE } from './furniture.js';

const MAX_SIGNS = 12;
const FADE_S = 1.5;

export class NpuSigns {
  constructor(world) {
    this.group = new THREE.Group();
    world.add(this.group);
    this.items = [];   // {k, obj, mats}
    this.housing = new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.6, metalness: 0.2, transparent: true });
  }

  _make(k) {
    let obj;
    if (k === 'traffic_light') {
      obj = new THREE.Group();
      const head = new THREE.Group();
      buildSignalHead(head, 3, false, this.housing.clone());
      head.scale.setScalar(LIGHT_SCALE * 0.8);
      obj.add(head);
      obj.userData.head = head;
    } else {
      obj = makeSign({ kind: 'stop' });
    }
    const mats = [];
    obj.traverse((o) => { if (o.isMesh) { for (const m of Array.isArray(o.material) ? o.material : [o.material]) { m.transparent = true; mats.push(m); } } });
    this.group.add(obj);
    return { k, obj, mats };
  }

  /** npu: the NpuDetector (or null); pose: the scene's (rear axle x, y, h). */
  update(npu, pose, on) {
    const want = on && npu ? npu.signs.filter(s => s.map < 0 && s.conf >= 0.3).slice(0, MAX_SIGNS) : [];
    // reuse objects of the right kind; build what's missing; hide the rest
    const now = performance.now();
    let used = 0;
    for (const s of want) {
      let it = this.items.find((x, i) => i >= used && x.k === s.k);
      if (!it) { it = this._make(s.k); this.items.push(it); }
      // keep the used ones at the front
      const i = this.items.indexOf(it);
      this.items.splice(i, 1);
      this.items.splice(used, 0, it);
      used++;
      it.obj.visible = true;
      // scene ground frame: X = -y, Z = -x (scene.js toScene); a light's head at its height, a sign on the ground
      it.obj.position.set(-s.wy, it.k === 'traffic_light' ? Math.max(2.5, s.z) : 0, -s.wx);
      it.obj.rotation.y = pose ? pose.h : 0;
      const alpha = Math.min(1, s.conf / 0.6) * Math.max(0, 1 - (now - s.seen) / 1000 / FADE_S);
      for (const m of it.mats) m.opacity = alpha;
    }
    for (let i = used; i < this.items.length; i++) this.items[i].obj.visible = false;
    this.group.visible = used > 0;
  }
}
