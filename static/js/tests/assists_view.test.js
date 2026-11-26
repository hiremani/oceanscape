// node --test static/js/tests/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASSIST_GROUPS, ASSIST_KEYS, assistGroups, describeAreaDownload } from '../assists_view.js';

test('only the switches this comma has show, with their values', () => {
  const g = assistGroups({ StopSignAssist: true, StopSignAssistShadow: false, WetRoadAssist: false, IsMetric: true });
  assert.deepEqual(g.map(x => x.title), ['Speed control assists', 'Rain']);
  const stop = g[0].items[0];
  assert.equal(stop.key, 'StopSignAssist');
  assert.equal(stop.on, true);
  assert.deepEqual(stop.subs.map(s => [s.key, s.on]), [['StopSignAssistShadow', false]]);
  assert.equal(g[0].items.length, 1);              // the rest of the group is absent on this comma
  assert.deepEqual(g[1].items[0].subs, []);        // no WetRoadForce on this comma
});

test('an older comma (none of the params) shows no assist sections', () => {
  assert.deepEqual(assistGroups({ ExperimentalMode: true }), []);
  assert.deepEqual(assistGroups(null), []);
});

test('a sub-option without its assist is dropped, and non-boolean values are ignored', () => {
  assert.deepEqual(assistGroups({ StopSignAssistShadow: true }), []);
  assert.deepEqual(assistGroups({ StopSignAssist: 1 }), []);
});

test('every switch writes only its own known param', () => {
  const all = ASSIST_GROUPS.flatMap(g => g.items.flatMap(it => [it.key, ...(it.subs || []).map(s => s.key)]));
  assert.equal(new Set(all).size, all.length);
  for (const k of ['SpeedBumpAssist', 'SpeedBumpAlert', 'SpeedBumpAssistShadow', 'TrafficSignalCoast', 'CrosswalkCaution',
    'WetRoadAssist', 'WetRoadForce', 'StopSignAssist', 'StopSignAssistShadow', 'NarrowStreetAssist', 'MapTurnAssist', 'LaneTurnDesire']) {
    assert.ok(ASSIST_KEYS.has(k), k);
  }
  assert.ok(!ASSIST_KEYS.has('ExperimentalMode'));
});

test('area download status line', () => {
  assert.equal(describeAreaDownload(null), '');
  assert.equal(describeAreaDownload({ center: null, cells: 0 }), '');
  assert.equal(describeAreaDownload({ center: [1, 2], radius_km: 3, cells: 120, ready: 30, busy: true, errors: 0 }), '30/120 areas within 3 km, downloading');
  assert.equal(describeAreaDownload({ center: [1, 2], radius_km: 3, cells: 120, ready: 120, busy: false, errors: 0 }), 'All 120 areas within 3 km downloaded');
  assert.equal(describeAreaDownload({ center: [1, 2], radius_km: 0.2, cells: 1, ready: 1, busy: false, errors: 0 }), 'The 1 area within 0.2 km downloaded');
  assert.equal(describeAreaDownload({ center: [1, 2], radius_km: 3, cells: 120, ready: 100, busy: false, errors: 2 }),
    '100/120 areas within 3 km, paused, 2 failed (Download again retries them)');
});
