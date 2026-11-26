// The map's buildings (buildings.js) as geometry: OSM building footprints from an Overpass answer for one building
// cell (GET /map/buildings/<klat>/<klon>, BLD_DEG square, served by MapFeatures.kt on the car or serve.py on a PC),
// their heights from the tags, and the extruded walls and flat roofs of a whole cell merged into one set of arrays
// (one draw call per cell). No DOM and no three.js here, so it runs in buildingsworker.js and Node tests it.
//
// Coordinates: a footprint is in metres east / north of its cell's south-west corner (the same equirectangular
// projection as pose.js, about the cell's own latitude); the arrays come out in the view's world-group axes
// (X = -north, Y = up, Z = -east, like mapfeatures.js), still relative to the corner, so a cell's geometry doesn't
// depend on the pose frame's origin and the view only has to place the cell.
import earcut from './earcut.js';

export const BLD_DEG = 0.01;          // building cells: ~1.1 km north-south, ~0.7 km east-west at 51 deg
const DEG = Math.PI / 180;
const EARTH_R = 6378137.0;
export const LEVEL_M = 3.0;           // a storey
const MIN_H = 2.0, MAX_H = 300;
// heights where the map gives none, by building=* (m)
const DEFAULT_H = {
  house: 7, detached: 7, semidetached_house: 7, terrace: 7.5, residential: 8, bungalow: 4.5, cabin: 3.5, static_caravan: 3,
  apartments: 12, dormitory: 12, hotel: 15,
  garage: 3, garages: 3, shed: 2.6, hut: 3, carport: 3, roof: 4, kiosk: 3, toilets: 3, service: 3.5,
  commercial: 9, retail: 7, supermarket: 7, office: 12, industrial: 9, warehouse: 9, manufacture: 9, farm_auxiliary: 6, barn: 7,
  greenhouse: 3.5, school: 9, university: 12, college: 10, hospital: 15, church: 14, cathedral: 25, chapel: 8, mosque: 12,
  temple: 10, civic: 10, public: 10, government: 12, train_station: 10, transportation: 8, stadium: 20, grandstand: 10,
  parking: 9, sports_hall: 9,
};
export const DEFAULT_HEIGHT = 7;
const SKIP = new Set(['no', 'construction', 'ruins', 'collapsed', 'demolished', 'proposed', 'abandoned']);

/** A length tag in metres ("12", "12 m", "12.5m", "40'", "40 ft"), or null. */
export function parseLength(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase().replace(',', '.');
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet|')?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in))?$/);
  if (!m) return null;
  let x = Number(m[1]);
  if (m[2] === 'ft' || m[2] === 'feet' || m[2] === "'") x = x * 0.3048 + (m[3] ? Number(m[3]) * 0.0254 : 0);
  return Number.isFinite(x) ? x : null;
}

/** {height, minHeight} (m) from a building's tags: height / building:height, else building:levels storeys (plus
 *  roof:levels), else a default by building type; min_height / building:min_level lift a part off the ground. */
export function buildingHeight(tags = {}) {
  let h = parseLength(tags.height) ?? parseLength(tags['building:height']);
  if (h == null) {
    const lv = Number(tags['building:levels']);
    if (Number.isFinite(lv) && lv > 0) {
      const roof = Number(tags['roof:levels']);
      h = (lv + (Number.isFinite(roof) && roof > 0 ? roof * 0.5 : 0)) * LEVEL_M + 1;
    }
  }
  if (h == null) h = DEFAULT_H[tags.building] ?? DEFAULT_HEIGHT;
  let minH = parseLength(tags.min_height);
  if (minH == null) {
    const ml = Number(tags['building:min_level']);
    if (Number.isFinite(ml) && ml > 0) minH = ml * LEVEL_M;
  }
  if (minH == null && tags.building === 'roof') minH = Math.max(0, h - 1);   // a canopy: a slab on posts
  h = Math.min(MAX_H, Math.max(MIN_H, h));
  minH = Math.max(0, Math.min(h - 0.5, minH ?? 0));
  return { height: h, minHeight: minH };
}

