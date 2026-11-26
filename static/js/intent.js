// Planner intent drawn on the road (scene.js, Display -> Planner intent): what openpilot is about to do, from data
// already on the wire (sunnypilot webhud/extract.py): the lane change it's making, where it plans to stop, and which
// of the speed planner's sources is in charge. No DOM or three.js here, so Node tests it (tests/intent.test.js).
//
// Car frame throughout: x ahead of the front bumper, y left, metres (the frame modelV2.path comes in).

// sunnypilot's longitudinalPlanSP.source (cereal custom.capnp LongitudinalPlanSource) -> a short label. 'cruise' is the
// set speed itself: nothing to say.
const SOURCE_LABELS = {
  sccVision: 'Curve', sccMap: 'Curve ahead', speedLimitAssist: 'Speed limit', stopSign: 'Stop sign',
  narrowStreet: 'Narrow street', junctionTurn: 'Turn', driverSpeed: 'Your speed', speedBump: 'Speed bump',
  crosswalk: 'Crosswalk', wetRoad: 'Wet road', leadBrake: 'Slower car', redLight: 'Red light', modelStop: 'Stopping',
};

/** Which of the speed planner's sources is slowing the car, as a short label, or null (not in control of speed, or
 *  just cruising at the set speed). */
export function speedSourceLabel(op) {
  if (!op) return null;
  const long = !!(op.carControl && op.carControl.longActive);
  if (!long) return null;
  const src = op.longitudinalPlanSP && op.longitudinalPlanSP.source;
  return (src && SOURCE_LABELS[src]) || null;
}

/** The planned path's lateral offset at distance x ahead (linear between its points; null off its ends). */
export function pathAt(path, x) {
  if (!Array.isArray(path) || path.length < 2) return null;
  if (x < path[0][0] || x > path[path.length - 1][0]) return null;
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1], [x1, y1] = path[i];
    if (x <= x1) return x1 === x0 ? y1 : y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return path[path.length - 1][1];
}

const STOP_MIN_V = 0.3;        // m/s: already stopped, nothing to show
const STOP_BEHIND_LEAD = 4.0;  // m: openpilot stops about this far behind a stopped car
const STOP_DECEL_MIN = 0.8;    // m/s^2: braking estimate floor (a gentle stop)
const STOP_MAX_D = 80;         // m

/** Where the plan stops, m ahead of the bumper, or null. Stop Sign Assist's stop point when it's in charge; else, when
 *  the longitudinal plan says it should stop, behind a stopped lead or at the braking distance of the plan's own
 *  deceleration. */
export function stopPoint(op, vEgo) {
  if (!op || !(vEgo > STOP_MIN_V)) return null;
  const ss = op.longitudinalPlanSP && op.longitudinalPlanSP.stopSign;
  if (ss && ss.active && !ss.shadow && ss.distance > 0 && ss.distance < STOP_MAX_D) return ss.distance;
  const lp = op.longitudinalPlan;
  if (!lp || !lp.shouldStop) return null;
  const lead = op.radarState && op.radarState.leadOne;
  if (lead && lead.present && lead.dRel > 0 && lead.vLead != null && Math.abs(lead.vLead) < 1.0) {
    return Math.max(1.0, lead.dRel - STOP_BEHIND_LEAD);
  }
  const decel = Math.max(STOP_DECEL_MIN, -(lp.aTarget ?? 0));
  return Math.min(STOP_MAX_D, Math.max(2.0, vEgo * vEgo / (2 * decel)));
}

/** The lane change under way: {dir: 'left'|'right', strength} (0.45 while it waits for the driver's nudge, 1 once it
 *  moves), or null. */
export function laneChangeIntent(md) {
  if (!md) return null;
  const st = md.laneChangeState, dir = md.laneChangeDirection;
  if (dir !== 'left' && dir !== 'right') return null;
  if (st === 'preLaneChange') return { dir, strength: 0.45 };
  if (st === 'laneChangeStarting' || st === 'laneChangeFinishing') return { dir, strength: 1 };
  return null;
}

const CHEVRON_STATIONS = [7, 13, 19, 25];   // m ahead
const CHEVRON_SPACING = 6;

/** Chevrons along the path pointing toward the lane change: each a 3-point polyline (arm, tip, arm). `phase` (0..1)
 *  slides them forward so they flow; they stay within the path's reach. */
export function chevrons(path, dir, phase = 0) {
  const s = dir === 'left' ? 1 : -1, out = [];
  for (const x0 of CHEVRON_STATIONS) {
    const x = x0 + (phase % 1) * CHEVRON_SPACING;
    const y = pathAt(path, x);
    if (y === null) continue;
    out.push([[x + 0.8, y - s * 0.25], [x, y + s * 0.55], [x - 0.8, y - s * 0.25]]);
  }
  return out;
}

/** A bar across the path at distance d: a 2-point polyline halfWidth either side of it, square to its direction. */
export function barAcross(path, d, halfWidth = 1.6) {
  const y = pathAt(path, d);
  if (y === null) return null;
  const ya = pathAt(path, d - 1) ?? y, yb = pathAt(path, d + 1) ?? y;
  const tx = 2, ty = yb - ya, len = Math.hypot(tx, ty);
  const nx = -ty / len, ny = tx / len;   // left of the path's direction
  return [[d + nx * halfWidth, y + ny * halfWidth], [d - nx * halfWidth, y - ny * halfWidth]];
}
