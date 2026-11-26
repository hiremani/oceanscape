// node --test static/js/tests/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finiteOr0, poseFinite, restorePose, vecFinite } from '../poseguard.js';

test('motion inputs that are not numbers count as standing still', () => {
  assert.equal(finiteOr0(3.2), 3.2);
  assert.equal(finiteOr0(-1), -1);
  for (const v of [NaN, Infinity, -Infinity, undefined, null, '5']) assert.equal(finiteOr0(v), 0);
});

test('a finite pose is remembered; a broken one gets the last good values back', () => {
  const good = {};
  const p = { x: 10, y: -4, h: 0.5 };
  assert.equal(restorePose(p, good), false);
  assert.deepEqual([good.x, good.y, good.h], [10, -4, 0.5]);
  p.x = 11; p.h = NaN;
  assert.equal(restorePose(p, good), true);   // the caller is told to rebase
  assert.deepEqual([p.x, p.y, p.h], [10, -4, 0.5]);
  assert.ok(poseFinite(p));
});

test('before any good pose, a broken one starts over from zero', () => {
  const p = { x: NaN, y: 2, h: Infinity };
  assert.equal(restorePose(p, {}), true);
  assert.deepEqual([p.x, p.y, p.h], [0, 0, 0]);
});

test('vectors', () => {
  assert.ok(vecFinite({ x: 1, y: 2, z: 3 }));
  assert.ok(!vecFinite({ x: 1, y: NaN, z: 3 }));
  assert.ok(!vecFinite(null));
});
