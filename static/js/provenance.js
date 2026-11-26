// Provenance styling (scene.js, Display -> Show what's remembered): a world-model object a sensor is measuring now is
// drawn solid; one nothing has measured for a moment -- carried on by the tracker from memory -- fades to a ghost,
// faint and grey, so a car that has gone never stays solid on the road. Map-only geometry keeps its neutral style.
// No DOM here, so Node tests it (tests/provenance.test.js).

export const LIVE_S = 0.35;      // s since the last measurement still drawn fully solid (radar cycles are 65 ms)
export const GHOST_S = 0.85;     // s since the last measurement by which it is a full ghost (under the 1 s rule)
export const GHOST_ALPHA = 0.4;  // a ghost's opacity, as a fraction of what its confidence alone would give

/** Seconds since anything measured the object: the world model's `stale` as of its snapshot, plus the time the view
 *  has carried it on since (data seconds). */
export function staleness(o, sinceSnapshot = 0) {
  const s = Number.isFinite(o && o.stale) ? o.stale : 0;
  return Math.max(0, s) + Math.max(0, sinceSnapshot || 0);
}

/** 1 = measured now (solid) .. 0 = remembered only (ghost), linear between LIVE_S and GHOST_S. */
export function solidity(stale) {
  if (!(stale > LIVE_S)) return 1;
  if (stale >= GHOST_S) return 0;
  return 1 - (stale - LIVE_S) / (GHOST_S - LIVE_S);
}

/** 'live', 'fading' or 'remembered', for labels and tests. */
export function provenanceKind(stale) {
  const s = solidity(stale);
  return s >= 1 ? 'live' : s <= 0 ? 'remembered' : 'fading';
}

/** How to draw it: opacity (its confidence alpha scaled toward a ghost's) and how far toward grey its color goes. */
export function provenanceStyle(alpha, solid) {
  const k = Math.min(1, Math.max(0, solid));
  return { alpha: alpha * (GHOST_ALPHA + (1 - GHOST_ALPHA) * k), desat: 1 - k };
}
