// NPU detector (npu.js): the arithmetic that turns the Pulse NPU's boxes in the comma's camera picture into road
// users on the ground and signals beside the road. No DOM, no three.js, so Node tests it
// (static/js/tests/npu_geom.test.js).
//
// Frames are videoground_geom.js's: the car frame (x forward from the front bumper, y left, m), the calib frame (x
// forward, y right, z down from the comma's camera; the bridge's M = K . view_from_calib maps it to stream pixels) and
// the pose frame (the scene's ground frame: the rear axle at (x, y) heading h).
//
// A box is placed two ways. Its bottom edge, where the object stands on the road, is cast onto the road plane under
// the camera (a ray through M's inverse); and its height in pixels, against what the class usually measures, gives a
// range by the pinhole relation. The road plane is good near the car and drifts with pitch error far out (a tenth of
// a degree is a metre at 40 m), the height prior is the other way round, so the two are blended by their spreads.
// When they disagree a lot the box is probably not what it says (or only part of it shows) and counts for less.
import { groundFit, HEIGHT_INIT } from './videoground_geom.js';

export const PROTOCOL = 1;
export const MAX_RANGE_M = 80;      // m ahead of the camera: farther, a box is a few pixels and its class a guess
export const MIN_RANGE_M = 2;
export const MAX_LATERAL_M = 25;
export const MIN_SCORE = 0.35;      // the detector's own score below which a box is ignored (the app sends 0.35 and up)
export const CUT_FRAC = 0.985;      // a box reaching this far down the picture has its foot cut off by the frame

// the detector's classes (COCO names the native side sends) as the world model knows them; a bus is drawn as a truck
export const CLASS_MAP = { person: 'pedestrian', bicycle: 'bicycle', motorcycle: 'motorcycle', car: 'car', bus: 'truck', truck: 'truck' };
export const SIGN_KINDS = new Set(['traffic_light', 'stop_sign']);
// how tall each usually stands in the picture (m): a person, a rider on a bicycle or motorcycle, a car's roof, a bus
// or truck; and the size and mounting height of a signal head and a stop sign's face
export const HEIGHT_PRIOR = { person: 1.7, bicycle: 1.7, motorcycle: 1.5, car: 1.5, bus: 3.1, truck: 3.2 };
export const HEIGHT_SPREAD = { person: 0.12, bicycle: 0.12, motorcycle: 0.15, car: 0.15, bus: 0.15, truck: 0.25 };   // fractional, 1 sigma
export const DIMS_PRIOR = {   // w, l, h (m): what the world model sizes a camera-only object by
  pedestrian: [0.6, 0.6, 1.7], bicycle: [0.6, 1.8, 1.7], motorcycle: [0.8, 2.1, 1.5], car: [1.85, 4.6, 1.5], truck: [2.5, 8.0, 3.2],
};
export const SIGN_FACE = { traffic_light: 1.0, stop_sign: 0.75 };      // m: a 3-lamp head's height, a stop sign's face
export const SIGN_HEIGHT = { traffic_light: 5.0, stop_sign: 2.1 };     // m: their usual centre over the road
const PITCH_SIGMA = 0.005;          // rad: how far the calibrated pitch may be off (about 0.3 deg)
const BEARING_SIGMA = 0.005;        // rad: the box centre's bearing, a few pixels
const MAP_BEARING = 8 * Math.PI / 180;   // a signal within this bearing of a mapped one...
const MAP_RANGE = [0.6, 1.6];            // ...and this range ratio is the mapped one

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The inverse of a 3x3 matrix (arrays of rows), or null when it's singular. */
export function inv3(M) {
  const [[a, b, c], [d, e, f], [g, h, i]] = M;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const k = 1 / det;
  return [
    [A * k, -(b * i - c * h) * k, (b * f - c * e) * k],
    [B * k, (a * i - c * g) * k, -(a * f - c * d) * k],
    [C * k, -(a * h - b * g) * k, (a * e - b * d) * k],
  ];
}

const mv = (M, p) => [M[0][0] * p[0] + M[0][1] * p[1] + M[0][2] * p[2], M[1][0] * p[0] + M[1][1] * p[1] + M[1][2] * p[2],
  M[2][0] * p[0] + M[2][1] * p[1] + M[2][2] * p[2]];

/**
 * The road under the camera from the bridge's model message: {h: m below the camera, b: dz/dx in the calib frame}, so
 * the road at x m ahead of the camera is at z = h + b x (z down: a rising road has b < 0). groundFit gives the rise
 * per metre as `slope` = -b.
 */
export function roadPlane(model) {
  const fit = groundFit(model);
  return { h: fit.h || HEIGHT_INIT, b: -(fit.slope || 0) || 0 };   // (no -0)
}

/** The focal length (px) along the picture's height, from the camera's K, else from M (|M row 1| ~ fy for a level camera). */
export function focalY(cal) {
  if (cal && Array.isArray(cal.K) && cal.K[1] && Number.isFinite(cal.K[1][1])) return cal.K[1][1];
  const r = cal && cal.M && cal.M[1];
  return r ? Math.hypot(r[0], r[1], r[2]) : null;
}

