// The 2D map card's arithmetic (minimap_geom.js): heading-up projection, staying inside the roads layer, street name
// placement, and when the card shows.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CAR_AT, LAYER_SAFE_M, mapView, placeLabels, viewHalfMeters, viewTransform, wayLabel, wayStyle } from '../../minimap_geom.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

describe('viewTransform', () => {
  const size = 200, half = 100;   // 1 px per meter

  test('the car sits on the centerline, low on the card', () => {
    const [x, y] = viewTransform({ x: 50, y: -20, h: 1 }, size, half).project(50, -20);
    near(x, size / 2);
    near(y, size * CAR_AT);
  });

  test('heading east: what is east is up, what is north is left', () => {
    const t = viewTransform({ x: 0, y: 0, h: 0 }, size, half);
    const [ex, ey] = t.project(30, 0);
    near(ex, 100); near(ey, size * CAR_AT - 30);
    const [nx, ny] = t.project(0, 30);
    near(nx, 70); near(ny, size * CAR_AT);
  });

  test('heading north: what is north is up, what is east is right', () => {
    const t = viewTransform({ x: 0, y: 0, h: Math.PI / 2 }, size, half);
    const [nx, ny] = t.project(0, 30);
    near(nx, 100); near(ny, size * CAR_AT - 30);
    const [ex, ey] = t.project(30, 0);
    near(ex, 130); near(ey, size * CAR_AT);
  });

  test('the north arrow points up heading north, and left heading east', () => {
    near(viewTransform({ x: 0, y: 0, h: Math.PI / 2 }, size, half).northAngle, 0);
    near(viewTransform({ x: 0, y: 0, h: 0 }, size, half).northAngle, -Math.PI / 2);
  });
});

describe('viewHalfMeters', () => {
  test('zooms out with speed, and ignores direction and bad values', () => {
    assert.ok(viewHalfMeters(30) > viewHalfMeters(0));
    assert.equal(viewHalfMeters(-30), viewHalfMeters(30));
    assert.equal(viewHalfMeters(NaN), viewHalfMeters(0));
  });

  test('no corner of the card ever reaches past the road the layer holds', () => {
    for (const v of [0, 5, 15, 25, 60]) {
      const half = viewHalfMeters(v), width = 2 * half;
      const ahead = width * CAR_AT, behind = width * (1 - CAR_AT);
      assert.ok(Math.hypot(half, Math.max(ahead, behind)) <= LAYER_SAFE_M, `at ${v} m/s`);
    }
  });
});

describe('wayStyle and wayLabel', () => {
  test('bigger roads are wider and on top, and thin roads stay visible zoomed out', () => {
    assert.ok(wayStyle('motorway', 1).width > wayStyle('residential', 1).width);
    assert.ok(wayStyle('motorway', 1).order > wayStyle('residential', 1).order);
    assert.ok(wayStyle('residential', 0.01).width >= 2);
    assert.ok(wayStyle('some_new_class', 1).width > 0);
  });

  test('the name, else the number, else nothing', () => {
    assert.equal(wayLabel({ name: 'Mission Blvd', ref: 'CA 238' }), 'Mission Blvd');
    assert.equal(wayLabel({ name: '', ref: 'I 880' }), 'I 880');
    assert.equal(wayLabel({}), '');
    assert.equal(wayLabel(null), '');
  });
});

describe('placeLabels', () => {
  const road = (label, pts, order = 1) => ({ label, pts, order });

  test('one label per name, on its longest stretch', () => {
    const out = placeLabels([road('Main', [[10, 50], [70, 50], [190, 50]])], 200);
    assert.equal(out.length, 1);
    near(out[0].x, 130);
  });

  test('never upside down', () => {
    const [l] = placeLabels([road('Main', [[180, 100], [20, 100]])], 200);
    assert.ok(Math.abs(l.angle) <= Math.PI / 2);
  });

  test('skips the unnamed, the short and what is off the card', () => {
    assert.equal(placeLabels([road('', [[10, 50], [190, 50]])], 200).length, 0);
    assert.equal(placeLabels([road('Short', [[50, 50], [60, 50]])], 200).length, 0);
    assert.equal(placeLabels([road('Far', [[500, 50], [900, 50]])], 200).length, 0);
  });

  test('leaves out the road the car is on, and keeps clear of the car', () => {
    assert.equal(placeLabels([road('Main', [[10, 50], [190, 50]])], 200, { skip: 'Main' }).length, 0);
    assert.equal(placeLabels([road('Main', [[50, 100], [150, 100]])], 200, { avoid: [100, 100] }).length, 0);
    assert.equal(placeLabels([road('Main', [[50, 20], [150, 20]])], 200, { avoid: [100, 100] }).length, 1);
  });

  test('keeps labels apart, the bigger road winning', () => {
    const out = placeLabels([road('Small', [[20, 100], [180, 100]], 1), road('Big', [[20, 104], [180, 104]], 5)], 200);
    assert.deepEqual(out.map(l => l.text), ['Big']);
  });
});

describe('mapView', () => {
  const pose = { origin: { lat: 37, lon: -122, seq: 1 }, quality: 'gps', x: 0, y: 0, h: 0 };

  test('hidden until there is a fix and a map', () => {
    assert.equal(mapView(null).mode, 'hidden');
    assert.equal(mapView({ pose: null, map: {} }).mode, 'hidden');
    assert.equal(mapView({ pose: { ...pose, origin: null }, map: { roads: { ways: [] } } }).mode, 'hidden');
    assert.equal(mapView({ pose, map: null }).mode, 'hidden');
  });

  test('says so while the tile loads', () => {
    assert.equal(mapView({ pose, map: { loading: true } }).mode, 'loading');
  });

  test('shows the map, and flags a position that has lost the GPS', () => {
    const map = { roads: { ways: [] } };
    assert.deepEqual(mapView({ pose, map }), { mode: 'map', stale: false });
    assert.deepEqual(mapView({ pose: { ...pose, quality: 'dr' }, map }), { mode: 'map', stale: false });
    assert.deepEqual(mapView({ pose: { ...pose, quality: 'stale' }, map }), { mode: 'map', stale: true });
  });
});
