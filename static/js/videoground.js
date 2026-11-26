// Camera on road (Display -> Road): the comma's live camera pixels on the 3D view's ground, under the drawn lanes and
// objects, so the road shows its real paint, patches and wet shine instead of only the stylised ground.
//
// - The video: the bridge's /video socket (sunnypilot webhud/video.py), decoded with WebCodecs. While the camera
//   window is open its frames are reused (roadcam.js onShown); otherwise this opens a stream of its own for the
//   camera(s) the setting asks for, only while the setting is on. Each new frame is copied into a canvas texture.
// - Live projection: a car-fixed plane ahead of the car whose shader takes each ground point to where it was at
//   capture (the car moved on since: the frame's age, from the device timestamp, and the scene's pose history), into
//   the calibrated camera frame, and through M (K . view_from_calib, from the bridge) into the picture. Nothing above
//   the horizon, behind the camera or off the frame; faded with distance and at the frame's edges. With both cameras,
//   the wide one near the car and the narrow one farther out.
// - Road memory: a ground-fixed square (MEM_SIZE_M) rendered to a texture: each new frame writes the sharp near part
//   of the picture into it at the ground points it shows, and older content fades, so the road under and behind the
//   car keeps the pixels the camera saw a moment ago. Its centre snaps to a grid (MEM_STEP_M) around the car; the
//   content is carried across in the same pass.
// - Objects: the ground a tracked car hides from the camera (the shadow of its box as the camera sees it) is left
//   out, so cars aren't smeared along the road.
// The geometry (and its tests) is in videoground_geom.js. Timing counters are in `stats` for perf.js / measurement.
import * as THREE from '../vendor/three.module.min.js';
import {
  MAX_OBJECTS, MEM_FAR_M, MEM_NEAR_M, MEM_SIZE_M, FAR_M, NEAR_M, arrivalAge, captureTransform, groundFit,
  matRows, memoryCenter, objectShadow, poseAt, applyTransform,
} from './videoground_geom.js';
import { CAMERAS, avcCodec, parseFrame } from './roadcam_geom.js';
import { modelXOffset } from './road.js';

const TEX_W = 640, TEX_H = 360;     // the video is copied at this size (the ground needs no more; cheap to upload)
const MEM_RES = 1024;               // road memory texels a side (6 cm each)
const MEM_LIFE_S = 6;               // memory content fades out over about this long without being seen again
const MEM_MIX = 0.6;                // how much each new frame replaces what the memory had at a point
const HISTORY_S = 2;                // the pose history kept, for the frames' capture poses
const STALE_S = 0.6, GONE_S = 2;    // no new frame for this long: the pixels start to fade, and are gone
const REAR_AXLE_DEFAULT = 3.84;     // m behind the bumper, until the car model reports its own (scene.js)
const JUMP_M = 20;                  // the car's ground position moving this far between updates: a re-base, memory cleared
// with both cameras: the wide one to WIDE_FAR_M (fading over the last 6 m), the narrow one from NARROW_NEAR_M
const WIDE_FAR_M = 26, NARROW_NEAR_M = 14;

const DEFAULT_DIMS = { w: 1.9, l: 4.6 };
// a running average for the timing counters; the first few samples (the shaders compiling) are left out
const WARMUP = 3;
const ema = (avg, v, n) => (n < WARMUP ? 0 : n === WARMUP ? v : avg + (v - avg) * 0.1);

