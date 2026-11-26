// node --test static/js/tests/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HEIGHT_INIT, carToCalib, projectCalib, projectGround, matRows, groundFit, poseAt, captureTransform, applyTransform,
  arrivalAge, memoryCenter, memoryPoint, memoryUV, objectShadow, shadowed, liveWeight, BASE_LATENCY_S, NEAR_M, FAR_M,
} from '../videoground_geom.js';

// M the way the bridge makes it (webhud/video.py camera_transforms): K . view_frame_from_device_frame . device_from_calib,
// with a calibration of zero roll/pitch/yaw: a 1280 x 720 stream, 1000 px focal length, principal point in the middle
const W = 1280, H = 720;
const K = [[1000, 0, 640], [0, 1000, 360], [0, 0, 1]];
const VIEW_FROM_DEVICE = [[0, 1, 0], [0, 0, 1], [1, 0, 0]];
const mul = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
const M = mul(K, VIEW_FROM_DEVICE);
const CAM = { x: -1.6, y: 0, h: HEIGHT_INIT, slope: 0 };
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('car frame to calib frame: ahead of the camera, right positive, down to the road', () => {
  assert.deepEqual(carToCalib(20, 2, 0, CAM), [21.6, -2, HEIGHT_INIT]);
  // a road rising ahead comes closer to the camera's height
  const p = carToCalib(20, 0, 0, { ...CAM, slope: 0.02 });
  near(p[2], HEIGHT_INIT - 0.02 * 21.6);
  // and agrees with the ground fit: the lane lines of a road rising 1 % have z = h - 0.01 f
  near(carToCalib(20, 0, 0, { ...CAM, h: 1.45, slope: groundFit({ pathZ: 1.3, lanes: [Array.from({ length: 33 }, (_, i) => [i * 2, 1.8, 1.45 - 0.01 * i * 2]), Array.from({ length: 33 }, (_, i) => [i * 2, -1.8, 1.45 - 0.01 * i * 2])], laneProbs: [0.9, 0.9] }).slope })[2], 1.45 - 0.01 * 21.6, 1e-6);
});

test('a point straight ahead on the road lands on the middle column, under the horizon', () => {
  const uv = projectGround(M, W, H, 20, 0, CAM);
  near(uv[0], 0.5);
  near(uv[1], (1000 * HEIGHT_INIT / 21.6 + 360) / 720);
  assert.ok(uv[1] > 0.5);
});

test('farther points climb toward the horizon (v = 0.5 here); left of the car is left in the picture', () => {
  const v20 = projectGround(M, W, H, 20, 0, CAM)[1], v50 = projectGround(M, W, H, 50, 0, CAM)[1];
  assert.ok(v50 < v20 && v50 > 0.5);
  assert.ok(projectGround(M, W, H, 20, 2, CAM)[0] < 0.5);
  assert.ok(projectGround(M, W, H, 20, -2, CAM)[0] > 0.5);
});

test('behind the camera, or off the frame, is nothing', () => {
  assert.equal(projectGround(M, W, H, -3, 0, CAM), null);
  assert.equal(projectGround(M, W, H, 0.5, 0, CAM), null);     // just ahead of the bumper: below the frame
  assert.equal(projectGround(M, W, H, 10, 40, CAM), null);     // far out to the side
  assert.equal(projectCalib(M, W, H, [0, 0, 1]), null);
});

