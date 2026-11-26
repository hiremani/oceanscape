// Drive measurements (Settings > About > Drive measurements): what this screen can do and how it keeps up on a real
// drive, so one drive answers the Pulse-side unknowns of the Reality View plan (reports/Tesla Reality View
// equivalent feasibility.md, Phase 0). Once at start: the WebView, the GPU and its limits, WebGPU, and whether the
// camera's H.264 decodes in hardware. Then about once a second: the frame meter's numbers (perf.js), the camera
// window's video path (roadcam.js), memory, speed and how many objects are drawn, summed by measure_stats.js.
// Every minute one `[measure] {...}` line goes to the console (the Android app's WebView puts it in logcat), and the
// last few drives are kept in this browser's storage for the settings page to show and export.
// Cost: one small object a second, no work per frame.
import { store, save } from './util.js';
import { DriveStats, isNewDrive, boundDrives, describe } from './measure_stats.js';

const KEY = 'measureDrives';
const SAMPLE_MS = 1000;
const SAVE_EVERY_S = 60;
const DRIVES_KEPT = 5;
// the camera's stream is 1280x720 H.264 High profile at 20 fps (sunnypilot loggerd); these cover what its SPS says
const H264_CODECS = ['avc1.640028', 'avc1.64001f', 'avc1.4d401f', 'avc1.42e01f'];

export class Measurements {
  constructor(app) {
    this.app = app;
    this.caps = null;
    this.drives = store(KEY, []);
    if (!Array.isArray(this.drives)) this.drives = [];
    this.drive = null;
    this.lastStats = null;
    this.lastT = null;
    this.savedAt = 0;
    this.probe().then((c) => { this.caps = c; console.info('[measure] ' + JSON.stringify({ kind: 'caps', ...c })); })
      .catch((e) => { this.caps = { error: String(e) }; });
    setInterval(() => { try { this.tick(); } catch (e) { this.app.reportError?.(e); } }, SAMPLE_MS);
  }

  get enabled() { return this.app.settings.measure !== false; }

  // ---- once: what this screen is -----------------------------------------------------------------------------
  async probe() {
    const ua = navigator.userAgent || '';
    const caps = {
      at: new Date().toISOString(), userAgent: ua, chrome: (ua.match(/Chrome\/([\d.]+)/) || [])[1] || null,
      webview: /; wv\)/.test(ua), cores: navigator.hardwareConcurrency || null, memoryGB: navigator.deviceMemory || null,
      screen: { w: screen.width, h: screen.height, inner: [innerWidth, innerHeight], dpr: devicePixelRatio },
    };
    // the 3D view's own WebGL context (another context could be refused on a WebView that caps them)
    try {
      const r = this.app.scene.renderer, gl = r.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
      caps.webgl = {
        version: r.capabilities.isWebGL2 ? 2 : 1, glVersion: gl.getParameter(gl.VERSION), glsl: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE), maxAnisotropy: r.capabilities.getMaxAnisotropy(),
        precision: r.capabilities.precision, extensions: (gl.getSupportedExtensions() || []).length,
      };
    } catch (e) { caps.webgl = { error: String(e) }; }
    caps.webgpu = await webgpu();
    caps.video = await videoDecode(this.app.roadcam && this.app.roadcam.codec);
    return caps;
  }

  // ---- every second ---------------------------------------------------------------------------------------
  tick() {
    if (!this.enabled) return;
    const meter = this.app.meter;
    if (!meter) return;
    // the frame meter's last second (perf.js), or its last second with too few frames for that (under 10 fps, page
    // visible); neither new: the page is hidden or not drawing
    let st = meter.stats;
    if (!st || st === this.lastStats) st = meter.slowWindow && meter.slowWindow !== this.lastSlow ? meter.slowWindow : null;
    if (!st) return;
    if (st === meter.slowWindow) this.lastSlow = st; else this.lastStats = st;
    const t = Date.now() / 1000;
    if (!this.drive || isNewDrive(this.lastT, t)) this.startDrive(t);
    this.lastT = t;
    const done = this.drive.add(this.sample(st, t));
    if (done) console.info('[measure] ' + JSON.stringify({ kind: 'minute', drive: this.drive.id, source: this.app.source, ...done }));
    if (t - this.savedAt >= SAVE_EVERY_S) this.persist(t);
  }

  sample(st, t) {
    const app = this.app, scene = app.scene, m = app.roadcam && app.roadcam.measured;
    const cam = m && m !== this.lastCam ? m : null;   // each camera second once
    this.lastCam = m;
    const mem = performance.memory;
    return {
      t, fps: st.fps, median: st.median, worst: st.worst, work: st.work, calls: st.calls, tris: st.tris,
      scale: scene.renderScale, speed: app.vehicle ? app.vehicle.speed : 0, objects: drawnObjects(scene, app.settings),
      heapMB: mem ? mem.usedJSHeapSize / 1048576 : null, cam: cam || null,
    };
  }

  startDrive(t) {
    if (this.drive) this.persist(t);
    this.drive = new DriveStats(t);
  }

  persist(t) {
    this.savedAt = t;
    if (!this.drive) return;
    const rec = this.drive.record();
    const i = this.drives.findIndex(d => d.id === rec.id);
    if (i >= 0) this.drives[i] = rec; else this.drives.push(rec);
    this.drives = boundDrives(this.drives, DRIVES_KEPT);
    save(KEY, this.drives);
  }

  clear() {
    this.drives = [];
    this.drive = null;
    this.lastT = null;
    save(KEY, []);
  }

  /** Everything, for the export: the capabilities and the kept drives (the current one up to now). */
  export() {
    if (this.drive) this.persist(Date.now() / 1000);
    return { kind: 'oceanscape-measurements', version: 1, exported: new Date().toISOString(), caps: this.caps, drives: this.drives };
  }

  /** A line for the settings page: the current drive, else the last kept one. */
  summaryText() {
    const sm = this.drive ? this.drive.summary() : (this.drives.length ? this.drives[this.drives.length - 1].summary : null);
    return describe(sm);
  }
}

