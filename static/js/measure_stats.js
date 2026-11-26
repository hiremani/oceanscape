// Drive measurements, the arithmetic (measure.js records them): about one sample a second of what the screen manages
// (frame rate, frame time, draw calls, triangles, render resolution, the camera window's video path, memory), summed
// into fixed-size histograms so a drive of any length costs the same memory, and summarised per minute and per drive:
// p5 / p50 / p95, time under 30 fps, split by moving vs parked and by how many objects were drawn.
// These are the Pulse-side numbers the Reality View plan's Phase 0 needs (reports/Tesla Reality View equivalent
// feasibility.md, "Unmeasured unknowns"). No DOM here, so Node tests it (static/js/tests/measure_stats.test.js).

export const SLOW_FPS = 30;               // the plan's floor: time under it is counted
export const MOVING_MPS = 1.0;            // faster than this counts as moving
export const OBJECT_BUCKETS = [[0, 0, '0'], [1, 4, '1-4'], [5, 9, '5-9'], [10, Infinity, '10+']];
export const MINUTES_KEPT = 180;          // per-minute summaries kept per drive (3 h)

// histogram: values clamped into [0, top) in bins of `step`; a percentile reads back as its bin's middle (its lower
// edge for whole-number counts), kept within the smallest and largest value seen, so a bin never reports a value
// that didn't occur (a render scale of 1 read as 1.03). The mean and max are exact, whatever the bins.
class Hist {
  constructor(top, step, whole = false) {
    this.step = step;
    this.whole = whole;
    this.bins = new Uint32Array(Math.ceil(top / step));
    this.n = 0;
    this.sum = 0;
    this.max = -Infinity;
    this.min = Infinity;
  }

  add(v) {
    if (!Number.isFinite(v)) return;
    const i = Math.min(this.bins.length - 1, Math.max(0, Math.floor(v / this.step)));
    this.bins[i]++;
    this.n++;
    this.sum += v;
    if (v > this.max) this.max = v;
    if (v < this.min) this.min = v;
  }

  /** The value below which a share `p` (0..1) of the samples lie, or null when empty. */
  pct(p) {
    if (!this.n) return null;
    const want = Math.max(1, Math.ceil(p * this.n));
    let seen = 0, i = 0;
    for (; i < this.bins.length - 1; i++) {
      seen += this.bins[i];
      if (seen >= want) break;
    }
    const v = (i + (this.whole ? 0 : 0.5)) * this.step;
    return round(Math.min(this.max, Math.max(this.min, v)), 2);
  }

  summary() {
    if (!this.n) return null;
    return { p5: this.pct(0.05), p50: this.pct(0.5), p95: this.pct(0.95), mean: round(this.sum / this.n, 2), max: round(this.max, 2) };
  }
}

function round(v, d = 1) {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}

export function objectBucket(n) {
  const v = Number.isFinite(n) ? n : 0;
  return OBJECT_BUCKETS.find(([lo, hi]) => v >= lo && v <= hi)[2];
}

// the frame-rate side of a group of samples: fps and frame time, and the seconds spent under SLOW_FPS
class FrameGroup {
  constructor() {
    this.fps = new Hist(130, 1);
    this.frameMs = new Hist(1000, 0.5);
    this.seconds = 0;
    this.slowSeconds = 0;
  }

  add(s, dt) {
    this.fps.add(s.fps);
    if (s.median != null) this.frameMs.add(s.median);
    this.seconds += dt;
    if (s.fps < SLOW_FPS) this.slowSeconds += dt;
  }

  summary() {
    if (!this.fps.n) return null;
    return {
      samples: this.fps.n, seconds: round(this.seconds, 0), fps: this.fps.summary(), frameMs: this.frameMs.summary(),
      under30s: round(this.slowSeconds, 0), under30Pct: round(100 * this.slowSeconds / Math.max(this.seconds, 1e-9), 1),
    };
  }
}

// everything for one span (a minute, a drive)
class Span {
  constructor(start) {
    this.start = start;
    this.end = start;
    this.all = new FrameGroup();
    this.moving = new FrameGroup();
    this.parked = new FrameGroup();
    this.byObjects = Object.fromEntries(OBJECT_BUCKETS.map(([, , k]) => [k, new FrameGroup()]));
    this.work = new Hist(1000, 0.25);     // the HUD's own script time per frame (ms)
    this.worst = new Hist(1000, 1);       // the slowest frame of each second (ms)
    this.calls = new Hist(4000, 1, true);
    this.tris = new Hist(4e6, 5000);
    this.scale = new Hist(1.01, 0.05);    // render resolution, as a share of full
    this.heapMB = new Hist(4096, 4);
    this.objects = new Hist(100, 1, true);
    this.cam = { seconds: 0, rx: 0, decoded: 0, shown: 0, lost: 0, skipped: 0, queue: new Hist(64, 1, true),
      decodeMs: new Hist(500, 0.5), lagMs: new Hist(2000, 5) };
  }

