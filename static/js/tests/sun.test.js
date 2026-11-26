import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunPosition, isNight, sunLighting, sunDirection, NIGHT_BELOW, DAY_ABOVE } from '../sun.js';

const near = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} not within ${tol} of ${b}`);

test('London, June solstice, solar noon: about 62 deg up, due south', () => {
  // solar noon at Greenwich on 21 Jun is about 12:02 UTC; max elevation = 90 - 51.48 + 23.44
  const p = sunPosition(new Date(Date.UTC(2026, 5, 21, 12, 2)), 51.4779, -0.0015);
  near(p.elevation, 62.0, 0.3, 'elevation');
  near(p.azimuth, 180, 1.0, 'azimuth');
});

test('equator at the March equinox, solar noon: nearly overhead', () => {
  const p = sunPosition(new Date(Date.UTC(2026, 2, 20, 12, 7)), 0, 0);
  assert.ok(p.elevation > 88.5, `elevation ${p.elevation}`);
});

test('London at midnight in December: far below the horizon, to the north', () => {
  const p = sunPosition(new Date(Date.UTC(2026, 11, 21, 0, 0)), 51.5, -0.12);
  near(p.elevation, -61.5, 0.6, 'elevation');
  assert.ok(p.azimuth < 20 || p.azimuth > 340, `azimuth ${p.azimuth}`);
});

test('morning sun is in the east, evening sun in the west (San Francisco, September)', () => {
  // local 08:00 / 18:00 PDT = 15:00 / 01:00 UTC
  const am = sunPosition(new Date(Date.UTC(2026, 8, 15, 15, 0)), 37.77, -122.42);
  const pm = sunPosition(new Date(Date.UTC(2026, 8, 16, 1, 0)), 37.77, -122.42);
  assert.ok(am.azimuth > 70 && am.azimuth < 110, `am ${am.azimuth}`);
  assert.ok(pm.azimuth > 250 && pm.azimuth < 290, `pm ${pm.azimuth}`);
  assert.ok(am.elevation > 5 && am.elevation < 25 && pm.elevation > 5 && pm.elevation < 25);
});

test('sunset at Greenwich on the June solstice is about 20:21 UTC (BST 21:21)', () => {
  const before = sunPosition(new Date(Date.UTC(2026, 5, 21, 20, 13)), 51.4779, 0);
  const after = sunPosition(new Date(Date.UTC(2026, 5, 21, 20, 30)), 51.4779, 0);
  assert.ok(before.elevation > -0.833 && after.elevation < -0.833, `${before.elevation} ${after.elevation}`);
});

test('night with hysteresis', () => {
  assert.equal(isNight(-2, false), false);          // dusk: not yet
  assert.equal(isNight(NIGHT_BELOW - 0.1, false), true);
  assert.equal(isNight(-2, true), true);            // dawn: not yet day
  assert.equal(isNight(DAY_ABOVE + 0.1, true), false);
});

test('lighting: full rig by day, dimmer and warm at a low sun, angle kept usable', () => {
  const day = sunLighting(50), low = sunLighting(3), night = sunLighting(-20);
  assert.ok(Math.abs(day.sun - 1.6) < 1e-9 && Math.abs(day.hemi - 1.6) < 1e-9);
  assert.equal(day.color, 0xffffff);
  assert.ok(low.sun < day.sun && night.sun < low.sun);
  assert.ok((low.color & 0xff) < 0xff, 'low sun is warmer (less blue)');
  assert.equal(night.lightElevation, 22);
  assert.equal(sunLighting(85).lightElevation, 70);
});

test('sun direction in the scene frame', () => {
  const v = (a) => a.map(x => Math.round(x * 1000) / 1000);
  // heading east (h = 0), sun in the east at the horizon: straight ahead, i.e. scene -Z
  assert.deepEqual(v(sunDirection(90, 0, 0, 1)), [-0, 0, -1]);
  // heading east, sun in the north: on our left, scene -X
  assert.deepEqual(v(sunDirection(0, 0, 0, 1)), [-1, 0, -0]);
  // heading north (h = pi/2), sun in the south: behind us, scene +Z
  assert.deepEqual(v(sunDirection(180, 0, Math.PI / 2, 1)), [0, 0, 1]);
  // overhead
  assert.deepEqual(v(sunDirection(123, 90, 1, 1)).map(Math.abs), [0, 1, 0]);
});