// ---- shaders --------------------------------------------------------------------------------------------------
// One camera's contribution at a car-frame ground point: its colour, and its weight (0 = nothing usable there).
const SAMPLE_GLSL = `
uniform vec4 uCam;   // camera x ahead of the bumper (m), y left (m), height over the road (m), road rise per m
float rampUp(float a, float b, float v) { return clamp((v - a) / (b - a), 0.0, 1.0); }
vec4 sampleCam(sampler2D tex, mat3 M, vec4 S, vec4 T, vec4 objs[${MAX_OBJECTS}], int n, vec2 car, vec2 range) {
  if (S.z < 0.5) return vec4(0.0);
  // the ground point where it was in the car frame at capture
  vec2 c = vec2(T.x * car.x - T.y * car.y + T.z, T.y * car.x + T.x * car.y + T.w);
  float f = c.x - uCam.x, l = c.y - uCam.y;
  vec3 q = M * vec3(f, -l, uCam.z + uCam.w * f);
  if (q.z < 1e-3) return vec4(0.0);
  vec2 uv = q.xy / q.z / S.xy;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  // hidden by a tracked object: its box's shadow from the camera
  float a = atan(l, f), d = length(vec2(f, l));
  for (int i = 0; i < ${MAX_OBJECTS}; i++) {
    if (i >= n) break;
    vec4 o = objs[i];
    if (a >= o.x && a <= o.y && d >= o.z) return vec4(0.0);
  }
  float span = max(1.0, (range.y - range.x) * 0.25);
  float w = rampUp(range.x, range.x + min(3.0, span), f) * (1.0 - rampUp(range.y - span, range.y, f));
  w *= 1.0 - rampUp(10.0, 14.0, abs(car.y));
  float e = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  w *= rampUp(0.0, 0.04, e);
  return vec4(texture2D(tex, vec2(uv.x, 1.0 - uv.y)).rgb, w);
}
uniform sampler2D uTex0, uTex1;
uniform mat3 uM0, uM1;
uniform vec4 uS0, uS1;       // stream width, height (px), on (1/0), unused
uniform vec4 uT0, uT1;       // capture transform: c, s, tx, ty
uniform vec2 uR0, uR1;       // the distance range (m ahead of the camera) each camera covers
uniform vec4 uObj0[${MAX_OBJECTS}], uObj1[${MAX_OBJECTS}];
uniform int uN0, uN1;
vec4 sampleBoth(vec2 car, vec2 clampRange) {
  vec2 r0 = vec2(max(uR0.x, clampRange.x), min(uR0.y, clampRange.y));
  vec2 r1 = vec2(max(uR1.x, clampRange.x), min(uR1.y, clampRange.y));
  vec4 a = sampleCam(uTex0, uM0, uS0, uT0, uObj0, uN0, car, r0);
  vec4 b = sampleCam(uTex1, uM1, uS1, uT1, uObj1, uN1, car, r1);
  float w = a.a + b.a;
  if (w < 1e-4) return vec4(0.0);
  return vec4((a.rgb * a.a + b.rgb * b.a) / w, max(a.a, b.a));
}
`;

const LIVE_VERT = `
varying vec3 vScene;
void main() {
  vec4 p = modelMatrix * vec4(position, 1.0);
  vScene = p.xyz;
  gl_Position = projectionMatrix * viewMatrix * p;
}`;
const LIVE_FRAG = `
varying vec3 vScene;
uniform float uAlpha, uBright;
${SAMPLE_GLSL}
void main() {
  vec4 s = sampleBoth(vec2(-vScene.z, -vScene.x), vec2(0.0, 1000.0));
  float a = s.a * uAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(s.rgb * uBright, a);
}`;

