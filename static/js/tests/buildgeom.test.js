// node --test static/js/tests/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLD_DEG, parseLength, buildingHeight, isBuilding, ringArea, parseBuildings, lodFilter, cellsNear, cellDistance, extrude, overpassQuery }
  from '../buildgeom.js';

const DEG = Math.PI / 180, R = 6378137.0;
// a cell in Milton Keynes; a point dx m east, dy m north of its south-west corner
const KLAT = 5203, KLON = -76;
const cos = Math.cos((KLAT * BLD_DEG + BLD_DEG / 2) * DEG);
const at = (dx, dy) => ({ lat: KLAT * BLD_DEG + dy / (DEG * R), lon: KLON * BLD_DEG + dx / (DEG * R * cos) });
const square = (x, y, s, cw = false) => {
  const pts = [at(x, y), at(x + s, y), at(x + s, y + s), at(x, y + s)];
  if (cw) pts.reverse();
  return [...pts, pts[0]];
};

test('lengths: metres, units, feet, junk', () => {
  assert.equal(parseLength('12'), 12);
  assert.equal(parseLength('12.5 m'), 12.5);
  assert.equal(parseLength('7,5'), 7.5);
  assert.ok(Math.abs(parseLength("40'") - 12.192) < 1e-9);
  assert.ok(Math.abs(parseLength('10 ft') - 3.048) < 1e-9);
  assert.equal(parseLength('tall'), null);
  assert.equal(parseLength(undefined), null);
});

test('heights: tag, levels, type default, clamps, min height', () => {
  assert.deepEqual(buildingHeight({ building: 'yes', height: '20' }), { height: 20, minHeight: 0 });
  assert.equal(buildingHeight({ building: 'yes', 'building:height': '9 m' }).height, 9);
  assert.equal(buildingHeight({ building: 'yes', 'building:levels': '4' }).height, 13);   // 4 x 3 + 1
  assert.equal(buildingHeight({ building: 'yes', 'building:levels': '2', 'roof:levels': '1' }).height, 8.5);
  assert.equal(buildingHeight({ building: 'house' }).height, 7);
  assert.equal(buildingHeight({ building: 'garage' }).height, 3);
  assert.equal(buildingHeight({ building: 'spaceship' }).height, 7);
  assert.equal(buildingHeight({ building: 'yes', height: '0.5' }).height, 2);
  assert.equal(buildingHeight({ building: 'yes', height: '9000' }).height, 300);
  assert.deepEqual(buildingHeight({ building: 'yes', height: '12', min_height: '4' }), { height: 12, minHeight: 4 });
  assert.equal(buildingHeight({ building: 'yes', height: '12', 'building:min_level': '2' }).minHeight, 6);
  assert.equal(buildingHeight({ building: 'yes', height: '5', min_height: '9' }).minHeight, 4.5);   // never above the top
  assert.equal(buildingHeight({ building: 'roof' }).minHeight, 3);   // a canopy
});

test('which tags are buildings', () => {
  assert.ok(isBuilding({ building: 'yes' }));
  assert.ok(!isBuilding({ building: 'no' }));
  assert.ok(!isBuilding({ building: 'ruins' }));
  assert.ok(!isBuilding({ building: 'yes', location: 'underground' }));
  assert.ok(!isBuilding({ building: 'yes', layer: '-1' }));
  assert.ok(!isBuilding({ amenity: 'school' }));
  assert.ok(!isBuilding(undefined));
});

test('ring area sign', () => {
  assert.equal(ringArea([[0, 0], [10, 0], [10, 10], [0, 10]]), 100);
  assert.equal(ringArea([[0, 0], [0, 10], [10, 10], [10, 0]]), -100);
});

test('parse: way, metres from the corner, counter-clockwise, closing point dropped', () => {
  const b = parseBuildings({ elements: [{ type: 'way', id: 1, tags: { building: 'house' }, geometry: square(100, 200, 10, true) }] }, KLAT, KLON);
  assert.equal(b.length, 1);
  assert.equal(b[0].ring.length, 4);
  assert.ok(ringArea(b[0].ring) > 0, 'made counter-clockwise');
  assert.ok(Math.abs(b[0].area - 100) < 0.5, `area ${b[0].area}`);
  const xs = b[0].ring.map(p => p[0]), ys = b[0].ring.map(p => p[1]);
  assert.ok(Math.abs(Math.min(...xs) - 100) < 0.05 && Math.abs(Math.min(...ys) - 200) < 0.05);
  assert.equal(b[0].height, 7);
});

test('parse: skips non-buildings, slivers, and buildings centred in the next cell', () => {
  const els = [
    { type: 'way', id: 2, tags: { building: 'no' }, geometry: square(10, 10, 10) },
    { type: 'way', id: 3, tags: { building: 'yes' }, geometry: square(50, 50, 1.5) },      // 2.25 m^2
    { type: 'way', id: 4, tags: { building: 'yes' }, geometry: square(-20, 50, 15) },      // centre west of the cell
    { type: 'way', id: 5, tags: { building: 'yes' }, geometry: square(-5, 50, 15) },       // straddles, centre inside
    { type: 'node', id: 6, tags: { building: 'yes' } },
  ];
  assert.deepEqual(parseBuildings({ elements: els }, KLAT, KLON).map(b => b.id), [5]);
  assert.deepEqual(parseBuildings(null, KLAT, KLON), []);
});

