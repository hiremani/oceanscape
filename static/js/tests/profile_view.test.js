// node --test static/js/tests/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILE_FIELDS, fmtValue, profileState, provenance, profileRows, limitOffsets } from '../profile_view.js';

// what the comma's GET /api/profiles returns (sunnypilot webhud/server.py api_profiles_get)
const DEFAULTS = {
  town_offset_mph: 0, fast_offset_mph: 0, fast_zone_mph: 55, stop_decel: 1, coast_s: 2, launch_accel: 1,
  curve_lat_accel: 2, junction_turn_mph: 10, turn_exit_accel: 1, turn_stop_start_left_m: 0, turn_stop_start_right_m: 0,
  follow_gap_s: 1.45, narrow_speed_mph: 18, lead_coast_s: 0, limit_offsets_mph: {},
};
const ME = {
  name: 'me',
  values: { ...DEFAULTS, follow_gap_s: 1.8, town_offset_mph: -2.4, fast_offset_mph: 3, limit_offsets_mph: { 30: -1.5, 20: -3, 70: 2 } },
  meta: {
    generated: '2026-11-14T18:02:11', routes: ['a', 'b', 'c'], miles: 84.2,
    values: {
      follow_gap_s: { measured: 1.8, samples: 412, note: 'median time gap', used: 1.8 },
      lead_coast_s: { measured: null, samples: 3, note: 'median ...; too few samples (need 10): default', used: 0 },
    },
  },
};
const RESP = { enabled: true, speed: false, active: 'me', profiles: [ME, { name: 'relaxed', values: DEFAULTS, meta: {} }],
  defaults: DEFAULTS, editable: true };

test('an older comma server (no /api/profiles) is unsupported', () => {
  assert.equal(profileState(new Error('404 Not Found')).kind, 'unsupported');
  assert.equal(profileState({ error: 'not found' }).kind, 'unsupported');
  assert.equal(profileState({}).kind, 'unsupported');
  assert.equal(profileState(null).kind, 'unsupported');
});

test('a server whose params lack DriverProfile is unbuilt', () => {
  assert.equal(profileState({ ...RESP, enabled: null }).kind, 'unbuilt');
});

test('state: the switches, names and active profile', () => {
  const s = profileState(RESP);
  assert.equal(s.kind, 'ok');
  assert.equal(s.enabled, true);
  assert.equal(s.speed, false);
  assert.equal(s.editable, true);
  assert.deepEqual(s.names, ['me', 'relaxed']);
  assert.equal(s.active.name, 'me');
  assert.equal(s.activeMissing, false);
});

test('an active name with no file is flagged (the planner then uses the defaults)', () => {
  const s = profileState({ ...RESP, active: 'gone' });
  assert.equal(s.activeMissing, true);
  assert.equal(s.active, null);
});

test('moving: not editable', () => {
  assert.equal(profileState({ ...RESP, editable: false }).editable, false);
});

test('formatting: signed offsets with a real minus, units, dashes for missing', () => {
  assert.equal(fmtValue('town_offset_mph', -2.4, 'mph'), '−2.4 mph');
  assert.equal(fmtValue('fast_offset_mph', 3, 'mph'), '+3 mph');
  assert.equal(fmtValue('fast_offset_mph', 0, 'mph'), '0 mph');
  assert.equal(fmtValue('follow_gap_s', 1.45, 's'), '1.45 s');
  assert.equal(fmtValue('stop_decel', 1, 'm/s²'), '1.00 m/s²');
  assert.equal(fmtValue('junction_turn_mph', 10, 'mph'), '10 mph');
  assert.equal(fmtValue('follow_gap_s', null, 's'), '–');
  assert.equal(fmtValue('follow_gap_s', NaN, 's'), '–');
});

test('rows: every planner value once, in order, marked when it differs from the default', () => {
  const rows = profileRows(ME, DEFAULTS);
  assert.deepEqual(rows.map(r => r.key), PROFILE_FIELDS.map(f => f[0]));
  assert.ok(!rows.some(r => r.key === 'launch_accel'));   // drive_sim only
  const gap = rows.find(r => r.key === 'follow_gap_s');
  assert.equal(gap.text, '1.80 s');
  assert.equal(gap.defText, '1.45 s');
  assert.equal(gap.changed, true);
  assert.equal(gap.note, 'From 412 samples.');
  const coast = rows.find(r => r.key === 'lead_coast_s');
  assert.equal(coast.changed, false);
  assert.equal(coast.note, 'Not enough driving yet: the default.');
  assert.equal(rows.find(r => r.key === 'narrow_speed_mph').note, '');
});

test('rows: a value missing from the file shows the default', () => {
  const rows = profileRows({ name: 'x', values: { follow_gap_s: 2 } }, DEFAULTS);
  assert.equal(rows.find(r => r.key === 'stop_decel').text, '1.00 m/s²');
  assert.equal(rows.find(r => r.key === 'stop_decel').changed, false);
});

test('rows with no active profile are the defaults', () => {
  assert.ok(profileRows(null, DEFAULTS).every(r => !r.changed));
});

test('per-limit offsets sorted by limit', () => {
  assert.deepEqual(limitOffsets(ME), [{ limit: 20, text: '−3 mph' }, { limit: 30, text: '−1.5 mph' }, { limit: 70, text: '+2 mph' }]);
  assert.deepEqual(limitOffsets({ values: {} }), []);
  assert.deepEqual(limitOffsets(null), []);
});

test('provenance line', () => {
  const s = provenance(ME.meta);
  assert.match(s, /^Made .*2026 from 3 drives, 84.2 mi$/);
  assert.equal(provenance({ routes: ['a'] }), 'From 1 drive');
  assert.equal(provenance({}), '');
  assert.equal(provenance(null), '');
});
