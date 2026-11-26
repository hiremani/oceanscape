// Guards for the view's pose and camera (scene.js): one non-finite number (a sensor glitch, an impossible state such as
// Reverse reported while driving forward fast, a division by a zero dt) spreads through the integrated pose into every
// matrix, and the screen goes black for good. These keep the last good values instead and say when to rebuild.
// No DOM here, so Node tests it (tests/poseguard.test.js).

/** A motion input (m/s, rad/s, 1/m) or 0 when it isn't a finite number. */
export const finiteOr0 = (v) => (Number.isFinite(v) ? v : 0);

/** True when every component of the pose {x, y, h} is finite. */
export function poseFinite(p) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.h);
}

/**
 * Keeps `pose` usable: when it is finite, remembers it in `good` (a {x, y, h} the caller owns) and returns false; when
 * it isn't, puts the last good values back (or zeros, before there were any) and returns true, so the caller can ask
 * for a fresh base (e.g. re-take the worker's GPS pose on the next frame).
 */
export function restorePose(pose, good) {
  if (poseFinite(pose)) {
    good.x = pose.x; good.y = pose.y; good.h = pose.h; good.ok = true;
    return false;
  }
  pose.x = good.ok ? good.x : 0;
  pose.y = good.ok ? good.y : 0;
  pose.h = good.ok ? good.h : 0;
  return true;
}

/** True when a three.js-like vector {x, y, z} is finite. */
export function vecFinite(v) {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}