/** Where the ray through stream pixel (u, v) meets the road plane: [f (m ahead of the camera), right (m)], or null. */
export function pixelToGround(Minv, u, v, plane) {
  const d = mv(Minv, [u, v, 1]);
  if (!(d[0] > 1e-6)) return null;          // behind the camera or along the horizon
  const den = d[2] - plane.b * d[0];
  if (!(den > 1e-6)) return null;           // at or above the horizon: never meets the road
  const s = plane.h / den;
  return [s * d[0], s * d[1]];
}

/** The bearing of stream pixel (u, v) as right-per-forward (tan of the angle right of straight ahead), or null. */
export function pixelBearing(Minv, u, v) {
  const d = mv(Minv, [u, v, 1]);
  return d[0] > 1e-6 ? d[1] / d[0] : null;
}

/**
 * One road user's box placed on the ground. det {k, s, b: [x1, y1, x2, y2]} in a w x h picture; cal the bridge's
 * calib entry for the camera ({M, K, width, height}); cam {x: the camera's place ahead of the bumper (m, negative
 * behind it)}; plane roadPlane(). Returns {cls, k, x, y (car frame at capture: the near face's middle), f (m ahead
 * of the camera), sx, sy (1 sigma, m), conf (0..1), cut, dims} or null.
 */
export function liftBox(det, w, h, cal, cam, plane, Minv = null) {
  const cls = CLASS_MAP[det && det.k];
  if (!cls || !cal || !cal.M || !(det.s >= MIN_SCORE)) return null;
  const b = det.b;
  if (!Array.isArray(b) || b.length !== 4 || !(b[2] > b[0]) || !(b[3] > b[1])) return null;
  Minv = Minv || inv3(cal.M);
  if (!Minv) return null;
  const su = (cal.width || w) / w, sv = (cal.height || h) / h;
  const u = (b[0] + b[2]) / 2 * su, vFoot = b[3] * sv, boxH = (b[3] - b[1]) * sv;
  const fy = focalY(cal);
  const H = HEIGHT_PRIOR[det.k], spread = HEIGHT_SPREAD[det.k];
  const cut = b[3] >= h * CUT_FRAC;
  // range from the height prior (pinhole: Z = fy H / h_px, Z along the optical axis ~ ahead of the camera)
  const fH = fy && boxH > 1 ? fy * H / boxH : null;
  const sH = fH !== null ? spread * fH : Infinity;
  // range from the foot on the road
  const g = cut ? null : pixelToGround(Minv, u, vFoot, plane);
  let fG = g ? g[0] : null;
  const sG = fG !== null ? 0.25 + PITCH_SIGMA * fG * fG / Math.max(plane.h, 0.5) : Infinity;
  if (fG === null && fH === null) return null;
  // blend by inverse variance
  let f;
  if (fG === null) f = fH;
  else if (fH === null) f = fG;
  else { const wG = 1 / (sG * sG), wH = 1 / (sH * sH); f = (fG * wG + fH * wH) / (wG + wH); }
  const sf = 1 / Math.sqrt((Number.isFinite(sG) ? 1 / (sG * sG) : 0) + (Number.isFinite(sH) ? 1 / (sH * sH) : 0));
  if (!(f >= MIN_RANGE_M) || f > MAX_RANGE_M) return null;
  const tan = pixelBearing(Minv, u, cut ? (b[1] + b[3]) / 2 * sv : vFoot);
  if (tan === null) return null;
  const right = tan * f;
  if (Math.abs(right) > MAX_LATERAL_M) return null;
  // the two ranges agreeing (within their spreads) says the box is a whole one of what it says it is
  let agree = 1;
  if (fG !== null && fH !== null) {
    const r = Math.log(fG / fH), sr = Math.hypot(sG / fG, sH / fH);
    agree = Math.exp(-0.5 * (r / Math.max(sr, 0.05)) ** 2);
  }
  const conf = clamp(det.s * (0.5 + 0.5 * agree) * (cut ? 0.7 : 1), 0, 1);
  return {
    cls, k: det.k, x: f + cam.x, y: -right, f,
    sx: Math.max(0.3, sf), sy: 0.2 + BEARING_SIGMA * f + 0.02 * Math.abs(right),
    conf, cut, score: det.s, dims: DIMS_PRIOR[cls] || null,
  };
}

/**
 * A traffic light or stop sign box placed beside the road: range from its face's size, bearing from its centre, in
 * the car frame at capture. Returns {k, x, y, z (m over the road), f, conf} or null.
 */
