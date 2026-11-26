// node --test static/js/tests/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inv3, roadPlane, pixelToGround, liftBox, liftSign, placeDetections, objectBox, carToPixel, carToPose, poseToCar,
  matchMapSign, DIMS_PRIOR, MAX_RANGE_M } from '../npu_geom.js';

// a comma-like road camera at 1280 x 720: fx = fy = 910, pitched down 2 deg, yawed 1 deg (M = K . view_from_calib)
function calibFor(pitch = 2 * Math.PI / 180, yaw = Math.PI / 180) {
  const K = [[910, 0, 640], [0, 910, 360], [0, 0, 1]];
  // calib (x fwd, y right, z down) -> device by pitch (about y) then yaw (about z); view = [y, z, x] of device
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const Ry = [[cp, 0, sp], [0, 1, 0], [-sp, 0, cp]], Rz = [[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]];
  const mm = (A, B) => A.map(r => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
  const dev = mm(Rz, Ry);
  const view = [dev[1], dev[2], dev[0]];
  return { width: 1280, height: 720, K, M: mm(K, view) };
}
const cal = calibFor();
const cam = { x: -1.6 };
const plane = { h: 1.22, b: 0 };

function boxFor(x, y, cls, k) {
  const [w, l, h] = DIMS_PRIOR[cls];
  return { k, s: 0.9, b: objectBox(cal.M, cam, plane, x, y, w, l, h) };
}

test('inverse of a 3x3 matrix', () => {
  const I = inv3(cal.M);
  const p = [12, -1.5, 1.1];
  const q = cal.M.map(r => r[0] * p[0] + r[1] * p[1] + r[2] * p[2]);
  const back = I.map(r => r[0] * q[0] + r[1] * q[1] + r[2] * q[2]);
  back.forEach((v, i) => assert.ok(Math.abs(v - p[i]) < 1e-9));
  assert.equal(inv3([[1, 2, 3], [2, 4, 6], [0, 0, 1]]), null);
});

test('a road pixel cast back onto the road lands where it came from', () => {
  const I = inv3(cal.M);
  for (const [x, y] of [[8, 0], [15, 3], [40, -2], [60, 5]]) {
    const [u, v] = carToPixel(cal.M, cam, plane, x, y, 0);
    const [f, right] = pixelToGround(I, u, v, plane);
    assert.ok(Math.abs(f + cam.x - x) < 1e-6 && Math.abs(-right - y) < 1e-6, `${x},${y}`);
  }
  // above the horizon: nothing
  assert.equal(pixelToGround(I, 640, 0, plane), null);
});

test('road plane from the model: rising road means z shrinks ahead', () => {
  const lanes = [0, 1].map(o => Array.from({ length: 10 }, (_, i) => [6 + 3 * i, o ? 1.8 : -1.8, 1.4 - 0.02 * (6 + 3 * i)]));
  const p = roadPlane({ pathZ: 1.4, lanes, laneProbs: [0.9, 0.9] });
  assert.ok(Math.abs(p.h - 1.4) < 1e-6 && Math.abs(p.b + 0.02) < 1e-6, JSON.stringify(p));
  assert.deepEqual(roadPlane(null), { h: 1.22, b: 0 });
});

test('boxes of objects are placed at their near face within 1 m at 15 m and 3 m at 40 m', () => {
  for (const [x, y, cls, k, tol] of [[15, 2.5, 'pedestrian', 'person', 1], [25, -1.2, 'bicycle', 'bicycle', 1.5], [40, 0.4, 'truck', 'truck', 3], [40, -3.6, 'car', 'car', 3]]) {
    const o = liftBox(boxFor(x, y, cls, k), 1280, 720, cal, cam, plane);
    assert.ok(o, `${k} placed`);
    assert.equal(o.cls, cls);
    assert.ok(Math.hypot(o.x - x, o.y - y) < tol, `${k}: ${o.x.toFixed(2)},${o.y.toFixed(2)} vs ${x},${y}`);
    assert.ok(o.conf > 0.8, `${k} conf ${o.conf}`);   // ground and height ranges agree
    assert.ok(o.sx > o.sy, 'range is coarser than bearing');
  }
});

test('a box in a picture of another size is scaled to the stream', () => {
  const det = boxFor(20, 1, 'car', 'car');
  const half = { ...det, b: det.b.map(v => v / 2) };
  const a = liftBox(det, 1280, 720, cal, cam, plane), b = liftBox(half, 640, 360, cal, cam, plane);
  assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6);
});