/** Whether these tags are a building worth drawing (not a "building=no", a ruin, or one underground). */
export function isBuilding(tags) {
  if (!tags || !tags.building || SKIP.has(tags.building)) return false;
  if (tags.location === 'underground' || tags['building:location'] === 'underground') return false;
  const layer = Number(tags.layer);
  if (Number.isFinite(layer) && layer < 0 && !tags.height) return false;
  return true;
}

/** Signed area (m^2, positive counter-clockwise) of a ring [[x, y], ...] (closing point optional). */
export function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

function centroid(ring) {
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}

// join open outer member ways end to end into closed rings (OSM multipolygons split long outlines)
function stitch(lines) {
  const rings = [];
  const pool = lines.filter(l => l.length >= 2).map(l => l.slice());
  const same = (a, b) => a.lat === b.lat && a.lon === b.lon;
  while (pool.length) {
    let ring = pool.shift();
    let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const l = pool[i], end = ring[ring.length - 1];
        if (same(l[0], end)) ring = ring.concat(l.slice(1));
        else if (same(l[l.length - 1], end)) ring = ring.concat(l.slice(0, -1).reverse());
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4 && same(ring[0], ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

/** The buildings of one cell from an Overpass answer ({elements} with `out geom`): [{id, ring, height, minHeight,
 *  area}], ring counter-clockwise in metres east / north of the cell's south-west corner, without the closing point.
 *  A building is kept by the cell its outline's centre falls in, so one crossing a cell edge is drawn once. */
export function parseBuildings(answer, klat, klon) {
  const els = answer && Array.isArray(answer.elements) ? answer.elements : [];
  const lat0 = klat * BLD_DEG, lon0 = klon * BLD_DEG;
  const cosLat = Math.cos((lat0 + BLD_DEG / 2) * DEG);
  const toXY = (p) => [(p.lon - lon0) * DEG * EARTH_R * cosLat, (p.lat - lat0) * DEG * EARTH_R];
  const w = BLD_DEG * DEG * EARTH_R * cosLat, n = BLD_DEG * DEG * EARTH_R;
  const out = [];
  const add = (id, geom, tags) => {
    if (!geom || geom.length < 4) return;
    const ring = geom.map(toXY);
    const [fx, fy] = ring[0], [lx, ly] = ring[ring.length - 1];
    if (Math.abs(fx - lx) < 1e-6 && Math.abs(fy - ly) < 1e-6) ring.pop();
    if (ring.length < 3) return;
    let area = ringArea(ring);
    if (Math.abs(area) < 4) return;   // under 4 m^2: a slip of a polygon
    if (area < 0) { ring.reverse(); area = -area; }
    const [cx, cy] = centroid(ring);
    if (cx < 0 || cx >= w || cy < 0 || cy >= n) return;   // the neighbouring cell draws it
    out.push({ id, ring, area, ...buildingHeight(tags) });
  };
  for (const e of els) {
    if (!isBuilding(e.tags)) continue;
    if (e.type === 'way') add(e.id, e.geometry, e.tags);
    else if (e.type === 'relation' && Array.isArray(e.members)) {
      const outers = e.members.filter(m => m.type === 'way' && (m.role === 'outer' || m.role === '') && Array.isArray(m.geometry)).map(m => m.geometry);
      for (const ring of stitch(outers)) add(e.id, ring, e.tags);
    }
  }
  return out;
}

/** The ones big enough to draw at a distance: footprints of at least minArea m^2, or tall ones. */
export function lodFilter(buildings, minArea) {
  return buildings.filter(b => b.area >= minArea || b.height >= 15);
}

/** The building cells whose square comes within r metres of (lat, lon): [[klat, klon, distance m], ...], nearest first. */
export function cellsNear(lat, lon, r) {
  const mLat = DEG * EARTH_R, mLon = DEG * EARTH_R * Math.cos(lat * DEG);
  const k0 = Math.floor((lat - r / mLat) / BLD_DEG), k1 = Math.floor((lat + r / mLat) / BLD_DEG);
  const l0 = Math.floor((lon - r / mLon) / BLD_DEG), l1 = Math.floor((lon + r / mLon) / BLD_DEG);
  const out = [];
  for (let k = k0; k <= k1; k++) for (let l = l0; l <= l1; l++) {
    const d = cellDistance(lat, lon, k, l);
    if (d <= r) out.push([k, l, d]);
  }
  return out.sort((a, b) => a[2] - b[2]);
}

/** Metres from (lat, lon) to the nearest point of building cell (klat, klon) (0 inside it). */
export function cellDistance(lat, lon, klat, klon) {
  const mLat = DEG * EARTH_R, mLon = DEG * EARTH_R * Math.cos(lat * DEG);
  const s = klat * BLD_DEG, wst = klon * BLD_DEG;
  const dy = lat < s ? s - lat : lat > s + BLD_DEG ? lat - s - BLD_DEG : 0;
  const dx = lon < wst ? wst - lon : lon > wst + BLD_DEG ? lon - wst - BLD_DEG : 0;
  return Math.hypot(dx * mLon, dy * mLat);
}

/** Walls and flat roofs of these buildings merged: {position, normal, shade (per vertex, a grey to multiply the
 *  material's colour by: walls darker at the foot, roofs lightest), tris}, in world-group axes about the cell corner. */
export function extrude(buildings) {
  let nTri = 0;
  const roofs = [];
  for (const b of buildings) {
    const flat = [];
    for (const p of b.ring) flat.push(p[0], p[1]);
    const tri = earcut(flat, null, 2);
    roofs.push(tri);
    nTri += tri.length / 3 + b.ring.length * 2;
  }
  const position = new Float32Array(nTri * 9), normal = new Float32Array(nTri * 9), shade = new Float32Array(nTri * 3);
  let v = 0;
  // pose-like (east, north, up) -> world-group axes (X = -north, Y = up, Z = -east)
  const put = (e, n, u, nx, ny, nu, sh) => {
    const i = v * 3;
    position[i] = -n; position[i + 1] = u; position[i + 2] = -e;
    normal[i] = -ny; normal[i + 1] = nu; normal[i + 2] = -nx;
    shade[v++] = sh;
  };
  buildings.forEach((b, bi) => {
    const r = b.ring, top = b.height, bot = b.minHeight, cnt = r.length;
    const tri = roofs[bi];
    for (let i = 0; i < tri.length; i += 3) {
      // earcut keeps the ring's (counter-clockwise) winding; seen from above that faces up
      for (let k = 0; k < 3; k++) { const p = r[tri[i + k]]; put(p[0], p[1], top, 0, 0, 1, 1.0); }
    }
    for (let i = 0; i < cnt; i++) {
      const a = r[i], c = r[(i + 1) % cnt];
      let ex = c[0] - a[0], ey = c[1] - a[1];
      const len = Math.hypot(ex, ey) || 1;
      const nx = ey / len, ny = -ex / len;   // outward for a counter-clockwise ring
      const lo = 0.62, hi = 0.84;   // walls: darker than the roof, darkest at the foot
      put(a[0], a[1], bot, nx, ny, 0, lo); put(c[0], c[1], bot, nx, ny, 0, lo); put(c[0], c[1], top, nx, ny, 0, hi);
      put(a[0], a[1], bot, nx, ny, 0, lo); put(c[0], c[1], top, nx, ny, 0, hi); put(a[0], a[1], top, nx, ny, 0, hi);
    }
  });
  return { position, normal, shade, tris: nTri };
}

/** The Overpass query for a building cell: building ways and multipolygon relations, with their outlines. */
export function overpassQuery(klat, klon) {
  const s = (klat * BLD_DEG).toFixed(4), w = (klon * BLD_DEG).toFixed(4);
  const n = ((klat + 1) * BLD_DEG).toFixed(4), e = ((klon + 1) * BLD_DEG).toFixed(4);
  const bb = `${s},${w},${n},${e}`;
  return `[out:json][timeout:90];(way["building"](${bb});relation["building"]["type"="multipolygon"](${bb}););out tags geom qt;`;
}
