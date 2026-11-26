// Camera on road (videoground.js): the arithmetic that puts the comma's camera pixels on the 3D view's ground.
// No DOM, no three.js, so Node tests it (static/js/tests/videoground_geom.test.js). The shaders in videoground.js
// do the same per fragment; the functions here are their reference and what the CPU side needs.
//
// Frames:
//   car frame    x forward, y left, m, origin = front bumper (the server data and scene.js's vehicle frame)
//   scene        X right, Y up, Z backward: X = -y, Z = -x (scene.js toScene)
//   calib frame  x forward, y right, z down, origin = the comma's camera (openpilot's calibrated frame): the
//                frame the bridge's M maps to stream pixels (sunnypilot webhud/video.py: M = K . view_from_calib)
//   pose frame   the scene's ground frame: the rear axle at (x, y) heading h (scene.js this.pose)

export const HEIGHT_INIT = 1.22;   // m, the camera over the road before calibration (calibrationd HEIGHT_INIT)
export const NEAR_M = 3, FAR_M = 60;          // live projection: from this far ahead of the camera to this far
export const MEM_NEAR_M = 2, MEM_FAR_M = 30;  // what's written into the road memory (the sharp part of the frame)
export const MEM_SIZE_M = 64, MEM_STEP_M = 16;   // road memory: its square side, and the grid its centre snaps to
export const BASE_LATENCY_S = 0.1;            // capture to arrival on the page, before the clock-offset correction
export const MAX_OBJECTS = 16;                // object shadows the shaders take

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** A car-frame ground point (x, y, height above the road) in the calib frame, with the camera `cam`:
 *  {x: m ahead of the bumper (negative: behind it), y: m left, h: camera height over the road, slope: road
 *  rise per m ahead (calib z down gets smaller where the road rises)}. */
export function carToCalib(x, y, up, cam) {
  const f = x - cam.x;
  return [f, -(y - (cam.y || 0)), cam.h + (cam.slope || 0) * f - up];
}

/** [u, v] in 0..1 of the stream (v down) for a calib-frame point, or null behind the camera or off the frame. */
export function projectCalib(M, width, height, p) {
  const w = M[2][0] * p[0] + M[2][1] * p[1] + M[2][2] * p[2];
  if (!(w > 1e-3)) return null;
  const u = (M[0][0] * p[0] + M[0][1] * p[1] + M[0][2] * p[2]) / w / width;
  const v = (M[1][0] * p[0] + M[1][1] * p[1] + M[1][2] * p[2]) / w / height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return [u, v];
}

/** Where a car-frame ground point lands in the stream, [u, v] in 0..1, or null. */
export function projectGround(M, width, height, x, y, cam) {
  return projectCalib(M, width, height, carToCalib(x, y, 0, cam));
}

/** M row-major as nine numbers, the order three.js Matrix3.set takes (so the shader's uM * v is M . v). */
export function matRows(M) {
  return [M[0][0], M[0][1], M[0][2], M[1][0], M[1][1], M[1][2], M[2][0], M[2][1], M[2][2]];
}

/**
 * The road under the camera from one model output (the bridge's `model` message, calib frame): its height below the
 * camera and its slope ahead, fitted to the lane lines the model is sure of between 6 and 40 m (their z is the road's,
 * z down), else the calibrated height (`pathZ`) on a flat road.
 */
export function groundFit(model) {
  const h0 = model && Number.isFinite(model.pathZ) && model.pathZ > 0.5 && model.pathZ < 3 ? model.pathZ : HEIGHT_INIT;
  const pts = [];
  const lanes = (model && model.lanes) || [];
  lanes.forEach((line, i) => {
    if (((model.laneProbs || [])[i] ?? 0) < 0.4 || !Array.isArray(line)) return;
    for (const p of line) if (p && p[0] >= 6 && p[0] <= 40 && Number.isFinite(p[2])) pts.push(p);
  });
  if (pts.length < 6) return { h: h0, slope: 0 };
  // least squares z = a + b x
  let sx = 0, sz = 0, sxx = 0, sxz = 0;
  for (const [x, , z] of pts) { sx += x; sz += z; sxx += x * x; sxz += x * z; }
  const n = pts.length, den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-6) return { h: h0, slope: 0 };
  const b = (n * sxz - sx * sz) / den, a = (sz - b * sx) / n;
  // a camera 0.5-3 m over the road, and no road steeper than 15 %: else the fit is noise
  if (!(a > 0.5 && a < 3) || Math.abs(b) > 0.15) return { h: h0, slope: 0 };
  return { h: a, slope: -b };   // z down shrinks where the road rises: slope is the rise per m
}

/** The pose (scene.js this.pose: x, y, h) at time t from a history of {t, x, y, h} oldest first, interpolated. */
export function poseAt(history, t) {
  if (!history.length) return null;
  if (t <= history[0].t) return history[0];
  const last = history[history.length - 1];
  if (t >= last.t) return last;
  let i = history.length - 1;
  while (i > 0 && history[i - 1].t > t) i--;
  const a = history[i - 1], b = history[i], k = (t - a.t) / Math.max(1e-9, b.t - a.t);
  let dh = b.h - a.h;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  return { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, h: a.h + dh * k };
}

