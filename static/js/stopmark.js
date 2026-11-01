// The stop plan on the road (stopplan.js): a strip in our lane from where the braking would start to the stop
// line, in the map's ground-fixed group (pose frame, like mapfeatures.js), so it stays put as the car closes on
// it. Blue while the stop is ahead, amber inside the braking distance, red at the stop point.
import * as THREE from '../vendor/three.module.min.js';
import { STOP_MARGIN_M } from './stopplan.js';

const LIFT = 0.012;    // over the network's lines and the features' markings
const LANE_W = 3.6;
const COLORS = { ahead: 0x3e6ae1, slowing: 0xf0a020, at: 0xe5413a };
const toWorld = (x, y, lift) => [-y, lift, -x];   // pose frame -> group axes (mapfeatures.js)

export class StopMark {
  constructor(group) {
    this.mat = new THREE.MeshBasicMaterial({ color: COLORS.ahead, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -8 });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    this.pos = new THREE.Float32BufferAttribute(new Float32Array(4 * 3), 3);
    this.mesh.geometry.setAttribute('position', this.pos);
    this.mesh.geometry.setIndex([0, 2, 1, 1, 2, 3]);
    group.add(this.mesh);
  }

  /** stop: nextStop()'s; p: plan()'s; or null to hide. */
  update(stop, p, show) {
    if (!stop || !p || !show || p.phase === 'passed') { this.mesh.visible = false; return; }
    const ux = Math.cos(stop.h), uy = Math.sin(stop.h), rx = uy, ry = -ux;
    // our lane: the right-hand lane of the arrival (a one-way road: its whole width), from the lane's inner edge to the road's
    const from = stop.oneWay ? -stop.half : Math.max(0.3, stop.half - LANE_W), to = stop.half;
    const start = -(Math.max(p.brake, 2) + STOP_MARGIN_M);   // station from the line, back along the arrival
    const end = -STOP_MARGIN_M;
    const a = this.pos.array;
    let i = 0;
    for (const [st, r] of [[start, from], [start, to], [end, from], [end, to]]) {
      const [X, Y, Z] = toWorld(stop.x + ux * st + rx * r, stop.y + uy * st + ry * r, LIFT);
      a[i++] = X; a[i++] = Y; a[i++] = Z;
    }
    this.pos.needsUpdate = true;
    this.mesh.geometry.computeBoundingSphere();
    this.mat.color.set(COLORS[p.phase] || COLORS.ahead);
    this.mat.opacity = p.phase === 'ahead' ? 0.18 : 0.32;
    this.mesh.visible = true;
  }

  clear() { this.mesh.visible = false; }
}
