// Stop signs ahead: which one holds us, the slow-down a comfortable stop would take, and a log of where the map
// put the stop against where the car really stopped. Advisory only: nothing here commands the car, and the
// page never will (CLAUDE.md). The plan is what a stop assist on the comma would do, drawn so the driver and the
// log can judge the map before anything ever brakes.
//
// The stop sign comes from the worker's roads layer (state.js `_features`): a node with the directions of
// travel that arrive at it (`arms`), the crossing road's half width (`cross`, so the stop line is at its edge,
// mapfeatures.js) and our road's half width. Everything is in the pose frame, like the layer itself.
//
// Braking distance is v^2 / 2a, so the plan starts where the speed says, not at a fixed distance: at 25 mph a
// comfortable 1.5 m/s^2 needs 42 m (137 ft), a fixed 25 ft would need 8 m/s^2, emergency braking. The ACC time
// gap (1 shortest .. 4 longest) is the comfort knob, as it is for following: a short gap brakes late and firm.

export const STOP_LINE_BACK = 1.0;     // m before the crossing road's edge the stop line is (mapfeatures.js)
export const STOP_MARGIN_M = 1.0;      // the plan stops this far before the line
export const REACT_S = 0.6;            // the ramp starts this much travel time early, so it starts gently
export const STOP_LOOK_M = 200;        // a stop further ahead than this is not ours yet
export const STOP_FACE_RAD = 35 * Math.PI / 180;   // facing within this of our heading
export const STOPPED_MS = 0.3;         // slower than this counts as stopped
const PASSED_M = -3;                   // past the line by this much: it is behind us
const DECEL = { 1: 2.5, 2: 2.0, 3: 1.5, 4: 1.2 };   // m/s^2 by time gap
export const DECEL_DEFAULT = 1.8;
export const LOG_MAX = 300;

