// node --test static/js/tests/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DriveStats, objectBucket, isNewDrive, boundDrives, extraLatencyMs, describe, MAX_DT } from '../measure_stats.js';

const sample = (t, fps, extra = {}) => ({ t, fps, median: 1000 / fps, worst: 1000 / fps * 2, work: 2, calls: 120, tris: 200000,
  scale: 1, speed: 0, objects: 0, heapMB: 80, ...extra });

test('percentiles of fps and frame time over a drive', () => {
  const d = new DriveStats(0);
  for (let i = 0; i < 100; i++) d.add(sample(i, i < 10 ? 20 : 60));   // 10% of the seconds at 20 fps
  const s = d.summary();
  assert.equal(s.samples, 100);
  assert.equal(s.fps.p5, 20.5);    // bin [20, 21)
  assert.equal(s.fps.p50, 60);    // the bin's middle (60.5) is kept to the largest value seen
  assert.equal(s.fps.p95, 60);
  assert.equal(s.under30s, 10);
  assert.equal(s.under30Pct, 10);
  assert.ok(Math.abs(s.frameMs.p50 - 16.75) < 0.01);   // 16.67 ms in the [16.5, 17) bin
});

test('moving vs parked, and the object buckets', () => {
  const d = new DriveStats(0);
  for (let i = 0; i < 30; i++) d.add(sample(i, 55, { speed: 0, objects: 0 }));
  for (let i = 30; i < 50; i++) d.add(sample(i, 35, { speed: 12, objects: 7 }));
  const s = d.summary();
  assert.equal(s.parked.samples, 30);
  assert.equal(s.moving.samples, 20);
  assert.equal(s.moving.fps.p50, 35);
  assert.equal(s.byObjects['0'].samples, 30);
  assert.equal(s.byObjects['5-9'].samples, 20);
  assert.ok(!('1-4' in s.byObjects));
});

test('object buckets', () => {
  assert.equal(objectBucket(0), '0');
  assert.equal(objectBucket(3), '1-4');
  assert.equal(objectBucket(9), '5-9');
  assert.equal(objectBucket(40), '10+');
  assert.equal(objectBucket(undefined), '0');
});

test('a minute closes after 60 s and reports its own numbers', () => {
  const d = new DriveStats(0);
  let done = null;
  for (let i = 0; i <= 60; i++) done = d.add(sample(i, i < 60 ? 40 : 60)) || done;
  assert.ok(done);
  assert.equal(done.samples, 60);
  assert.equal(done.fps.p50, 40);
  assert.equal(d.minutes.length, 1);
  assert.ok(!('byObjects' in d.minutes[0]));   // minutes are kept small
});

test('a gap counts for at most MAX_DT seconds', () => {
  const d = new DriveStats(0);
  d.add(sample(0, 20));
  d.add(sample(500, 20));   // the screen slept
  assert.equal(d.summary().seconds, 1 + MAX_DT);
});

test('bad samples are ignored', () => {
  const d = new DriveStats(0);
  assert.equal(d.add(null), null);
  d.add({ t: 1, fps: NaN });
  assert.equal(d.summary(), null);
  assert.equal(describe(null), 'No samples yet.');
});

test('the camera path: frame rates per second, decode time, extra latency', () => {
  const d = new DriveStats(0);
  for (let i = 0; i < 10; i++) d.add(sample(i, 50, { cam: { rx: 20, decoded: 19, shown: 18, lost: 1, skipped: 1, queue: 1, decodeMs: 6, lagMs: 40 } }));
  d.add(sample(10, 50));   // window closed: no camera
  const c = d.summary().cam;
  assert.equal(c.seconds, 10);
  assert.equal(c.rxFps, 20);
  assert.equal(c.decodedFps, 19);
  assert.equal(c.lostFps, 1);
  assert.equal(c.decodeMs.p50, 6);
  assert.equal(c.lagMs.p50, 40);
});

test('extra latency is measured against the best arrival', () => {
  let r = extraLatencyMs(1000, 900e6, null);
  assert.equal(r.lag, 0);
  r = extraLatencyMs(1150, 1000e6, r.best);   // 50 ms later than the best offset
  assert.equal(r.lag, 50);
  r = extraLatencyMs(1170, 1100e6, r.best);   // a new best
  assert.equal(r.lag, 0);
  assert.equal(extraLatencyMs(NaN, 1, 5).lag, null);
});

