// The NPU detector, page side (Display -> Objects -> NPU detector; Reality View phase 3).
//
// The Android app runs a detector on the Pulse's NPU over the comma's road camera and serves what it finds at
// /npu on the page's own origin (LocalServer.kt; serve.py --npu-synth or --npu-relay on a PC). Protocol v1:
//   page -> app   {"cmd":"start","camera":"road"|"wide"}, {"cmd":"stop"}   (it runs only while a page has started it)
//   app -> page   {"v":1,"frameId","tsNs","camera","w","h","model","fps","ms":{decode,pre,npu,post,total},
//                  "dets":[{"k","s","b":[x1,y1,x2,y2]}]}                    one per inferred frame
//                 {"v":1,"status":{...}}                                     on connect and on change
//                 {"type":"calib",...} / {"type":"model",...}               the bridge's /video text messages, passed on
//   GET /npu/status   {"available","reason","runtime","model","running","fps","ms"}
//
// Each frame's boxes are placed on the road here (npu_geom.js) with the camera's calibration: from the messages the
// app passes on, else from the camera window or the camera-on-road stream if one is open, else from a /video socket
// of its own opened just long enough to read one (its picture ignored). Road users go to the world-model worker
// (world_model.js 'cam' source) with how old the frame is, which places them by the car's pose when it was taken;
// traffic lights and stop signs are kept here, matched to the map's where it has them (npu_signs.js draws the rest).
import { placeDetections, roadPlane, carToPose, poseToCar, matchMapSign, PROTOCOL } from './npu_geom.js';
import { arrivalAge, poseAt } from './videoground_geom.js';
import { modelXOffset } from './road.js';

const REAR_AXLE_DEFAULT = 3.84;   // m behind the bumper, until the car model reports its own (videoground.js)
const HISTORY_S = 3;              // the pose history kept, for where the car was when each frame was taken
const POSE_HZ = 20;
const STATUS_EVERY_S = 5;
const CALIB_WAIT_S = 3;           // no calibration from anywhere this long: read one from /video
const CALIB_REFRESH_S = 60;
const SIGN_SAME_M = 4;            // a sign placed within this of a kept one is the same sign
const SIGN_GONE_S = 1.5;
const SIGN_EASE = 0.3;

const nowMs = () => performance.now();

export class NpuDetector {
  constructor(app) {
    this.app = app;
    this.ws = null;
    this.retry = 0;
    this.started = false;
    this.calib = null;           // passed on by the app (its /video socket's)
    this.model = null;
    this.calibAt = -1e9;
    this.status = null;          // the app's last status (GET /npu/status or a status message)
    this.statusAt = -1e9;
    this.track = {};             // arrivalAge's clock-offset tracker
    this.history = [];           // {t (ms), x, y, h}
    this.signs = [];             // {k, wx, wy, z, conf, map (feature index or -1), seen (ms)}
    this.stats = { on: false, connected: false, running: false, fps: 0, ms: null, ageMs: 0, dets: 0, objects: 0, signs: 0,
      frames: 0, lastAt: 0, calib: 'none', model: '' };
    this.side = null;            // a /video socket opened only to read the calibration
    this.sideAt = -1e9;
    this.timer = setInterval(() => this.tick(), 1000 / POSE_HZ);
  }

  get wanted() {
    return this.app.settings && this.app.settings.npu === true && this.app.commaConnected;
  }

  // ---- every 50 ms: the pose history, connecting and disconnecting -------------------------------------------