const PASS_VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const MEM_FRAG = `
varying vec2 vUv;
uniform sampler2D uOld;
uniform vec2 uCenter, uOldCenter;
uniform float uSize, uDecay, uMix, uOldValid;
uniform mat4 uWorld;          // ground frame -> scene (the car's frame, in scene axes)
${SAMPLE_GLSL}
void main() {
  vec3 pw = vec3(uCenter.x + (vUv.x - 0.5) * uSize, 0.0, uCenter.y - (vUv.y - 0.5) * uSize);
  vec2 ou = vec2((pw.x - uOldCenter.x) / uSize + 0.5, -(pw.z - uOldCenter.y) / uSize + 0.5);
  vec4 old = vec4(0.0);
  if (uOldValid > 0.5 && ou.x >= 0.0 && ou.x <= 1.0 && ou.y >= 0.0 && ou.y <= 1.0) old = texture2D(uOld, ou);
  old.a *= uDecay;
  vec3 p = (uWorld * vec4(pw, 1.0)).xyz;
  vec4 s = sampleBoth(vec2(-p.z, -p.x), vec2(${MEM_NEAR_M.toFixed(1)}, ${MEM_FAR_M.toFixed(1)}));
  if (s.a > 0.02) {
    float k = old.a < 0.02 ? 1.0 : clamp(s.a * uMix, 0.0, 1.0);
    gl_FragColor = vec4(mix(old.rgb, s.rgb, k), max(old.a, s.a));
  } else {
    gl_FragColor = old;
  }
}`;

const SHOW_VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SHOW_FRAG = `
varying vec2 vUv;
uniform sampler2D uMem;
uniform float uAlpha, uBright;
void main() {
  vec4 m = texture2D(uMem, vUv);
  float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  float a = m.a * uAlpha * clamp(e / 0.1, 0.0, 1.0);
  if (a < 0.004) discard;
  gl_FragColor = vec4(m.rgb * uBright, a);
}`;

// ---- the video -------------------------------------------------------------------------------------------------

/** One camera's stream from the bridge, for when the camera window isn't open: the latest decoded frame. */
class GroundStream {
  constructor(camera, owner) {
    this.camera = camera;
    this.owner = owner;
    this.ws = null;
    this.decoder = null;
    this.configuring = false;
    this.needKey = true;
    this.retry = 0;
    this.stopped = false;
    this.capture = new Map();   // frameId -> capture time (device ms), until it's decoded
    this.connect();
  }

  connect() {
    if (this.stopped) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/video?camera=${this.camera}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.needKey = true;
    ws.onopen = () => { this.retry = 0; };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      if (typeof ev.data === 'string') {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        this.owner.onText(msg);
      } else this.onFrame(parseFrame(ev.data));
    };
    ws.onclose = () => {
      if (this.ws !== ws || this.stopped) return;
      this.ws = null;
      this.resetDecoder();
      this.timer = setTimeout(() => this.connect(), Math.min(10000, 500 * 2 ** this.retry++));
    };
    ws.onerror = () => ws.close();
  }

  onFrame(f) {
    if (!f || f.camera !== this.camera) return;
    if (this.needKey && !f.key) return;
    if (f.key && !this.decoder) {
      if (!this.configuring) { const codec = avcCodec(f.data); if (codec) this.makeDecoder(codec); }
      return;
    }
    if (!this.decoder || this.decoder.state !== 'configured') return;
    if (this.decoder.decodeQueueSize > 10 && !f.key) { this.needKey = true; return; }
    this.needKey = false;
    this.capture.set(f.frameId, f.tsNs / 1e6);
    if (this.capture.size > 60) this.capture.delete(this.capture.keys().next().value);
    try {
      this.decoder.decode(new EncodedVideoChunk({ type: f.key ? 'key' : 'delta', timestamp: f.frameId, data: f.data }));
    } catch { this.resetDecoder(); }
  }

  async makeDecoder(codec) {
    this.configuring = true;
    try {
      let config = null;
      for (const hw of ['prefer-hardware', 'no-preference']) {
        const c = { codec, optimizeForLatency: true, hardwareAcceleration: hw };
        if ((await VideoDecoder.isConfigSupported(c)).supported) { config = c; break; }
      }
      if (!config || this.stopped || this.decoder) return;
      const decoder = new VideoDecoder({
        output: (frame) => {
          if (decoder !== this.decoder || this.stopped) { frame.close(); return; }
          const cap = this.capture.get(frame.timestamp);
          this.owner.offer(this.camera, frame, performance.now(), cap);
        },
        error: () => this.resetDecoder(),
      });
      decoder.configure(config);
      this.decoder = decoder;
      this.needKey = true;
    } catch { /* this WebView can't decode it */ } finally { this.configuring = false; }
  }

  resetDecoder() {
    if (this.decoder) { try { this.decoder.close(); } catch { /* closed */ } }
    this.decoder = null;
    this.needKey = true;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null;
    if (ws) { try { ws.close(); } catch { /* gone */ } }
    this.resetDecoder();
  }
}

