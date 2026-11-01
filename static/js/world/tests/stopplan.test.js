// Stop signs ahead (stopplan.js): which stop holds us, the slow-down plan, the band line, the log.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nextStop, plan, decelFor, stopLine, StopLog, STOP_MARGIN_M, STOP_LINE_BACK } from '../../stopplan.js';

const MPH = 0.44704;
// a stop sign 60 m ahead on our road (heading east), its crossing road 4 m half wide: the line is 5 m before the node
const stop = (x, extra = {}) => ({ id: 7, kind: 'stop', x, y: 0, arms: [{ h: 0, half: 5, cross: 4, oneWay: false, forward: true }], ...extra });
const pose = { x: 0, y: 0, h: 0 };

describe('nextStop', () => {
  test('the nearest stop line facing our way, on our road', () => {
    const s = nextStop([stop(60), stop(120, { id: 8 })], pose);
    assert.equal(s.id, 7);
    assert.ok(Math.abs(s.along - (60 - 4 - STOP_LINE_BACK)) < 1e-9);
    assert.equal(s.all, false);
  });
  test('a stop for the other direction, a side road, a stop behind us or too far: not ours', () => {
    assert.equal(nextStop([stop(60, { arms: [{ h: Math.PI, half: 5, cross: 4 }] })], pose), null);   // faces west
    assert.equal(nextStop([{ ...stop(60), y: 30 }], pose), null);                                    // 30 m to the left
    assert.equal(nextStop([stop(-10)], pose), null);
    assert.equal(nextStop([stop(400)], pose), null);
    assert.equal(nextStop([{ id: 1, kind: 'signal', x: 50, y: 0, arms: [{ h: 0, half: 5 }] }], pose), null);
  });
  test('all-way stops say so', () => { assert.equal(nextStop([stop(60, { all: true })], pose).all, true); });
});

describe('plan', () => {
  test('the braking distance comes from the speed: 25 mph at 1.5 m/s² is about 42 m, not 25 ft', () => {
    const v = 25 * MPH;
    const p = plan(150, v, 1.5);
    assert.equal(p.phase, 'ahead');
    assert.ok(p.brake > 40 && p.brake < 50, `brake ${p.brake}`);
    assert.ok(plan(7.6 + STOP_MARGIN_M, v, 1.5).needed > 7.5);   // from 25 ft it would take emergency braking
  });
  test('inside the braking distance the target speed falls to zero at the stop point', () => {
    const v = 25 * MPH;
    const p = plan(20, v, 1.5);
    assert.equal(p.phase, 'slowing');
    assert.ok(p.vTarget < v && p.vTarget > 0);
    assert.ok(Math.abs(p.vTarget - Math.sqrt(2 * 1.5 * (20 - STOP_MARGIN_M))) < 1e-9);
    assert.equal(plan(STOP_MARGIN_M + 0.3, 2, 1.5).phase, 'at');
    assert.equal(plan(5, 0.1, 1.5).phase, 'at');
    assert.equal(plan(-4, 3, 1.5).phase, 'passed');
  });
  test('the ACC gap sets the comfort: a short gap brakes late and firm', () => {
    assert.ok(decelFor(1) > decelFor(4));
    assert.equal(decelFor(undefined), 1.8);
    assert.ok(plan(100, 15, decelFor(1)).brake < plan(100, 15, decelFor(4)).brake);
  });
});

describe('stopLine', () => {
  test('says the distance in the display unit and that the car does not brake', () => {
    const s = { along: 60, all: false }, v = 11;
    assert.equal(stopLine(s, plan(60, v, 1.5), v, 'mph').t1, 'Stop in 195 ft');
    assert.equal(stopLine(s, plan(60, v, 1.5), v, 'kmh').t1, 'Stop in 60 m');
    const l = stopLine({ along: 20, all: true }, plan(20, v, 1.5), v, 'mph');
    assert.equal(l.cls, 'userPrompt');
    assert.match(l.t1, /^All-way stop in/);
    assert.match(l.t2, /does not brake/);
    assert.equal(stopLine(s, plan(-5, v, 1.5), v, 'mph'), null);
  });
});

describe('StopLog', () => {
  test('one record per stop passed: whether the car stopped and where', () => {
    const log = new StopLog();
    const st = (along) => ({ id: 7, along, all: false });
    let t = 0;
    for (let along = 80; along > 2; along -= 5) log.observe(st(along), Math.max(0, (along - 2) * 0.2), t += 0.5, 3);
    log.observe(st(1.5), 0.1, t += 0.5, 3);   // stopped half a metre before the stop point
    log.observe(st(-4), 2, t += 2, 3);        // and drove on
    assert.equal(log.records.length, 1);
    const r = log.records[0];
    assert.equal(r.stopped, true);
    assert.ok(Math.abs(r.atM - 0.5) < 1e-9);
    assert.equal(r.reason, 'passed');
    assert.equal(r.gap, 3);
    assert.equal(log.changed, true);
  });
  test('a rolled stop is logged as not stopped; a sign never approached is not logged', () => {
    const log = new StopLog();
    let t = 0;
    for (let along = 40; along >= -4; along -= 4) log.observe({ id: 9, along }, 4, t += 0.5);
    assert.equal(log.records[0].stopped, false);
    assert.equal(log.records[0].minKph, 14);
    log.observe({ id: 10, along: 150 }, 10, t += 1);
    log.observe(null, 10, t += 5);
    assert.equal(log.records.length, 1);
    // parked 12 m from a stop sign, then the match goes: never an approach
    log.observe({ id: 11, along: 12 }, 0, t += 1);
    log.observe({ id: 11, along: 12 }, 0, t += 30);
    log.observe(null, 0, t += 5);
    assert.equal(log.records.length, 1);
    assert.deepEqual(log.summary(), { n: 1, stopped: 0, medianAt: null, overshot: 0, rolled: 1, marks: 0, medianMark: null });
  });
  test('the driver\'s mark says where the real line was against the map\'s point', () => {
    const log = new StopLog();
    let t = 0;
    for (let along = 60; along > 4; along -= 4) log.observe({ id: 5, along, cross: 3.5, arms: 1 }, 6, t += 0.5);
    log.observe({ id: 5, along: 4, cross: 3.5, arms: 1 }, 0.1, t += 0.5);
    assert.equal(log.mark({ id: 5, along: 4 }), 3);        // stopped 3 m before the map's stop point: the map stops late
    assert.equal(log.mark({ id: 6, along: 4 }), null);     // another sign: not this approach
    log.observe({ id: 5, along: -4 }, 3, t += 2);
    const r = log.records[0];
    assert.equal(r.markM, 3);
    assert.equal(r.cross, 3.5);
    assert.deepEqual([log.summary().marks, log.summary().medianMark], [1, 3]);
  });
  test('the stop line offset moves the line along the road', () => {
    const base = nextStop([stop(60)], pose).along;
    assert.ok(Math.abs(nextStop([stop(60)], pose, undefined, 3).along - (base + 3)) < 1e-9);
    assert.ok(Math.abs(nextStop([stop(60)], pose, undefined, -2).along - (base - 2)) < 1e-9);
  });
  test('a match lost for under three seconds does not end the stop', () => {
    const log = new StopLog();
    log.observe({ id: 3, along: 10 }, 3, 0);
    log.observe(null, 2, 1);
    log.observe({ id: 3, along: 4 }, 1, 2);
    log.observe({ id: 3, along: -4 }, 1, 3);
    assert.equal(log.records.length, 1);
    assert.ok(log.records[0].atM < 4);
  });
});
