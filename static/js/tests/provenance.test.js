import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_S, GHOST_S, GHOST_ALPHA, staleness, solidity, provenanceKind, provenanceStyle } from '../provenance.js';

test('staleness adds the time carried on since the snapshot', () => {
  assert.equal(staleness({ stale: 0.2 }, 0.1), 0.30000000000000004);
  assert.equal(staleness({ stale: null }, 0.5), 0.5);
  assert.equal(staleness({}, -1), 0);
  assert.equal(staleness(null), 0);
});

test('measured now is solid; remembered is a ghost; linear between', () => {
  assert.equal(solidity(0), 1);
  assert.equal(solidity(LIVE_S), 1);
  assert.equal(solidity(GHOST_S), 0);
  assert.equal(solidity(5), 0);
  assert.ok(Math.abs(solidity((LIVE_S + GHOST_S) / 2) - 0.5) < 1e-9);
  assert.equal(solidity(NaN), 1);   // no staleness known: as measured
});

test('nothing stays solid a second after its last measurement', () => {
  assert.ok(GHOST_S < 1.0);
  assert.equal(provenanceKind(1.0), 'remembered');
  assert.equal(provenanceKind(0.1), 'live');
  assert.equal(provenanceKind(0.6), 'fading');
});

test('style: a ghost keeps GHOST_ALPHA of its confidence alpha and goes grey', () => {
  assert.deepEqual(provenanceStyle(1, 1), { alpha: 1, desat: 0 });
  const g = provenanceStyle(0.8, 0);
  assert.ok(Math.abs(g.alpha - 0.8 * GHOST_ALPHA) < 1e-12);
  assert.equal(g.desat, 1);
  assert.deepEqual(provenanceStyle(1, 7), { alpha: 1, desat: 0 });   // clamped
});
