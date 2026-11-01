// Where a world object is drawn: the arithmetic of scene.js _worldObjects, kept apart so it runs under node --test.
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// Seen within this cosine of its length axis, an object is placed by its end; beyond it, by its side. Between the
// two the placement blends, because a hard switch moved a car a meter or two as we passed it.
export const END_ON_COS = 0.65, SIDE_ON_COS = 0.35;
// Closer than NEAR_M the reported point is too close to the car to say which face it is: the point itself is used.
const NEAR_M = 1, FAR_M = 2;

/** The center of an object from the point the sources report, the face nearest us (ego frame, x ahead, y left).
 *  heading in radians from our axis; l and w in meters. */
export function centerFromFace(x, y, heading, l, w) {
  const d = Math.hypot(x, y);
  if (d <= NEAR_M) return [x, y];
  const ax = Math.cos(heading), ay = Math.sin(heading);
  const along = (x * ax + y * ay) / d;   // cosine between our line of sight and its length
  const end = smoothstep(SIDE_ON_COS, END_ON_COS, Math.abs(along));
  const reach = smoothstep(NEAR_M, FAR_M, d);
  const kEnd = reach * end * Math.sign(along) * l / 2;
  const kSide = reach * (1 - end) * Math.sign(y * ax - x * ay) * w / 2;   // which of its sides faces us
  return [x + kEnd * ax - kSide * ay, y + kEnd * ay + kSide * ax];
}

/** The car's pose `age` seconds ago, from its pose now and its motion (v m/s, w rad/s). A snapshot's objects are
 *  relative to the car when it was taken, so that is the pose they belong to, not the frame's. */
export function poseBefore(p, v, w, age) {
  const h = p.h - w * age, hm = p.h - 0.5 * w * age;
  return { x: p.x - v * Math.cos(hm) * age, y: p.y - v * Math.sin(hm) * age, h };
}

/** One frame of an object's motion. The target and the drawn position move together on the estimated velocity, and
 *  only the gap a new estimate opened closes over tau: a correction is smoothed, the object's own motion never lags. */
export function glide(e, dt, rate, tau) {
  const dx = e.vx * dt * rate, dy = e.vy * dt * rate, k = 1 - Math.exp(-dt / tau);
  e.tx += dx; e.ty += dy;
  e.wx += dx; e.wy += dy;
  e.wx += (e.tx - e.wx) * k;
  e.wy += (e.ty - e.wy) * k;
}