export function liftSign(det, w, h, cal, cam, plane, Minv = null) {
  if (!det || !SIGN_KINDS.has(det.k) || !cal || !cal.M || !(det.s >= MIN_SCORE)) return null;
  const b = det.b;
  if (!Array.isArray(b) || b.length !== 4 || !(b[2] > b[0]) || !(b[3] > b[1])) return null;
  Minv = Minv || inv3(cal.M);
  if (!Minv) return null;
  const su = (cal.width || w) / w, sv = (cal.height || h) / h;
  const u = (b[0] + b[2]) / 2 * su, vc = (b[1] + b[3]) / 2 * sv, boxH = (b[3] - b[1]) * sv;
  const fy = focalY(cal);
  if (!fy || boxH < 2) return null;
  const f = fy * SIGN_FACE[det.k] / boxH;
  if (!(f >= MIN_RANGE_M) || f > MAX_RANGE_M) return null;
  const d = mv(Minv, [u, vc, 1]);
  if (!(d[0] > 1e-6)) return null;
  const right = d[1] / d[0] * f, down = d[2] / d[0] * f;
  const z = plane.h + plane.b * f - down;   // over the road under it
  return { k: det.k, x: f + cam.x, y: -right, z, f, conf: clamp(det.s * 0.6, 0, 1), score: det.s };
}

/** A car-frame point at a pose (rear axle {x, y, h}; the bumper `axle` m ahead of it) in the pose frame, and back. */
export function carToPose(pose, axle, x, y) {
  const c = Math.cos(pose.h), s = Math.sin(pose.h), xr = x + axle;
  return [pose.x + c * xr - s * y, pose.y + s * xr + c * y];
}
export function poseToCar(pose, axle, px, py) {
  const c = Math.cos(pose.h), s = Math.sin(pose.h), dx = px - pose.x, dy = py - pose.y;
  return [c * dx + s * dy - axle, -s * dx + c * dy];
}

/**
 * A detected signal or stop sign matched to the map's: `features` are the map's point features in the pose frame
 * ({kind: 'signal' | 'stop' | ..., x, y}), `sign` liftSign()'s, `pose` the capture pose. Returns the matched feature's
 * index, or -1: the nearest of the right kind within MAP_BEARING of the sign's bearing and MAP_RANGE of its range.
 */
export function matchMapSign(sign, features, pose, axle, cam) {
  if (!sign || !features || !pose) return -1;
  const want = sign.k === 'traffic_light' ? 'signal' : 'stop';
  const bear = Math.atan2(sign.y, sign.x - cam.x), rng = Math.hypot(sign.x - cam.x, sign.y);
  let best = -1, bestCost = Infinity;
  features.forEach((ft, i) => {
    if (!ft || ft.kind !== want) return;
    const [x, y] = poseToCar(pose, axle, ft.x, ft.y);
    const fx = x - cam.x;
    if (fx <= 1) return;
    const b = Math.atan2(y, fx), r = Math.hypot(fx, y);
    const db = Math.abs(Math.atan2(Math.sin(b - bear), Math.cos(b - bear)));
    const ratio = r / rng;
    if (db > MAP_BEARING || ratio < MAP_RANGE[0] || ratio > MAP_RANGE[1]) return;
    const cost = (db / MAP_BEARING) ** 2 + Math.log(ratio) ** 2 / 0.1;
    if (cost < bestCost) { bestCost = cost; best = i; }
  });
  return best;
}

/**
 * One protocol v1 inference message, placed: {objects: liftBox() results, signs: liftSign() results}. Boxes of
 * unknown classes, too faint, off the road or past the range limit are left out.
 */
export function placeDetections(msg, cal, cam, plane) {
  const out = { objects: [], signs: [] };
  if (!msg || msg.v !== PROTOCOL || !Array.isArray(msg.dets) || !(msg.w > 0) || !(msg.h > 0) || !cal || !cal.M) return out;
  const Minv = inv3(cal.M);
  if (!Minv) return out;
  for (const det of msg.dets) {
    if (SIGN_KINDS.has(det && det.k)) {
      const s = liftSign(det, msg.w, msg.h, cal, cam, plane, Minv);
      if (s) out.signs.push(s);
    } else {
      const o = liftBox(det, msg.w, msg.h, cal, cam, plane, Minv);
      if (o) out.objects.push(o);
    }
  }
  return out;
}

/** Forward projection (the synthetic feeder's and the tests' reference): a car-frame point (x, y, up m over the road)
 *  to stream pixels [u, v], or null behind the camera. */
export function carToPixel(M, cam, plane, x, y, up) {
  const f = x - cam.x;
  const p = [f, -y, plane.h + plane.b * f - up];
  const q = mv(M, p);
  if (!(q[2] > 1e-6)) return null;
  return [q[0] / q[2], q[1] / q[2]];
}

/** The box an upright object of size (w, l, hgt) whose near face's middle stands at car-frame (x, y) makes in the
 *  picture: [x1, y1, x2, y2] (stream px), or null if any corner is behind the camera. Facing along the car. */
export function objectBox(M, cam, plane, x, y, w, l, hgt) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const dx of [0, l]) for (const dy of [-w / 2, w / 2]) for (const up of [0, hgt]) {
    const p = carToPixel(M, cam, plane, x + dx, y + dy, up);
    if (!p) return null;
    x1 = Math.min(x1, p[0]); y1 = Math.min(y1, p[1]); x2 = Math.max(x2, p[0]); y2 = Math.max(y2, p[1]);
  }
  return [x1, y1, x2, y2];
}
