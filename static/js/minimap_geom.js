// The 2D map card's arithmetic (minimap.js), kept apart from the canvas so it can be tested: the heading-up view of
// the worker's roads layer (state.js _roadsLayer), in its frame of x east, y north in meters, heading counter-clockwise
// from east.

// The layer holds the ways within 320 m of where it was built, and is rebuilt once the car has moved 40 m. So the view
// may reach 280 m from the car and always have road to draw.
export const LAYER_SAFE_M = 280;
export const CAR_AT = 0.7;           // the car sits this far down the card: more of the road ahead than behind
const NEAR_HALF_M = 110, FAR_HALF_M = 160;   // half the card's width in meters, parked and at speed
const NEAR_V = 5, FAR_V = 25;        // m/s

/** Half the card's width in meters at this speed. At FAR_HALF_M a square card still fits within LAYER_SAFE_M. */
export function viewHalfMeters(speed) {
  const v = Math.abs(Number.isFinite(speed) ? speed : 0);
  const f = Math.min(1, Math.max(0, (v - NEAR_V) / (FAR_V - NEAR_V)));
  return NEAR_HALF_M + (FAR_HALF_M - NEAR_HALF_M) * f;
}

/** A heading-up projection for a square card of `size` px: project(x, y) gives [px, py], with the car at [size / 2, size * CAR_AT]. */
export function viewTransform(pose, size, halfMeters) {
  const c = Math.cos(pose.h), s = Math.sin(pose.h);
  const pxPerM = size / (2 * halfMeters);
  const cx = size / 2, cy = size * CAR_AT;
  return {
    pxPerM, cx, cy,
    project(x, y) {
      const dx = x - pose.x, dy = y - pose.y;
      const ahead = c * dx + s * dy, left = -s * dx + c * dy;
      return [cx - left * pxPerM, cy - ahead * pxPerM];
    },
    /** North on the card: radians clockwise from straight up. */
    northAngle: pose.h - Math.PI / 2,
  };
}

// [width in meters at the road, draw order: higher is on top]
const STYLES = {
  motorway: [15, 6], motorway_link: [8, 5], trunk: [13, 5], trunk_link: [7, 4], primary: [11, 4], primary_link: [6, 3],
  secondary: [9, 3], secondary_link: [5, 2], tertiary: [8, 2], tertiary_link: [5, 2], unclassified: [6, 1], residential: [6, 1], living_street: [5, 1],
};
const OTHER = [4, 0];

/** How wide to draw a way, in px, never thinner than a visible line, and its draw order. */
export function wayStyle(className, pxPerM) {
  const [m, order] = STYLES[className] || OTHER;
  return { width: Math.max(2, m * pxPerM), order };
}

/** The way's name to show: its street name, else its number. */
export function wayLabel(way) {
  return (way && (way.name || way.ref)) || '';
}

/** Where to write street names: one label per name, on its longest stretch in view, and clear of each other.
 *  ways: [{label, order, pts: [[px, py], ...]}] already on the card. Gives [{text, x, y, angle}], with angle never
 *  upside down. skip: a name not to write (the road the car is on, which the card already says). avoid: a point to keep
 *  clear (the car). */
export function placeLabels(ways, size, { margin = 12, minLenPx = 48, minGapPx = 44, max = 8, skip = '', avoid = null, avoidPx = 34 } = {}) {
  const best = new Map();
  for (const w of ways) {
    if (!w.label || w.label === skip) continue;
    for (let i = 0; i + 1 < w.pts.length; i++) {
      const [ax, ay] = w.pts[i], [bx, by] = w.pts[i + 1];
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      if (mx < margin || mx > size - margin || my < margin || my > size - margin) continue;
      if (avoid && Math.hypot(mx - avoid[0], my - avoid[1]) < avoidPx) continue;
      const len = Math.hypot(bx - ax, by - ay);
      if (len < minLenPx) continue;
      const had = best.get(w.label);
      if (!had || w.order > had.order || (w.order === had.order && len > had.len)) {
        let angle = Math.atan2(by - ay, bx - ax);
        if (angle > Math.PI / 2) angle -= Math.PI;
        else if (angle < -Math.PI / 2) angle += Math.PI;
        best.set(w.label, { text: w.label, x: mx, y: my, angle, len, order: w.order });
      }
    }
  }
  const out = [];
  const all = [...best.values()].sort((a, b) => b.order - a.order || b.len - a.len);
  for (const l of all) {
    if (out.length >= max) break;
    if (out.some(o => Math.hypot(o.x - l.x, o.y - l.y) < minGapPx)) continue;
    out.push({ text: l.text, x: l.x, y: l.y, angle: l.angle });
  }
  return out;
}

/** What the card should show for a snapshot: 'hidden' (no fix yet, or nothing to place the car on), 'loading' (the
 *  tile is on its way), or 'map', with stale set when the position is only dead reckoned from a lost GPS. */
export function mapView(state) {
  const pose = state && state.pose, map = state && state.map;
  if (!pose || !pose.origin || !map) return { mode: 'hidden', stale: false };
  const stale = pose.quality === 'stale' || pose.quality === 'none';
  if (!map.roads || !map.roads.ways) return { mode: map.loading ? 'loading' : 'hidden', stale };
  return { mode: 'map', stale };
}
