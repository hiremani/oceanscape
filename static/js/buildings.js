// The map's buildings around the car (Display -> Road -> Buildings): OSM footprints extruded to their height, a
// quiet matte block city under the scene's fog, in the view's map group so they take the same lane placement as the
// roads (scene.js _alignMap). The data is one building cell (buildgeom.js BLD_DEG) at a time from the page's server
// (GET /map/buildings/<klat>/<klon>: MapFeatures.kt on the car, serve.py on a PC; the comma's own server has none
// and the cells simply stay empty), fetched and built in buildingsworker.js, one cell in flight at a time.
//
// Budget (the Pulse's Mali GPU is the binding limit): one merged mesh and draw call per cell, cells drawn only within
// DRAW_R (the fog has swallowed everything past ~190 m anyway), the far version (big or tall buildings only) past
// NEAR_R, and a triangle cap that drops to the far versions and then hides the farthest cells. All of them go when
// the frame meter (perf.js) has had to take the resolution to its floor. stats() says what is drawn.
//
// Buildings mustn't hide the car or the road: a building between the camera and the car is screened away
// (dithered, so no transparency sorting) within OCC_R of the line of sight, and the city dissolves at the fog's end.
import * as THREE from '../vendor/three.module.min.js';
import { BLD_DEG, cellsNear, cellDistance } from './buildgeom.js';
import { drumShader } from './drum.js';

const DEG = Math.PI / 180;
const EARTH_R = 6378137.0;
const LOAD_R = 450;           // m: cells fetched within this of the car
const DRAW_R = 320;           // m: ...and drawn within this
const NEAR_R = 140;           // m: past this a cell draws its far version
const EVICT_R = 1500;         // m: cells farther than this are dropped
const MAX_TRIS = 300000;      // triangles for all buildings together
const FADE_FAR = [170, 230];  // m from the car: the city dissolves between these
const OCC_R = 7;              // m about the camera-to-car line where buildings are screened away
const RETRY_MS = 60000, MISSING_RETRY_MS = 600000;
const MANAGE_MS = 500;        // cells are picked this often
const SCALE_FLOOR = 0.6;      // perf.js's lowest automatic resolution

const VERT_HEAD = 'attribute float shade;\nvarying float vShade;\nvarying vec3 vBWorld;\n';
const FRAG_HEAD = `varying float vShade;
varying vec3 vBWorld;
uniform vec3 uCar;
uniform float uAlpha;
uniform vec2 uFadeFar;
uniform float uOccR;
float bldBayer(vec2 p) {
  const float B[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  ivec2 i = ivec2(mod(p, 4.0));
  return (B[i.x + i.y * 4] + 0.5) / 16.0;
}
`;
// screen-door fade: near the line of sight to the car, past the fog, and the layer's own fade in and out
const FRAG_FADE = `
  {
    float fade = uAlpha;
    vec3 ca = uCar - cameraPosition;
    float L = length(ca);
    vec3 dir = ca / max(L, 1e-3);
    vec3 cp = vBWorld - cameraPosition;
    float t = dot(cp, dir);
    if (t > 0.0 && t < L + 3.0) fade *= smoothstep(uOccR * 0.55, uOccR, length(cp - dir * t));
    fade *= 1.0 - smoothstep(uFadeFar.x, uFadeFar.y, length(vBWorld.xz - uCar.xz));
    if (fade < bldBayer(gl_FragCoord.xy)) discard;
  }
`;