// objects drawn right now (world model, the car's own objects, radar ghosts), the view's load besides the road
function drawnObjects(scene, settings) {
  let n = 0;
  for (const m of [scene.worldObjs, scene.objects, settings.showRadar ? scene.radarObjs : null]) {
    if (!m) continue;
    for (const e of m.values()) if ((e.alpha ?? 1) > 0.05) n++;
  }
  return n;
}

async function webgpu() {
  if (!navigator.gpu) return { available: false };
  try {
    const a = await navigator.gpu.requestAdapter();
    if (!a) return { available: true, adapter: false };
    let info = a.info || null;
    if (!info && a.requestAdapterInfo) { try { info = await a.requestAdapterInfo(); } catch { info = null; } }
    return { available: true, adapter: true, vendor: info && info.vendor, architecture: info && info.architecture,
      device: info && info.device, description: info && info.description, features: a.features ? a.features.size : null,
      maxTexture: a.limits ? a.limits.maxTextureDimension2D : null, fallback: !!a.isFallbackAdapter };
  } catch (e) { return { available: true, error: String(e) }; }
}

// whether the camera's H.264 decodes, in hardware or software (WebCodecs), and whether the browser calls 720p20
// decoding power-efficient (MediaCapabilities' hint that it is hardware)
async function videoDecode(codecSeen) {
  const out = { webcodecs: typeof VideoDecoder !== 'undefined', codecSeen: codecSeen || null, codecs: {} };
  const list = codecSeen ? [codecSeen, ...H264_CODECS.filter(c => c !== codecSeen)] : H264_CODECS;
  if (out.webcodecs) {
    for (const codec of list) {
      const r = {};
      for (const hw of ['prefer-hardware', 'prefer-software']) {
        try { r[hw] = (await VideoDecoder.isConfigSupported({ codec, optimizeForLatency: true, hardwareAcceleration: hw })).supported; } catch { r[hw] = null; }
      }
      out.codecs[codec] = r;
    }
  }
  try {
    const mc = await navigator.mediaCapabilities.decodingInfo({ type: 'file',
      video: { contentType: `video/mp4; codecs="${list[0]}"`, width: 1280, height: 720, bitrate: 5e6, framerate: 20 } });
    out.mediaCapabilities = { supported: mc.supported, smooth: mc.smooth, powerEfficient: mc.powerEfficient };
  } catch { out.mediaCapabilities = null; }
  return out;
}

/** A short text of the capabilities for the settings page: [label, value] pairs. */
export function capsRows(c) {
  if (!c) return [['Screen', 'Checking…']];
  if (c.error) return [['Screen', `Couldn't check: ${c.error}`]];
  const g = c.webgl || {}, w = c.webgpu || {}, v = c.video || {};
  const hw = Object.entries(v.codecs || {}).find(([, r]) => r['prefer-hardware']);
  return [
    ['Browser', `${c.webview ? 'Android WebView' : 'Browser'} ${c.chrome || ''}`.trim()],
    ['GPU', g.renderer ? `${g.renderer} (${g.vendor})` : (g.error || 'unknown')],
    ['WebGL', g.version ? `WebGL ${g.version}, max texture ${g.maxTexture}` : '–'],
    ['WebGPU', !w.available ? 'not available' : w.adapter === false ? 'no adapter' : w.error ? w.error : `yes${w.vendor ? ` (${w.vendor}${w.architecture ? ' ' + w.architecture : ''})` : ''}`],
    ['H.264 decode', !v.webcodecs ? 'no WebCodecs' : hw ? `${hw[0]}, hardware offered` : 'software only'],
    ['720p20 decode', v.mediaCapabilities ? `${v.mediaCapabilities.supported ? 'supported' : 'unsupported'}${v.mediaCapabilities.powerEfficient ? ', power-efficient' : ''}${v.mediaCapabilities.smooth ? ', smooth' : ''}` : '–'],
    ['CPU / memory', `${c.cores || '?'} cores${c.memoryGB ? `, ${c.memoryGB} GB` : ''}`],
    ['Screen', `${c.screen.w}x${c.screen.h} at ${c.screen.dpr}x`],
  ];
}