  tick() {
    const now = nowMs();
    const scene = this.app.scene;
    const pose = scene && scene.pose;
    if (pose) {
      this.history.push({ t: now, x: pose.x, y: pose.y, h: pose.h });
      while (this.history.length > 2 && now - this.history[0].t > HISTORY_S * 1000) this.history.shift();
    }
    const want = this.wanted;
    this.stats.on = this.app.settings && this.app.settings.npu === true;
    if (want && !this.ws) this.connect();
    if (!want && this.ws) this.disconnect();
    if (want && now - this.statusAt > STATUS_EVERY_S * 1000) this.refreshStatus();
    if (want && this.started && !this.calibration() && now - this.sideAt > CALIB_WAIT_S * 1000) this.readCalib();
    if (want && this.calib && now - this.calibAt > CALIB_REFRESH_S * 1000 && !this.app.videoGround?.calib && now - this.sideAt > CALIB_REFRESH_S * 1000) this.readCalib();
    // signs not seen for a while go
    this.signs = this.signs.filter(s => now - s.seen < SIGN_GONE_S * 1000);
    this.stats.signs = this.signs.length;
    if (now - this.stats.lastAt > 2000) { this.stats.fps = 0; this.stats.running = false; }
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try { ws = new WebSocket(`${proto}://${location.host}/npu`); } catch { return; }
    this.ws = ws;
    this.started = false;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.retry = 0;
      this.stats.connected = true;
      const camera = this.app.settings.npuCamera === 'wide' ? 'wide' : 'road';
      try { ws.send(JSON.stringify({ cmd: 'start', camera })); this.started = true; } catch { /* closing */ }
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws || typeof ev.data !== 'string') return;
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      this.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.started = false;
      this.stats.connected = false;
      // back off, up to 30 s; tick() reconnects while it's wanted
      clearTimeout(this.backoff);
      const wait = Math.min(30000, 1000 * 2 ** this.retry++);
      this.ws = { closed: true };   // a placeholder so tick() doesn't reconnect at once
      this.backoff = setTimeout(() => { if (this.ws && this.ws.closed) this.ws = null; }, wait);
    };
    ws.onerror = () => { try { ws.close(); } catch { /* gone */ } };
  }

  disconnect() {
    const ws = this.ws;
    this.ws = null;
    clearTimeout(this.backoff);
    this.started = false;
    this.stats.connected = false;
    this.stats.running = false;
    if (ws && !ws.closed) {
      try { if (ws.readyState === 1) ws.send(JSON.stringify({ cmd: 'stop' })); } catch { /* closing */ }
      try { ws.close(); } catch { /* gone */ }
    }
    if (this.side) { try { this.side.close(); } catch { /* gone */ } this.side = null; }
    this.signs = [];
  }

  async refreshStatus() {
    this.statusAt = nowMs();
    try {
      const r = await fetch('/npu/status');
      if (!r.ok) { this.status = { available: false, reason: r.status === 404 ? 'This app has no NPU detector' : `HTTP ${r.status}` }; return; }
      this.status = await r.json();
    } catch (e) {
      this.status = { available: false, reason: 'No answer from the app' };
    }
  }

  /** The camera's calibration and the road model: the app's, else the camera window's or camera-on-road's. */
  calibration() {
    const vg = this.app.videoGround, rc = this.app.roadcam;
    const calib = this.calib || (vg && vg.calib) || (rc && rc.calib) || null;
    const model = this.model || (vg && vg.model) || (rc && rc.models && rc.models[rc.models.length - 1]) || null;
    this.stats.calib = this.calib ? 'app' : vg && vg.calib ? 'camera on road' : rc && rc.calib ? 'camera window' : 'none';
    return calib ? { calib, model } : null;
  }

  /** Open /video just long enough to read its calib message (the bridge sends it first), then close it. */
  readCalib() {
    this.sideAt = nowMs();
    if (this.side) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const camera = this.app.settings.npuCamera === 'wide' ? 'wide' : 'road';
    let ws;
    try { ws = new WebSocket(`${proto}://${location.host}/video?camera=${camera}`); } catch { return; }
    ws.binaryType = 'arraybuffer';
    this.side = ws;
    const done = () => { if (this.side === ws) this.side = null; try { ws.close(); } catch { /* gone */ } };
    const giveUp = setTimeout(done, 5000);
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'calib') { this.calib = msg; this.calibAt = nowMs(); }
      else if (msg.type === 'model') this.model = msg;
      if (this.calib && this.model) { clearTimeout(giveUp); done(); }
    };
    ws.onclose = () => { clearTimeout(giveUp); if (this.side === ws) this.side = null; };
    ws.onerror = () => done();
  }

  // ---- messages ---------------------------------------------------------------------------------------------

  onMessage(msg) {
    if (msg.type === 'calib') { this.calib = msg; this.calibAt = nowMs(); return; }
    if (msg.type === 'model') { this.model = msg; return; }
    if (msg.status) { this.status = msg.status; this.statusAt = nowMs(); }
    if (msg.v !== PROTOCOL || !Array.isArray(msg.dets)) return;
    this.onResult(msg, nowMs());
  }

  /** One inferred frame: placed, its road users sent to the world model, its signals kept. */
  onResult(msg, arrival) {
    const st = this.stats;
    st.frames++;
    st.lastAt = arrival;
    st.running = true;
    st.fps = Number(msg.fps) || st.fps;
    st.ms = msg.ms || null;
    st.model = msg.model || '';
    st.dets = msg.dets.length;
    const cm = this.calibration();
    const cal = cm && cm.calib.cameras && cm.calib.cameras[msg.camera || 'road'];
    if (!cal || !cal.M) { st.objects = 0; return; }
    // how old the frame is: its capture time against our clock (the smallest gap seen is the clock offset plus the
    // base latency)
    const age = Number.isFinite(msg.tsNs) ? arrivalAge(this.track, arrival, msg.tsNs / 1e6, arrival) : 0.15;
    st.ageMs = Math.round(age * 1000);
    const scene = this.app.scene;
    const cam = { x: modelXOffset(scene && scene.state) };
    const placed = placeDetections(msg, cal, cam, roadPlane(cm.model));
    st.objects = placed.objects.length;
    const w = this.app.worker;
    if (w) w.postMessage({ type: 'npu', ageS: age, dets: placed.objects });
    this._signs(placed.signs, arrival - age * 1000, cam);
  }

  _signs(signs, captureMs, cam) {
    if (!signs.length) return;
    const pose = poseAt(this.history, captureMs);
    if (!pose) return;
    const scene = this.app.scene;
    const axle = scene && scene.ego && scene.ego.userData && scene.ego.userData.rearAxleZ != null ? scene.ego.userData.rearAxleZ : REAR_AXLE_DEFAULT;
    const feats = (scene && scene.mapFeatures && scene.mapFeatures.layer && scene.mapFeatures.layer.features) || [];
    const now = nowMs();
    for (const s of signs) {
      const map = matchMapSign(s, feats, pose, axle, cam);
      const [wx, wy] = map >= 0 ? [feats[map].x, feats[map].y] : carToPose(pose, axle, s.x, s.y);
      const conf = map >= 0 ? Math.min(1, s.score) : s.conf;
      const kept = this.signs.find(k => k.k === s.k && Math.hypot(k.wx - wx, k.wy - wy) < SIGN_SAME_M);
      if (kept) {
        const e = map >= 0 ? 1 : SIGN_EASE;
        kept.wx += (wx - kept.wx) * e; kept.wy += (wy - kept.wy) * e; kept.z += (s.z - kept.z) * SIGN_EASE;
        kept.conf = Math.max(conf, kept.conf * 0.9); kept.map = map; kept.seen = now;
      } else {
        this.signs.push({ k: s.k, wx, wy, z: s.z, conf, map, seen: now });
      }
    }
  }

  /** The kept signals in the car frame now (for the stats and tests): [{k, x, y, z, conf, map}]. */
  signsNow() {
    const scene = this.app.scene;
    const pose = scene && scene.pose;
    if (!pose) return [];
    const axle = scene.ego && scene.ego.userData && scene.ego.userData.rearAxleZ != null ? scene.ego.userData.rearAxleZ : REAR_AXLE_DEFAULT;
    return this.signs.map(s => { const [x, y] = poseToCar(pose, axle, s.wx, s.wy); return { k: s.k, x, y, z: s.z, conf: s.conf, map: s.map }; });
  }
}