export class Buildings {
  constructor(mapGroup) {
    this.group = new THREE.Group();
    this.group.name = 'buildings';
    mapGroup.add(this.group);
    this.uniforms = {
      uCar: { value: new THREE.Vector3() }, uAlpha: { value: 0 },
      uFadeFar: { value: new THREE.Vector2(FADE_FAR[0], FADE_FAR[1]) }, uOccR: { value: OCC_R },
    };
    this.material = new THREE.MeshLambertMaterial({ color: 0xd9dce1, fog: true });
    this.material.name = 'buildings';
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = VERT_HEAD + shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n  vShade = shade;\n  vBWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = FRAG_HEAD + shader.fragmentShader
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>' + FRAG_FADE)
        .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= vShade;');
      drumShader.call(this.material, shader);
    };
    this.cells = new Map();   // "klat,klon" -> {klat, klon, status, mesh, near, far, at, tris}
    this.queue = [];
    this.busy = null;         // key of the cell in flight
    this.managedAt = -1e9;
    this.origin = null;       // the pose frame's {lat, lon, cosLat, seq} the meshes are placed in
    this.shown = false;
    this.alpha = 0;
    this.drawn = { cells: 0, tris: 0, far: 0 };
    try {
      this.worker = new Worker(new URL('./buildingsworker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this._arrived(e.data);
      this.worker.onerror = () => { this.worker = null; };
    } catch (e) { this.worker = null; }
  }

  setTheme(t, dark) {
    // between the ground and the other road users: grey blocks that read against the pale fog by day, and slate ones,
    // darker than the cars, at night, so the cars stay what the eye goes to
    if (dark) this.material.color.set(t.ground).lerp(new THREE.Color(t.object), 0.4);
    else this.material.color.set(t.object).lerp(new THREE.Color(t.ground), 0.25);
  }

  /** What is drawn now: {cells, tris, far (cells drawn in their far version), loaded (cells with buildings)}. */
  stats() {
    let loaded = 0;
    for (const c of this.cells.values()) if (c.status === 'ok') loaded++;
    return { ...this.drawn, loaded, visible: this.group.visible };
  }

  /** Each frame. pose: the view's pose (pose frame, rear axle); origin: the worker's pose origin {lat, lon, seq} or null;
   *  show: the setting; renderScale/autoScale: perf.js's resolution and whether it's on auto; car: the car's middle in
   *  scene coordinates (the screening's target); dt in s. */
  update({ pose, origin, show, renderScale, autoScale, car, dt }) {
    const floor = autoScale && renderScale <= SCALE_FLOOR + 1e-3;
    const want = show && !!origin && !!this.worker && !floor;
    this.alpha = Math.max(0, Math.min(1, this.alpha + (want ? dt : -dt) / 0.6));
    this.uniforms.uAlpha.value = this.alpha;
    this.group.visible = this.alpha > 0.01;
    if (car) this.uniforms.uCar.value.copy(car);
    if (!origin || !show) return;
    if (!this.origin || this.origin.seq !== origin.seq || this.origin.lat !== origin.lat || this.origin.lon !== origin.lon) {
      this.origin = { lat: origin.lat, lon: origin.lon, cosLat: Math.cos(origin.lat * DEG), seq: origin.seq };
      for (const c of this.cells.values()) if (c.mesh) this._place(c);
    }
    const now = performance.now();
    if (now - this.managedAt < MANAGE_MS) return;
    this.managedAt = now;
    const o = this.origin;
    const lat = o.lat + pose.y / (DEG * EARTH_R), lon = o.lon + pose.x / (DEG * EARTH_R * o.cosLat);
    this._manage(lat, lon, now, floor || !want);
  }

  _manage(lat, lon, now, hidden) {
    // fetch: the cells within LOAD_R not yet had (nearest first), retrying failures after a while
    for (const [k, l] of cellsNear(lat, lon, LOAD_R)) {
      const key = k + ',' + l;
      let c = this.cells.get(key);
      if (!c) { c = { klat: k, klon: l, status: 'new', mesh: null, at: 0, tris: 0 }; this.cells.set(key, c); }
      const retry = c.status === 'failed' ? RETRY_MS : c.status === 'missing' ? MISSING_RETRY_MS : null;
      if (c.status === 'new' || (retry && now - c.at > retry)) { c.status = 'queued'; this.queue.push(key); }
    }
    this._next();
    // draw: nearest first under the triangle cap
    const list = [];
    for (const [key, c] of this.cells) {
      const d = cellDistance(lat, lon, c.klat, c.klon);
      if (d > EVICT_R && c.status !== 'loading') { this._drop(c); this.cells.delete(key); continue; }
      if (c.mesh) list.push([d, c]);
    }
    list.sort((a, b) => a[0] - b[0]);
    let tris = 0, cells = 0, far = 0;
    for (const [d, c] of list) {
      let lod = hidden || d > DRAW_R ? null : d > NEAR_R ? 'far' : 'near';
      if (lod === 'near' && tris + c.near.tris > MAX_TRIS) lod = 'far';
      if (lod === 'far' && tris + c.far.tris > MAX_TRIS) lod = null;
      if (lod && c[lod].tris === 0) lod = null;
      c.mesh.visible = !!lod;
      if (!lod) continue;
      if (c.lod !== lod) { c.mesh.geometry = c[lod].geom; c.lod = lod; }
      tris += c[lod].tris; cells++; if (lod === 'far') far++;
    }
    this.drawn = { cells, tris, far };
  }

  _next() {
    if (this.busy || !this.worker) return;
    while (this.queue.length) {
      const key = this.queue.shift(), c = this.cells.get(key);
      if (!c || c.status !== 'queued') continue;
      c.status = 'loading';
      this.busy = key;
      this.worker.postMessage({ key, klat: c.klat, klon: c.klon });
      return;
    }
  }

  _arrived(msg) {
    if (msg.key === this.busy) this.busy = null;
    const c = this.cells.get(msg.key);
    if (c) {
      c.at = performance.now();
      c.status = msg.status;
      if (msg.status === 'ok') {
        this._drop(c);
        c.near = this._geom(msg.near);
        c.far = this._geom(msg.far);
        c.count = msg.count;
        c.mesh = new THREE.Mesh(c.near.geom, this.material);
        c.lod = 'near';
        c.mesh.frustumCulled = true;
        c.mesh.matrixAutoUpdate = false;
        c.mesh.visible = false;   // _manage decides
        this.group.add(c.mesh);
        this._place(c);
        this.managedAt = -1e9;    // pick the cells again at the next frame
      }
    }
    this._next();
  }

  _geom(a) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
    g.setAttribute('shade', new THREE.BufferAttribute(a.shade, 1));
    g.computeBoundingSphere();
    return { geom: g, tris: a.tris };
  }

  // a cell's mesh at its south-west corner in the pose frame (world-group axes: X = -north, Z = -east), its east-west
  // metres scaled from its own latitude's to the frame origin's
  _place(c) {
    const o = this.origin;
    if (!o || !c.mesh) return;
    const lat0 = c.klat * BLD_DEG, lon0 = c.klon * BLD_DEG;
    const e = (lon0 - o.lon) * DEG * EARTH_R * o.cosLat, n = (lat0 - o.lat) * DEG * EARTH_R;
    const k = o.cosLat / Math.cos((lat0 + BLD_DEG / 2) * DEG);
    c.mesh.position.set(-n, 0, -e);
    c.mesh.scale.set(1, 1, k);
    c.mesh.updateMatrix();
  }

  _drop(c) {
    if (c.mesh) this.group.remove(c.mesh);
    for (const v of [c.near, c.far]) if (v && v.geom) v.geom.dispose();
    c.mesh = null; c.near = null; c.far = null; c.lod = null;
  }
}