test('parse: multipolygon outers stitched from open ways', () => {
  const [a, b, c, d] = square(300, 300, 20).slice(0, 4);
  const rel = { type: 'relation', id: 7, tags: { building: 'yes', 'building:levels': '3' },
    members: [{ type: 'way', role: 'outer', geometry: [a, b, c] }, { type: 'way', role: 'outer', geometry: [a, d, c] },
      { type: 'way', role: 'inner', geometry: square(305, 305, 5) }] };
  const out = parseBuildings({ elements: [rel] }, KLAT, KLON);
  assert.equal(out.length, 1);
  assert.ok(Math.abs(out[0].area - 400) < 1);
  assert.equal(out[0].height, 10);
});

test('LOD keeps big or tall ones', () => {
  const bs = [{ area: 50, height: 7 }, { area: 200, height: 7 }, { area: 30, height: 20 }];
  assert.deepEqual(lodFilter(bs, 120), [bs[1], bs[2]]);
});

test('cells near a point, nearest first, and distances', () => {
  const p = at(50, 50);   // 50 m inside the south-west corner
  assert.equal(cellDistance(p.lat, p.lon, KLAT, KLON), 0);
  const west = cellDistance(p.lat, p.lon, KLAT, KLON - 1);
  assert.ok(Math.abs(west - 50) < 0.5, `west ${west}`);
  const cells = cellsNear(p.lat, p.lon, 100);
  assert.deepEqual(cells[0].slice(0, 2), [KLAT, KLON]);
  const keys = cells.map(c => c[0] + ',' + c[1]).sort();
  assert.deepEqual(keys, [`${KLAT - 1},${KLON - 1}`, `${KLAT - 1},${KLON}`, `${KLAT},${KLON - 1}`, `${KLAT},${KLON}`].sort());
  for (let i = 1; i < cells.length; i++) assert.ok(cells[i][2] >= cells[i - 1][2]);
});

test('extrude: counts, roof up and lit, walls outward and darker at the foot, world axes', () => {
  const b = { ring: [[0, 0], [10, 0], [10, 20], [0, 20]], height: 9, minHeight: 0, area: 200 };
  const g = extrude([b]);
  assert.equal(g.tris, 2 + 8);
  assert.equal(g.position.length, g.tris * 9);
  assert.equal(g.shade.length, g.tris * 3);
  // roof: first 6 vertices, up normal, at the height, shade 1
  for (let v = 0; v < 6; v++) {
    assert.equal(g.position[v * 3 + 1], 9);
    assert.deepEqual([...g.normal.slice(v * 3, v * 3 + 3)].map(x => x + 0), [0, 1, 0]);
    assert.equal(g.shade[v], 1);
  }
  // roof triangles face up in world axes (X = -north, Y up, Z = -east): cross product's Y > 0
  const P = (v) => [g.position[v * 3], g.position[v * 3 + 1], g.position[v * 3 + 2]];
  const cross = (a, b, c) => { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; };
  assert.ok(cross(P(0), P(1), P(2))[1] > 0);
  // first wall: edge (0,0)->(10,0) runs east along the south side; outward is south: world +X (X = -north)
  const w0 = 6, n = [g.normal[w0 * 3], g.normal[w0 * 3 + 1], g.normal[w0 * 3 + 2]];
  assert.deepEqual(n.map(x => Math.round(x) + 0), [1, 0, 0]);
  const fc = cross(P(w0), P(w0 + 1), P(w0 + 2));
  assert.ok(fc[0] > 0, 'wall triangle faces outward');
  assert.ok(g.shade[w0] < g.shade[w0 + 2], 'foot darker than top');
  // east metres land on -Z, north on -X
  const xs = [], zs = [];
  for (let v = 0; v < g.tris * 3; v++) { xs.push(g.position[v * 3]); zs.push(g.position[v * 3 + 2]); }
  assert.deepEqual([Math.min(...xs), Math.max(...xs)].map(x => x + 0), [-20, 0]);
  assert.deepEqual([Math.min(...zs), Math.max(...zs)].map(x => x + 0), [-10, 0]);
});

test('extrude: nothing in, nothing out', () => {
  const g = extrude([]);
  assert.equal(g.tris, 0);
  assert.equal(g.position.length, 0);
});

test('Overpass query covers the cell', () => {
  const q = overpassQuery(KLAT, KLON);
  assert.match(q, /way\["building"\]\(52\.0300,-0\.7600,52\.0400,-0\.7500\)/);
  assert.match(q, /out tags geom qt;$/);
});