test('matRows is row-major (three.js Matrix3.set order)', () => {
  assert.deepEqual(matRows([[1, 2, 3], [4, 5, 6], [7, 8, 9]]), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('ground fit: height and slope from confident lane lines; the calibrated height otherwise', () => {
  const line = (y, a, b) => Array.from({ length: 33 }, (_, i) => { const x = i * 2; return [x, y, a - b * x]; });
  const fit = groundFit({ pathZ: 1.3, lanes: [line(1.8, 1.45, 0.01), line(-1.8, 1.45, 0.01)], laneProbs: [0.9, 0.9] });
  near(fit.h, 1.45, 1e-6);
  near(fit.slope, 0.01, 1e-6);
  assert.deepEqual(groundFit({ pathZ: 1.3, lanes: [line(1.8, 1.45, 0.01)], laneProbs: [0.1] }), { h: 1.3, slope: 0 });
  assert.deepEqual(groundFit(null), { h: HEIGHT_INIT, slope: 0 });
  assert.deepEqual(groundFit({ pathZ: 9 }), { h: HEIGHT_INIT, slope: 0 });   // nonsense height: the default
  // a nonsense fit (a 40 % slope) is refused
  assert.deepEqual(groundFit({ pathZ: 1.3, lanes: [line(1.8, 1.45, 0.4)], laneProbs: [0.9] }), { h: 1.3, slope: 0 });
});

test('pose history interpolation, across the heading wrap', () => {
  const hist = [{ t: 0, x: 0, y: 0, h: 3.1 }, { t: 1, x: 10, y: 0, h: -3.1 }];
  const p = poseAt(hist, 0.5);
  near(p.x, 5);
  near(Math.abs(p.h), Math.PI, 0.02);
  assert.equal(poseAt(hist, -1), hist[0]);
  assert.equal(poseAt(hist, 5), hist[1]);
  assert.equal(poseAt([], 0), null);
});

test('capture transform, straight: a point 5 m ahead now was 15 m ahead 10 m ago', () => {
  const T = captureTransform({ x: 10, y: 0, h: 0 }, { x: 0, y: 0, h: 0 }, 3.85);
  const [x, y] = applyTransform(T, 5, 1);
  near(x, 15); near(y, 1);
});

test('capture transform agrees with going through the ground frame, turning', () => {
  const axle = 3.85, now = { x: 3, y: 4, h: 0.7 }, cap = { x: -2, y: 1, h: 0.2 };
  const T = captureTransform(now, cap, axle);
  for (const [x, y] of [[5, 1], [20, -3], [0, 0]]) {
    // car (bumper) -> axle -> ground
    const ax = x + axle, gx = now.x + Math.cos(now.h) * ax - Math.sin(now.h) * y, gy = now.y + Math.sin(now.h) * ax + Math.cos(now.h) * y;
    // ground -> capture axle -> bumper
    const dx = gx - cap.x, dy = gy - cap.y;
    const cx = Math.cos(-cap.h) * dx - Math.sin(-cap.h) * dy - axle, cy = Math.sin(-cap.h) * dx + Math.cos(-cap.h) * dy;
    const [tx, ty] = applyTransform(T, x, y);
    near(tx, cx, 1e-9); near(ty, cy, 1e-9);
  }
  assert.deepEqual(captureTransform(null, cap, axle), { c: 1, s: 0, tx: 0, ty: 0 });
});

test('arrival age: the fastest frame sets the clock offset; a late one counts as older', () => {
  const track = {};
  near(arrivalAge(track, 5000, 1000), BASE_LATENCY_S);           // the first: offset 4000
  near(arrivalAge(track, 5150, 1100), BASE_LATENCY_S + 0.05);    // 50 ms later than the fastest
  near(arrivalAge(track, 5180, 1190), BASE_LATENCY_S);           // a faster one: new offset
  // the offset is relearnt after the window (a clock step)
  near(arrivalAge(track, 30000, 1000, 30000), BASE_LATENCY_S);
  near(arrivalAge({}, NaN, 0), BASE_LATENCY_S);
});

test('road memory: the centre snaps to the grid; texels and ground points round-trip', () => {
  assert.deepEqual(memoryCenter({ x: 30, y: -7, h: 0 }), [0, -32]);
  const c = [16, -32];
  const [X, Z] = memoryPoint(c, 0.25, 0.75);
  near(X, 0); near(Z, -48);
  const uv = memoryUV(c, X, Z);
  near(uv[0], 0.25); near(uv[1], 0.75);
  assert.equal(memoryUV(c, 100, 0), null);
});

test('object shadows: the road behind a car ahead is hidden, beside it and before it is not', () => {
  const car = { x: 20, y: 0, l: 4.6, w: 1.9, h: 0 };
  const sh = objectShadow(car, CAM);
  assert.ok(sh.a1 < 0 && sh.a2 > 0 && sh.near < 21.6);
  assert.ok(shadowed([sh], 35, 0, CAM));
  assert.ok(shadowed([sh], 21, 0.5, CAM));         // under the car itself
  assert.ok(!shadowed([sh], 10, 0, CAM));          // in front of it
  assert.ok(!shadowed([sh], 35, 6, CAM));          // well beside it
  assert.equal(objectShadow({ x: -2, y: 3, l: 4.6, w: 1.9 }, CAM), null);   // beside the camera
  assert.ok(!shadowed([null], 35, 0, CAM));
});

test('live weight: ramps in after the near limit, out before the far one, off the frame zero', () => {
  const at = (x, y) => liveWeight(x, y, projectGround(M, W, H, x, y, CAM), CAM);
  assert.equal(at(-1, 0), 0);
  assert.equal(at(NEAR_M + CAM.x - 1, 0), 0);
  near(at(20, 0), 1);
  assert.ok(at(FAR_M * 0.9 + CAM.x, 0) < 1);
  assert.equal(at(FAR_M + CAM.x + 1, 0), 0);
  assert.equal(liveWeight(20, 0, null, CAM), 0);
});
