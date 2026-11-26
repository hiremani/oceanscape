import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speedSourceLabel, pathAt, stopPoint, laneChangeIntent, chevrons, barAcross } from '../intent.js';

const PATH = [[0, 0], [10, 0], [20, 1], [40, 3]];   // drifting left
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test('speed source: only while openpilot controls speed, and not plain cruise', () => {
  const op = (src, long = true) => ({ carControl: { longActive: long }, longitudinalPlanSP: { source: src } });
  assert.equal(speedSourceLabel(op('stopSign')), 'Stop sign');
  assert.equal(speedSourceLabel(op('driverSpeed')), 'Your speed');
  assert.equal(speedSourceLabel(op('wetRoad')), 'Wet road');
  assert.equal(speedSourceLabel(op('cruise')), null);
  assert.equal(speedSourceLabel(op('stopSign', false)), null);
  assert.equal(speedSourceLabel(op('someFutureSource')), null);
  assert.equal(speedSourceLabel({}), null);
  assert.equal(speedSourceLabel(null), null);
});

test('pathAt interpolates and is null off the ends', () => {
  near(pathAt(PATH, 15), 0.5);
  near(pathAt(PATH, 30), 2);
  assert.equal(pathAt(PATH, -1), null);
  assert.equal(pathAt(PATH, 41), null);
  assert.equal(pathAt([[0, 0]], 0), null);
});

test('stop point: Stop Sign Assist first, not its shadow copy', () => {
  const ss = (o) => ({ longitudinalPlanSP: { stopSign: { active: true, shadow: false, distance: 23.4, ...o } } });
  assert.equal(stopPoint(ss(), 10), 23.4);
  assert.equal(stopPoint(ss({ shadow: true }), 10), null);
  assert.equal(stopPoint(ss({ active: false }), 10), null);
  assert.equal(stopPoint(ss(), 0.1), null);   // already stopped
});

test('stop point: behind a stopped lead, else the plan\'s braking distance', () => {
  const lp = { shouldStop: true, aTarget: -2 };
  assert.equal(stopPoint({ longitudinalPlan: lp, radarState: { leadOne: { present: true, dRel: 20, vLead: 0.2 } } }, 8), 16);
  near(stopPoint({ longitudinalPlan: lp }, 10), 25);                                   // 10^2 / (2*2)
  near(stopPoint({ longitudinalPlan: { shouldStop: true, aTarget: 0 } }, 10), 62.5);   // the 0.8 m/s^2 floor
  assert.equal(stopPoint({ longitudinalPlan: { shouldStop: true, aTarget: -0.1 } }, 30), 80);   // capped
  assert.equal(stopPoint({ longitudinalPlan: { shouldStop: false } }, 10), null);
  // a moving lead isn't a stop point
  near(stopPoint({ longitudinalPlan: lp, radarState: { leadOne: { present: true, dRel: 20, vLead: 5 } } }, 10), 25);
});

test('lane change intent', () => {
  assert.deepEqual(laneChangeIntent({ laneChangeState: 'laneChangeStarting', laneChangeDirection: 'left' }), { dir: 'left', strength: 1 });
  assert.deepEqual(laneChangeIntent({ laneChangeState: 'preLaneChange', laneChangeDirection: 'right' }), { dir: 'right', strength: 0.45 });
  assert.equal(laneChangeIntent({ laneChangeState: 'off', laneChangeDirection: 'left' }), null);
  assert.equal(laneChangeIntent({ laneChangeState: 'laneChangeStarting', laneChangeDirection: 'none' }), null);
  assert.equal(laneChangeIntent(null), null);
});

test('chevrons point toward the change and sit on the path', () => {
  const left = chevrons(PATH, 'left');
  assert.equal(left.length, 4);
  for (const [a, tip, b] of left) {
    assert.ok(tip[1] > a[1] && tip[1] > b[1], 'left chevrons tip to the left (+y)');
    near(a[0] - tip[0], 0.8); near(tip[0] - b[0], 0.8);
  }
  const right = chevrons(PATH, 'right');
  for (const [a, tip, b] of right) assert.ok(tip[1] < a[1] && tip[1] < b[1]);
  // they flow forward and drop off past the path's end
  assert.ok(chevrons(PATH, 'left', 0.5)[0][1][0] > left[0][1][0]);
  assert.equal(chevrons([[0, 0], [10, 0]], 'left').length, 1);
});

test('bar across the path is square to it and centred on it', () => {
  const [a, b] = barAcross([[0, 0], [50, 0]], 20, 1.5);
  near(a[0], 20); near(b[0], 20); near(a[1], 1.5); near(b[1], -1.5);
  const [c, d] = barAcross(PATH, 30);
  near((c[1] + d[1]) / 2, 2);
  near(Math.hypot(c[0] - d[0], c[1] - d[1]), 3.2, 1e-9);
  assert.ok(c[0] < d[0], 'tilted with a path curving left');
  assert.equal(barAcross(PATH, 100), null);
});