  add(s, dt) {
    this.end = s.t;
    this.all.add(s, dt);
    (s.speed > MOVING_MPS ? this.moving : this.parked).add(s, dt);
    this.byObjects[objectBucket(s.objects)].add(s, dt);
    this.work.add(s.work);
    this.worst.add(s.worst);
    this.calls.add(s.calls);
    this.tris.add(s.tris);
    this.scale.add(s.scale);
    if (s.heapMB != null) this.heapMB.add(s.heapMB);
    this.objects.add(s.objects);
    const c = s.cam;
    if (c) {
      const k = this.cam;
      k.seconds += dt;
      k.rx += c.rx || 0;
      k.decoded += c.decoded || 0;
      k.shown += c.shown || 0;
      k.lost += c.lost || 0;
      k.skipped += c.skipped || 0;
      if (c.queue != null) k.queue.add(c.queue);
      if (c.decodeMs != null) k.decodeMs.add(c.decodeMs);
      if (c.lagMs != null) k.lagMs.add(c.lagMs);
    }
  }

  summary(detail = true) {
    const out = { start: this.start, end: this.end, ...this.all.summary() };
    if (!out.samples) return null;
    out.moving = this.moving.summary();
    out.parked = this.parked.summary();
    out.scale = this.scale.summary();
    out.calls = this.calls.summary();
    out.tris = this.tris.summary();
    out.objects = this.objects.summary();
    out.workMs = this.work.summary();
    out.worstMs = this.worst.summary();
    out.heapMB = this.heapMB.summary();
    const k = this.cam;
    if (k.seconds > 0) {
      const per = (n) => round(n / k.seconds, 1);
      out.cam = { seconds: round(k.seconds, 0), rxFps: per(k.rx), decodedFps: per(k.decoded), shownFps: per(k.shown),
        lostFps: per(k.lost), skippedFps: per(k.skipped), queue: k.queue.summary(), decodeMs: k.decodeMs.summary(), lagMs: k.lagMs.summary() };
    }
    if (detail) {
      out.byObjects = {};
      for (const [key, g] of Object.entries(this.byObjects)) {
        const sm = g.summary();
        if (sm) out.byObjects[key] = sm;
      }
    }
    return out;
  }
}

/**
 * One drive's measurements. add() about once a second with a sample:
 *   {t (s), fps, median (ms, or null in a second too slow for it), worst (ms), work (ms), calls, tris, scale, speed (m/s),
 *    objects, heapMB?,
 *    cam?: {rx, decoded, shown, lost, skipped (frames in the second), queue, decodeMs, lagMs}}
 * A sample after a gap counts for at most MAX_DT seconds, so a sleeping screen doesn't count as slow time.
 */
export const MAX_DT = 2;

export class DriveStats {
  constructor(start, id = null) {
    this.id = id || `d${Math.round(start)}`;
    this.drive = new Span(start);
    this.minute = new Span(start);
    this.minutes = [];          // finished per-minute summaries (no object split), oldest first
    this.lastT = null;
  }

  add(s) {
    if (!s || !Number.isFinite(s.t) || !Number.isFinite(s.fps)) return null;
    const dt = this.lastT == null ? 1 : Math.min(MAX_DT, Math.max(0, s.t - this.lastT));
    this.lastT = s.t;
    let done = null;
    if (s.t - this.minute.start >= 60) done = this.closeMinute(s.t);
    this.drive.add(s, dt);
    this.minute.add(s, dt);
    return done;   // the minute that just finished, if one did
  }

  /** Finish the current minute (if it has samples) and start the next at `t`; returns its summary or null. */
  closeMinute(t) {
    const sm = this.minute.summary(false);
    if (sm) {
      this.minutes.push(sm);
      if (this.minutes.length > MINUTES_KEPT) this.minutes.splice(0, this.minutes.length - MINUTES_KEPT);
    }
    this.minute = new Span(t);
    return sm;
  }

  summary() { return this.drive.summary(true); }

  /** What is stored and exported: the drive's summary and its minutes. */
  record() { return { id: this.id, start: this.drive.start, end: this.drive.end, summary: this.summary(), minutes: this.minutes.slice() }; }
}

/** Whether a sample at `t` (s) after the last one at `lastT` starts a new drive: the screen was off this long. */
export const NEW_DRIVE_GAP_S = 600;
export function isNewDrive(lastT, t) { return lastT != null && t - lastT > NEW_DRIVE_GAP_S; }

/** Keep the stored drives bounded: newest last, at most `max`, and the whole under `maxChars` of JSON
 *  (dropping the oldest minutes of the oldest drives first, then whole drives). */
export function boundDrives(drives, max = 5, maxChars = 400000) {
  let out = drives.slice(-max);
  const size = () => JSON.stringify(out).length;
  while (out.length && size() > maxChars) {
    const old = out.find(d => d.minutes && d.minutes.length > 10);
    if (old) old.minutes = old.minutes.slice(Math.floor(old.minutes.length / 2));
    else out = out.slice(1);
  }
  return out;
}

/** The camera path's extra latency: how much later than its best a frame arrives, from the comma's encode timestamp
 *  (its own clock, so only differences mean anything). Keep `best` as the smallest arrival - stamp seen so far. */
export function extraLatencyMs(arrivalMs, stampNs, best) {
  if (!Number.isFinite(arrivalMs) || !Number.isFinite(stampNs)) return { lag: null, best };
  const off = arrivalMs - stampNs / 1e6;
  const b = best == null || off < best ? off : best;
  return { lag: round(off - b, 1), best: b };
}

/** A short text of a summary for the settings page. */
export function describe(sm) {
  if (!sm) return 'No samples yet.';
  const f = sm.fps || {};
  const mins = Math.round((sm.seconds || 0) / 60);
  return `${mins} min · fps p5 ${f.p5} / p50 ${f.p50} / p95 ${f.p95} · under 30 fps ${sm.under30Pct}% of the time`;
}