test('a new drive after the screen was off 10 minutes', () => {
  assert.equal(isNewDrive(null, 100), false);
  assert.equal(isNewDrive(0, 300), false);
  assert.equal(isNewDrive(0, 601), true);
});

test('stored drives stay bounded', () => {
  const big = (id) => ({ id, minutes: Array.from({ length: 180 }, (_, i) => ({ i, pad: 'x'.repeat(200) })) });
  const out = boundDrives([big(1), big(2), big(3), big(4), big(5), big(6), big(7)], 5, 100000);
  assert.ok(out.length <= 5);
  assert.ok(JSON.stringify(out).length <= 100000);
  assert.equal(out[out.length - 1].id, 7);   // the newest is kept
});

test('the record carries the summary and the minutes', () => {
  const d = new DriveStats(1000, 'x');
  for (let i = 0; i < 130; i++) d.add(sample(1000 + i, 60));
  const r = JSON.parse(JSON.stringify(d.record()));
  assert.equal(r.id, 'x');
  assert.equal(r.minutes.length, 2);
  assert.equal(r.summary.samples, 130);
  assert.match(describe(r.summary), /^2 min · fps p5 60 /);
});

test('a percentile never reports a value that did not occur', () => {
  const d = new DriveStats(0);
  for (let i = 0; i < 20; i++) d.add(sample(i, 60, { scale: 1, objects: i < 10 ? 0 : 5, calls: 123 }));
  const s = d.summary();
  assert.equal(s.scale.p50, 1);       // not the bin's middle, 1.025
  assert.equal(s.objects.p5, 0);      // whole numbers: the bin's lower edge
  assert.equal(s.objects.p95, 5);
  assert.equal(s.calls.p50, 123);
});

test('long frames and slow script times are not cut off at the histogram top', () => {
  const d = new DriveStats(0);
  for (let i = 0; i < 20; i++) d.add(sample(i, 3, { work: 300, worst: 600 }));
  const s = d.summary();
  assert.equal(s.workMs.p95, 300);
  assert.equal(s.worstMs.p95, 600);
  assert.ok(Math.abs(s.frameMs.p50 - 333.33) < 0.5);
});

test('a second too slow for the meter\'s median still counts its frame rate', () => {
  const d = new DriveStats(0);
  for (let i = 0; i < 10; i++) d.add(sample(i, 5, { median: null }));
  const s = d.summary();
  assert.equal(s.samples, 10);
  assert.equal(s.under30Pct, 100);
  assert.equal(s.frameMs, null);
});

test('frame rate is split by which Reality View feature is drawing, with each feature\'s own cost', () => {
  const d = new DriveStats(0);
  for (let i = 0; i < 20; i++) d.add(sample(i, 50, { features: { buildings: false, camRoad: false } }));
  for (let i = 20; i < 30; i++) d.add(sample(i, 28, { features: { buildings: true, camRoad: false }, buildingTris: 100000 }));
  for (let i = 30; i < 35; i++) d.add(sample(i, 22, { features: { buildings: true, camRoad: true }, buildingTris: 100000,
    camRoad: { uploadMs: 0.4, ageMs: 130 } }));
  const s = d.summary();
  assert.equal(s.byFeature.buildings.on.samples, 15);
  assert.equal(s.byFeature.buildings.off.samples, 20);
  assert.equal(s.byFeature.camRoad.on.samples, 5);
  assert.ok(s.byFeature.buildings.on.fps.p50 < s.byFeature.buildings.off.fps.p50);
  assert.equal(s.byFeature.camRoad.on.under30Pct, 100);
  assert.ok(s.buildingTris.p50 >= 95000 && s.buildingTris.p50 <= 105000);
  assert.ok(s.camRoad.ageMs.p50 >= 125 && s.camRoad.ageMs.p50 <= 135);
});

test('samples without feature info count as everything off (older samples, features missing)', () => {
  const d = new DriveStats(0);
  for (let i = 0; i < 5; i++) d.add(sample(i, 40));
  const s = d.summary();
  assert.equal(s.byFeature.buildings.off.samples, 5);
  assert.equal(s.byFeature.buildings.on, null);
  assert.equal(s.buildingTris, undefined);
  assert.equal(s.camRoad, undefined);
});