test('a box whose height disagrees with its foot counts for less', () => {
  const det = boxFor(20, 0, 'pedestrian', 'person');
  const tall = { ...det, b: [det.b[0], det.b[1] - (det.b[3] - det.b[1]) * 1.5, det.b[2], det.b[3]] };   // 2.5x taller
  const a = liftBox(det, 1280, 720, cal, cam, plane), b = liftBox(tall, 1280, 720, cal, cam, plane);
  assert.ok(b.conf < a.conf * 0.7, `${b.conf} vs ${a.conf}`);
});

test('a foot cut off by the frame is placed by height alone, with less confidence', () => {
  const det = boxFor(6, 0, 'car', 'car');
  const cut = { ...det, b: [det.b[0], det.b[1], det.b[2], 720] };
  const o = liftBox(cut, 1280, 720, cal, cam, plane);
  assert.ok(o && o.cut && o.conf < 0.7);
});

test('unknown classes, faint boxes, too far and malformed boxes are left out', () => {
  assert.equal(liftBox({ k: 'dog', s: 0.9, b: [600, 300, 700, 400] }, 1280, 720, cal, cam, plane), null);
  assert.equal(liftBox({ ...boxFor(20, 0, 'car', 'car'), s: 0.1 }, 1280, 720, cal, cam, plane), null);
  assert.equal(liftBox({ k: 'car', s: 0.9, b: [700, 300, 600, 400] }, 1280, 720, cal, cam, plane), null);
  const far = boxFor(MAX_RANGE_M + 30, 0, 'car', 'car');
  assert.equal(liftBox(far, 1280, 720, cal, cam, plane), null);
});

test('a traffic light and a stop sign are placed by their face size and bearing', () => {
  const head = (x, y, z, face) => {
    const a = carToPixel(cal.M, cam, plane, x, y + 0.2, z + face / 2), b = carToPixel(cal.M, cam, plane, x, y - 0.2, z - face / 2);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  };
  const tl = liftSign({ k: 'traffic_light', s: 0.8, b: head(35, 2, 5, 1.0) }, 1280, 720, cal, cam, plane);
  assert.ok(Math.abs(tl.x - 35) < 2 && Math.abs(tl.y - 2) < 0.5 && Math.abs(tl.z - 5) < 0.6, JSON.stringify(tl));
  const st = liftSign({ k: 'stop_sign', s: 0.8, b: head(20, -4, 2.1, 0.75) }, 1280, 720, cal, cam, plane);
  assert.ok(Math.abs(st.x - 20) < 1.5 && Math.abs(st.y + 4) < 0.4, JSON.stringify(st));
  assert.ok(tl.conf < 0.8, 'placement alone is low confidence');
});

test('a placed signal snaps to the mapped one of its kind, near its bearing and range', () => {
  const pose = { x: 100, y: 50, h: 0.3 }, axle = 3.84;
  const sign = { k: 'traffic_light', x: 35, y: 2, z: 5 };
  const [mx, my] = carToPose(pose, axle, 38, 2.6);          // mapped a few m farther: the same signal
  const [ox, oy] = carToPose(pose, axle, 30, -12);          // another signal, well off the bearing
  const [sx, sy] = carToPose(pose, axle, 36, 2);            // a stop sign at the same place: wrong kind
  const feats = [{ kind: 'signal', x: ox, y: oy }, { kind: 'stop', x: sx, y: sy }, { kind: 'signal', x: mx, y: my }];
  assert.equal(matchMapSign(sign, feats, pose, axle, cam), 2);
  assert.equal(matchMapSign({ ...sign, x: 80 }, feats, pose, axle, cam), -1);   // range too far off
  const back = poseToCar(pose, axle, mx, my);
  assert.ok(Math.abs(back[0] - 38) < 1e-9 && Math.abs(back[1] - 2.6) < 1e-9);
});

test('a whole protocol message: road users and signs split, wrong version ignored', () => {
  const msg = { v: 1, frameId: 7, w: 1280, h: 720, dets: [boxFor(15, 2.5, 'pedestrian', 'person'), boxFor(40, 0, 'truck', 'truck'),
    { k: 'stop_sign', s: 0.7, b: [900, 300, 930, 330] }, { k: 'kite', s: 0.9, b: [1, 1, 5, 5] }] };
  const out = placeDetections(msg, cal, cam, plane);
  assert.equal(out.objects.length, 2);
  assert.equal(out.signs.length, 1);
  assert.deepEqual(placeDetections({ ...msg, v: 2 }, cal, cam, plane), { objects: [], signs: [] });
  assert.deepEqual(placeDetections(msg, null, cam, plane), { objects: [], signs: [] });
});