const wrap = (a) => (((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

/** The deceleration the plan uses for an ACC time gap (1..4), or the default when the car has not said. */
export function decelFor(gap) {
  return DECEL[gap] || DECEL_DEFAULT;
}

/** The stop line ahead that holds us: the nearest stop sign's arm that faces our way, on our road, within
 *  STOP_LOOK_M. features: the layer's (pose frame); pose: {x, y, h} (rear axle, pose frame).
 *  Returns {id, along, left, all, x, y, h, half, oneWay} with `along` the distance to the stop line, or null. */
export function nextStop(features, pose, look = STOP_LOOK_M) {
  if (!features || !pose) return null;
  const c = Math.cos(pose.h), s = Math.sin(pose.h);
  let best = null;
  for (const f of features) {
    if (f.kind !== 'stop' || !f.arms) continue;
    for (const a of f.arms) {
      if (Math.abs(wrap(a.h - pose.h)) > STOP_FACE_RAD) continue;
      const ux = Math.cos(a.h), uy = Math.sin(a.h);
      const at = -((a.cross || 0) + STOP_LINE_BACK);   // the line's station from the node, along the arrival
      const x = f.x + ux * at, y = f.y + uy * at;
      const dx = x - pose.x, dy = y - pose.y;
      const along = c * dx + s * dy, left = -s * dx + c * dy;
      if (along < PASSED_M || along > look || Math.abs(left) > (a.half || 3.6) + 2) continue;
      if (!best || along < best.along) best = { id: f.id, along, left, all: !!f.all, x, y, h: a.h, half: a.half || 3.6, oneWay: !!a.oneWay };
    }
  }
  return best;
}

/** What a comfortable stop from here looks like. along: m to the stop line; v: m/s; a: the deceleration.
 *  phase: 'ahead' (no braking yet), 'slowing' (inside the braking distance), 'at' (at the stop point), 'passed'. */
export function plan(along, v, a = DECEL_DEFAULT) {
  const s = along - STOP_MARGIN_M;                 // left to the stop point
  const brake = v * v / (2 * a) + v * REACT_S;     // from where the ramp starts
  let phase;
  if (along < PASSED_M) phase = 'passed';
  else if (s <= 0.5 || (v < STOPPED_MS && s < 8)) phase = 'at';
  else if (s <= brake) phase = 'slowing';
  else phase = 'ahead';
  const vTarget = phase === 'slowing' ? Math.min(v, Math.sqrt(2 * a * Math.max(0, s))) : phase === 'at' ? 0 : v;
  const needed = s > 0.5 ? v * v / (2 * s) : null;   // the deceleration a stop from here takes now
  return { s, brake, phase, vTarget, needed, a };
}

/** The band line for a stop: {cls, t1, t2}, or null when there is nothing to say yet. unit: 'mph' | 'kmh'. */
export function stopLine(stop, p, v, unit) {
  if (!stop || !p || p.phase === 'passed') return null;
  const mph = unit === 'mph';
  const dist = (m) => mph ? `${Math.round(m * 3.28084 / 5) * 5} ft` : `${Math.round(m / 5) * 5} m`;
  const spd = (ms) => mph ? `${Math.round(ms * 2.23694)} mph` : `${Math.round(ms * 3.6)} km/h`;
  const name = stop.all ? 'All-way stop' : 'Stop';
  if (p.phase === 'at') return { cls: 'userPrompt', t1: v < STOPPED_MS ? `${name}: stopped` : `${name}: stop now`, t2: 'Advisory: the car does not brake for this' };
  if (p.phase === 'slowing') return { cls: 'userPrompt', t1: `${name} in ${dist(stop.along)}`, t2: `Slow to ${spd(p.vTarget)} · ${p.a} m/s² · the car does not brake for this` };
  if (v < 1) return { cls: 'info', t1: `${name} in ${dist(stop.along)}`, t2: 'Advisory: the car does not brake for this' };
  return { cls: 'info', t1: `${name} in ${dist(stop.along)}`, t2: `Brake from ${dist(p.brake + STOP_MARGIN_M)} at ${p.a} m/s²` };
}

/** Where the car really stopped, against the map's stop line, one record per stop sign passed. The records
 *  say how far the map stops can be trusted before any stop assist exists: `atM` is where the slowest point
 *  was, in m before the stop point (negative: past it); `stopped` whether the car came to rest. */
export class StopLog {
  constructor(records = []) {
    this.records = Array.isArray(records) ? records.slice(-LOG_MAX) : [];
    this.cur = null;
    this.changed = false;   // a record was added since the last save
  }

  /** One observation: the stop ahead (nextStop) or null, the speed (m/s), the time (s) and the ACC gap. */
  observe(stop, v, t, gap) {
    const cur = this.cur;
    if (cur && (!stop || stop.id !== cur.id)) {
      if (!stop && t - cur.lastT < 3) return;   // a match lost for a moment: wait for it
      this._finish(stop ? 'next' : 'lost', t);
    }
    if (!stop) return;
    if (!this.cur) this.cur = { id: stop.id, all: stop.all, gap: gap || null, t0: t, firstM: stop.along, minV: v, minVAt: stop.along, closest: stop.along, lastT: t };
    const c = this.cur;
    c.lastT = t;
    if (v < c.minV || (v === c.minV && stop.along < c.minVAt)) { c.minV = v; c.minVAt = stop.along - STOP_MARGIN_M; }
    c.closest = Math.min(c.closest, stop.along);
    if (stop.along < PASSED_M) this._finish('passed', t);
  }

  _finish(reason, t) {
    const c = this.cur;
    this.cur = null;
    if (!c || c.closest > 15) return;   // never got near it: not a pass
    this.records.push({ id: c.id, t: Math.round(t), all: c.all, gap: c.gap, firstM: Math.round(c.firstM), stopped: c.minV < STOPPED_MS,
      minKph: Math.round(c.minV * 3.6), atM: Math.round(c.minVAt * 10) / 10, reason });
    if (this.records.length > LOG_MAX) this.records.splice(0, this.records.length - LOG_MAX);
    this.changed = true;
  }

  /** The log in numbers: passes, stops, where the stops happened (median m before the point), overshoots. */
  summary() {
    const r = this.records, stopped = r.filter(x => x.stopped);
    const ats = stopped.map(x => x.atM).sort((a, b) => a - b);
    const median = ats.length ? ats[ats.length >> 1] : null;
    return { n: r.length, stopped: stopped.length, medianAt: median, overshot: stopped.filter(x => x.atM < -1).length, rolled: r.length - stopped.length };
  }
}