// ---- the view --------------------------------------------------------------------------------------------------

function sourceUniforms() {
  return {
    uTex: { value: null }, uM: { value: new THREE.Matrix3() }, uS: { value: new THREE.Vector4(1, 1, 0, 0) },
    uT: { value: new THREE.Vector4(1, 0, 0, 0) }, uR: { value: new THREE.Vector2(NEAR_M, FAR_M) },
    uObj: { value: Array.from({ length: MAX_OBJECTS }, () => new THREE.Vector4()) }, uN: { value: 0 },
  };
}

export class VideoGround {
  constructor(carScene, app) {
    this.cs = carScene;
    this.app = app;
    this.renderer = carScene.renderer;
    this.on = false;
    this.streams = new Map();     // camera -> GroundStream (own streams, while the camera window is closed)
    this.calib = null;            // the bridge's calib message
    this.model = null;            // its latest model message (the road's height and slope)
    this.track = {};              // arrivalAge's clock-offset tracker
    this.history = [];            // {t (ms), x, y, h}: the scene's pose, for the frames' capture poses
    this.src = {};                // camera -> {canvas, ctx, tex, pending, arrival, capture, used, fresh}
    for (const cam of CAMERAS) this.src[cam] = this._makeSource();
    this.stats = { on: false, cameras: '', framesUsed: 0, fps: 0, uploadMs: 0, memMs: 0, ageMs: 0, since: performance.now(), count: 0 };

    // two slots in every shader (0 and 1), filled with whichever cameras are in use
    this.slots = [sourceUniforms(), sourceUniforms()];
    const shared = {
      uCam: { value: new THREE.Vector4(-1.6, 0, 1.22, 0) },
      uTex0: this.slots[0].uTex, uM0: this.slots[0].uM, uS0: this.slots[0].uS, uT0: this.slots[0].uT, uR0: this.slots[0].uR, uObj0: this.slots[0].uObj, uN0: this.slots[0].uN,
      uTex1: this.slots[1].uTex, uM1: this.slots[1].uM, uS1: this.slots[1].uS, uT1: this.slots[1].uT, uR1: this.slots[1].uR, uObj1: this.slots[1].uObj, uN1: this.slots[1].uN,
    };
    this.shared = shared;

    // live: a car-fixed plane from just behind the bumper to FAR_M ahead, dense enough for the drum horizon to bend it
    const live = new THREE.PlaneGeometry(32, FAR_M + 4, 16, 48).rotateX(-Math.PI / 2);
    live.translate(0, 0, -(FAR_M + 4) / 2 + 2);
    this.liveMat = new THREE.ShaderMaterial({
      uniforms: { ...shared, uAlpha: { value: 0 }, uBright: { value: 1 } },
      vertexShader: LIVE_VERT, fragmentShader: LIVE_FRAG, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    });
    this.live = new THREE.Mesh(live, this.liveMat);
    this.live.position.y = -0.004;    // over the ground (-0.01), under the map's strips (-0.003) and lines
    this.live.renderOrder = -1;
    this.live.frustumCulled = false;
    this.live.visible = false;
    carScene.scene.add(this.live);

    // road memory: two render targets, each pass reads one and writes the other
    const rt = () => new THREE.WebGLRenderTarget(MEM_RES, MEM_RES, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false,
    });
    this.rts = [rt(), rt()];
    this.rtIdx = 0;
    this.memCenter = null;
    this.memValid = false;
    this.memMat = new THREE.ShaderMaterial({
      uniforms: {
        ...shared, uOld: { value: null }, uCenter: { value: new THREE.Vector2() }, uOldCenter: { value: new THREE.Vector2() },
        uSize: { value: MEM_SIZE_M }, uDecay: { value: 1 }, uMix: { value: MEM_MIX }, uOldValid: { value: 0 },
        uWorld: { value: new THREE.Matrix4() },
      },
      vertexShader: PASS_VERT, fragmentShader: MEM_FRAG, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    this.memMat.onBeforeCompile = () => {};   // a screen pass: not bent by the drum horizon (drum.js)
    this.passScene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.memMat);
    quad.frustumCulled = false;
    this.passScene.add(quad);
    this.passCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.showMat = new THREE.ShaderMaterial({
      uniforms: { uMem: { value: null }, uAlpha: { value: 0 }, uBright: { value: 1 } },
      vertexShader: SHOW_VERT, fragmentShader: SHOW_FRAG, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    this.memMesh = new THREE.Mesh(new THREE.PlaneGeometry(MEM_SIZE_M, MEM_SIZE_M, 16, 16).rotateX(-Math.PI / 2), this.showMat);
    this.memMesh.renderOrder = -2;
    this.memMesh.frustumCulled = false;
    this.memMesh.visible = false;
    carScene.world.add(this.memMesh);   // ground-fixed
  }

  _makeSource() {
    const canvas = document.createElement('canvas');
    canvas.width = TEX_W; canvas.height = TEX_H;
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;   // passed through as the stream's sRGB, like the camera window shows it
    return { canvas, ctx: canvas.getContext('2d', { alpha: false }), tex, pending: null, arrival: 0, capture: null, has: false, fresh: false };
  }

  // ---- inputs ------------------------------------------------------------------------------------------------

  /** A text message from the bridge's /video socket (own stream, or the camera window's via tap()). */
  onText(msg) {
    if (msg.type === 'calib') this.calib = msg;
    else if (msg.type === 'model') this.model = msg;
  }

  /** A decoded frame from an own stream: kept until the next update copies it (the previous one let go). */
  offer(camera, frame, arrival, capture) {
    const s = this.src[camera];
    if (!s || !this.on) { frame.close(); return; }
    if (s.pending) s.pending.frame.close();
    s.pending = { frame, arrival, capture };
  }

  /** The camera window's new frame (roadcam.js onShown): copied at once, as the window closes it when it's replaced. */
  tap(shown, calib, model) {
    if (!this.on || !shown) return;
    if (calib) this.calib = calib;
    if (model) this.model = model;
    this._copy(shown.camera, shown.frame, shown.at || performance.now(), null);
  }

  _copy(camera, frame, arrival, capture) {
    const s = this.src[camera];
    if (!s) return;
    const t0 = performance.now();
    try { s.ctx.drawImage(frame, 0, 0, TEX_W, TEX_H); } catch { return; }
    s.tex.needsUpdate = true;
    const dt = performance.now() - t0;
    this.stats.uploadMs = ema(this.stats.uploadMs, dt, this.stats.framesUsed);
    s.arrival = arrival;
    s.capture = capture;
    s.has = true;
    s.fresh = true;
    this.stats.framesUsed++;
    this.stats.count++;
  }

  // ---- every frame (scene.js frame, before the render) ---------------------------------------------------------

  update(dt) {
    const s = this.cs.settings || {};
    const on = s.camOnRoad === true && typeof VideoDecoder !== 'undefined';
    this.on = on;
    this.stats.on = on;
    if (!on) {
      if (this.streams.size) this._streamsFor([]);
      this.live.visible = this.memMesh.visible = false;
      this.memValid = false;
      for (const src of Object.values(this.src)) { if (src.pending) { src.pending.frame.close(); src.pending = null; } src.has = false; }
      return;
    }
    const now = performance.now();
    const want = s.camOnRoadSource === 'both' ? ['wide', 'road'] : s.camOnRoadSource === 'wide' ? ['wide'] : ['road'];
    const rc = this.app && this.app.roadcam;
    const tapping = !!(rc && rc.isOpen);
    if (rc) rc.onShown = tapping ? (shown, calib, model) => this.tap(shown, calib, model) : null;
    this._streamsFor(tapping ? [] : want);
    const cams = tapping ? [rc.camera] : want;
    this.stats.cameras = cams.join('+') + (tapping ? ' (window)' : '');

    for (const cam of cams) {
      const src = this.src[cam];
      if (src.pending) { const p = src.pending; src.pending = null; this._copy(cam, p.frame, p.arrival, p.capture); p.frame.close(); }
    }

    // the pose history, for where the car was when each frame was taken
    const pose = this.cs.pose;
    this.history.push({ t: now, x: pose.x, y: pose.y, h: pose.h });
    while (this.history.length > 2 && now - this.history[0].t > HISTORY_S * 1000) this.history.shift();

    // the camera and the road under it
    const fit = groundFit(this.model);
    const camX = modelXOffset(this.cs.state);
    this.shared.uCam.value.set(camX, 0, fit.h, fit.slope);
    const axle = this.cs.ego && this.cs.ego.userData && this.cs.ego.userData.rearAxleZ != null ? this.cs.ego.userData.rearAxleZ : REAR_AXLE_DEFAULT;
    const footprints = this._footprints();

    let fresh = 0, anyNew = false, ageSum = 0, n = 0;
    this.slots.forEach((slot, i) => {
      const cam = cams[i];
      const src = cam && this.src[cam];
      const cal = cam && this.calib && this.calib.cameras && this.calib.cameras[cam];
      const ok = !!(src && src.has && cal && cal.M && cal.width);
      slot.uS.value.set(ok ? cal.width : 1, ok ? cal.height : 1, ok ? 1 : 0, 0);
      if (!ok) { slot.uN.value = 0; return; }
      slot.uTex.value = src.tex;
      slot.uM.value.set(...matRows(cal.M));
      // the range this camera covers
      if (cams.length === 2) slot.uR.value.set(cam === 'wide' ? NEAR_M : NARROW_NEAR_M, cam === 'wide' ? WIDE_FAR_M : FAR_M);
      else slot.uR.value.set(NEAR_M, FAR_M);
      // how old the frame is now, and where the car was when it was taken
      const age = (src.capture != null ? arrivalAge(this.track, src.arrival, src.capture, now) : 0.1) + (now - src.arrival) / 1000;
      const capPose = poseAt(this.history, now - age * 1000);
      const T = captureTransform(pose, capPose, axle);
      slot.uT.value.set(T.c, T.s, T.tx, T.ty);
      // the objects' shadows, in the car frame at capture
      let k = 0;
      for (const o of footprints) {
        if (k >= MAX_OBJECTS) break;
        const [x, y] = applyTransform(T, o.x, o.y);
        const sh = objectShadow({ ...o, x, y, h: o.h + Math.atan2(T.s, T.c) }, { x: camX, y: 0 });
        if (sh) slot.uObj.value[k++].set(sh.a1, sh.a2, sh.near, 1);
      }
      slot.uN.value = k;
      const since = (now - src.arrival) / 1000;
      fresh = Math.max(fresh, 1 - Math.min(1, Math.max(0, (since - STALE_S) / (GONE_S - STALE_S))));
      if (src.fresh) { anyNew = true; src.fresh = false; }
      ageSum += age; n++;
    });
    if (n) this.stats.ageMs = Math.round(ageSum / n * 1000);

    const strength = Math.min(1, Math.max(0.1, Number(s.camOnRoadStrength ?? 0.85)));
    const bg = this.cs.scene.background;
    const bright = bg && (bg.r + bg.g + bg.b) / 3 < 0.3 ? 0.78 : 1.0;   // a little dimmer on the dark theme
    this.liveMat.uniforms.uAlpha.value = strength * fresh;
    this.liveMat.uniforms.uBright.value = bright;
    this.live.visible = n > 0 && fresh > 0;

    // road memory
    const memOn = s.camOnRoadMemory !== false;
    if (memOn && n > 0 && anyNew) this._memoryPass(pose);
    if (!memOn) this.memValid = false;
    this.memMesh.visible = memOn && this.memValid;
    this.showMat.uniforms.uAlpha.value = strength;
    this.showMat.uniforms.uBright.value = bright;

    if (now - this.stats.since >= 1000) {
      this.stats.fps = Math.round(this.stats.count * 1000 / (now - this.stats.since));
      this.stats.count = 0;
      this.stats.since = now;
    }
  }

  _memoryPass(pose) {
    const t0 = performance.now();
    const center = memoryCenter(pose);
    const g = [-pose.y, -pose.x];
    // a re-base (scene.js _rebase) or the first pass: nothing to carry over
    const jumped = !this.lastG || Math.hypot(g[0] - this.lastG[0], g[1] - this.lastG[1]) > JUMP_M;
    this.lastG = g;
    const u = this.memMat.uniforms;
    u.uOldValid.value = this.memValid && !jumped && this.memCenter ? 1 : 0;
    u.uOldCenter.value.set(...(this.memCenter || center));
    u.uCenter.value.set(...center);
    const dtS = this.lastMem ? (t0 - this.lastMem) / 1000 : 0;
    this.lastMem = t0;
    u.uDecay.value = Math.exp(-Math.min(1, dtS) / MEM_LIFE_S);
    this.cs.world.updateMatrixWorld();
    u.uWorld.value.copy(this.cs.world.matrixWorld);
    const read = this.rts[this.rtIdx], write = this.rts[1 - this.rtIdx];
    u.uOld.value = read.texture;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(write);
    this.renderer.render(this.passScene, this.passCam);
    this.renderer.setRenderTarget(prev);
    this.rtIdx = 1 - this.rtIdx;
    this.memCenter = center;
    this.memValid = true;
    this.showMat.uniforms.uMem.value = write.texture;
    this.memMesh.position.set(center[0], -0.006, center[1]);
    const dt = performance.now() - t0;
    this.memPasses = (this.memPasses || 0) + 1;
    this.stats.memMs = ema(this.stats.memMs, dt, this.memPasses - 1);
  }

  /** The drawn road users' footprints in the car frame now: {x, y, l, w, h}. */
  _footprints() {
    const out = [];
    const v = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const add = (pivot, dims, alpha) => {
      if (!pivot || !pivot.visible || (alpha != null && alpha < 0.2)) return;
      pivot.getWorldPosition(v);
      pivot.getWorldQuaternion(q);
      e.setFromQuaternion(q, 'YXZ');
      const d = dims || DEFAULT_DIMS;
      out.push({ x: -v.z, y: -v.x, l: d.l || DEFAULT_DIMS.l, w: d.w || DEFAULT_DIMS.w, h: e.y });
    };
    for (const o of this.cs.worldObjs.values()) add(o.pivot, o.dims, o.alpha);
    for (const o of this.cs.objects.values()) add(o.pivot, o.dims, o.alpha);
    for (const g of this.cs.radarObjs.values()) add(g.pivot, null, g.alpha);
    // nearest first: those are the ones that hide the most road
    out.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
    return out;
  }

  _streamsFor(cams) {
    for (const [cam, st] of this.streams) if (!cams.includes(cam)) { st.stop(); this.streams.delete(cam); }
    for (const cam of cams) if (!this.streams.has(cam)) this.streams.set(cam, new GroundStream(cam, this));
  }
}