/**
 * The rigid motion taking a car-frame point now to where the same ground point was in the car frame at capture:
 * {c, s, tx, ty} with x' = c x - s y + tx, y' = s x + c y + ty. `axle` is the bumper-to-rear-axle distance (m): the
 * poses are the rear axle's, the car frame's origin the front bumper.
 */
export function captureTransform(now, cap, axle) {
  if (!now || !cap) return { c: 1, s: 0, tx: 0, ty: 0 };
  // car (bumper) -> axle: x + axle; axle frame now -> pose frame -> axle frame at capture; then back to the bumper
  const dh = cap.h - now.h;
  const c = Math.cos(-dh), s = Math.sin(-dh);   // rotation by -dh
  // pose-frame offset of the axle now from the axle at capture, in the capture axle frame
  const ex = now.x - cap.x, ey = now.y - cap.y;
  const cc = Math.cos(-cap.h), sc = Math.sin(-cap.h);
  const ox = cc * ex - sc * ey, oy = sc * ex + cc * ey;
  // x' = R(-dh) (x + axle, y) + o - (axle, 0)
  return { c, s, tx: c * axle + ox - axle, ty: s * axle + oy };
}

export function applyTransform(T, x, y) {
  return [T.c * x - T.s * y + T.tx, T.s * x + T.c * y + T.ty];
}

/**
 * How old a frame is when it arrives, s: the device's capture timestamp against the page's clock, which differ by an
 * unknown offset. The smallest difference seen recently is taken as the offset plus the base latency, so jitter
 * (a frame stuck on Wi-Fi) shows up as extra age instead of being lost. `track` keeps {min, at} between calls.
 */
export function arrivalAge(track, arrivalMs, captureMs, nowMs = arrivalMs, windowMs = 10000) {
  const d = arrivalMs - captureMs;
  if (!Number.isFinite(d)) return BASE_LATENCY_S;
  if (track.min == null || d < track.min || nowMs - track.at > windowMs) { track.min = d; track.at = nowMs; }
  return BASE_LATENCY_S + clamp((d - track.min) / 1000, 0, 1);
}

/** The road memory's centre in the scene's ground frame (scene.js: X = -pose.y, Z = -pose.x), snapped to the grid. */
export function memoryCenter(pose, step = MEM_STEP_M) {
  return [Math.round(-pose.y / step) * step, Math.round(-pose.x / step) * step];
}

/** A road memory texel (u, v in 0..1) as a ground point [X, Z] of the scene's ground frame (plane geometry rotated
 *  flat: u along +X, v along -Z). */
export function memoryPoint(center, u, v, size = MEM_SIZE_M) {
  return [center[0] + (u - 0.5) * size, center[1] - (v - 0.5) * size];
}

/** ...and back: the texel of a ground point, [u, v], or null outside the memory. */
export function memoryUV(center, X, Z, size = MEM_SIZE_M) {
  const u = (X - center[0]) / size + 0.5, v = -(Z - center[1]) / size + 0.5;
  return u < 0 || u > 1 || v < 0 || v > 1 ? null : [u, v];
}

/**
 * The ground an object hides from the camera, as seen from it (capture car frame): the bearings (rad, left positive)
 * between which, and the distance beyond which, the camera's pixels show the object, not the road. `o` is
 * {x, y, l, w, h: heading (rad, left positive), pad}; `cam` the camera's {x, y}.
 */
export function objectShadow(o, cam) {
  const pad = o.pad ?? 0.4;
  const hl = o.l / 2 + pad, hw = o.w / 2 + pad, c = Math.cos(o.h || 0), s = Math.sin(o.h || 0);
  let a1 = Infinity, a2 = -Infinity, near = Infinity;
  for (const [i, j] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const px = o.x + c * hl * i - s * hw * j - cam.x, py = o.y + s * hl * i + c * hw * j - (cam.y || 0);
    if (px <= 0.1) return null;   // beside or behind the camera: it can't hide the road ahead
    const a = Math.atan2(py, px);
    a1 = Math.min(a1, a); a2 = Math.max(a2, a);
    near = Math.min(near, Math.hypot(px, py));
  }
  return { a1, a2, near };
}

/** Whether a car-frame ground point is hidden from the camera by one of the shadows (objectShadow). */
export function shadowed(shadows, x, y, cam) {
  const px = x - cam.x, py = y - (cam.y || 0);
  if (px <= 0) return false;
  const a = Math.atan2(py, px), d = Math.hypot(px, py);
  return shadows.some(sh => sh && a >= sh.a1 && a <= sh.a2 && d >= sh.near);
}

/**
 * The live projection's visibility of a car-frame ground point, 0..1: ramps in past NEAR_M and out toward FAR_M ahead
 * of the camera, out to the sides past `side` m, and at the frame's edges (uv within `edge` of them).
 */
export function liveWeight(x, y, uv, cam, side = 14, edge = 0.04) {
  if (!uv) return 0;
  const f = x - cam.x;
  const ramp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
  const near = ramp(NEAR_M, NEAR_M + 3, f), far = 1 - ramp(FAR_M * 0.7, FAR_M, f);
  const lat = 1 - ramp(side * 0.7, side, Math.abs(y));
  const e = Math.min(ramp(0, edge, uv[0]), ramp(0, edge, 1 - uv[0]), ramp(0, edge, uv[1]), ramp(0, edge, 1 - uv[1]));
  return near * far * lat * e;
}
