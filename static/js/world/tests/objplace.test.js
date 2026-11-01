// Drawing world objects steadily (objplace.js): the placement by the reported face, the snapshot's pose, the glide.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { centerFromFace, glide, poseBefore } from '../../objplace.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const L = 4.8, W = 2.0;

describe('centerFromFace', () => {
  test('a car well ahead is half a length beyond its rear', () => {
    const [x, y] = centerFromFace(30, 0, 0, L, W);
    near(x, 30 + L / 2);
    near(y, 0);
  });

  test('a car behind us is half a length behind its front', () => {
    near(centerFromFace(-30, 0, 0, L, W)[0], -30 - L / 2);
  });

  test('a car straight beside us is half a width out from its side', () => {
    const [x, y] = centerFromFace(0, 3.6, 0, L, W);
    near(x, 0);
    near(y, 3.6 + W / 2);
    near(centerFromFace(0, -3.6, 0, L, W)[1], -3.6 - W / 2);
  });

  test('passing a car in the next lane moves its center smoothly', () => {
    let last = null, worst = 0;
    for (let x = 30; x >= -30; x -= 0.05) {
      const c = centerFromFace(x, 3.6, 0, L, W);
      if (last) worst = Math.max(worst, Math.hypot(c[0] - last[0], c[1] - last[1]));
      last = c;
    }
    // per 0.05 m of the car's travel; the old hard switch moved the center about 2.6 m in one step
    assert.ok(worst < 0.2, `largest step ${worst}`);
  });

  test('a car coming close dead ahead does not jump', () => {
    let last = null, worst = 0;
    for (let x = 5; x >= 0; x -= 0.01) {
      const c = centerFromFace(x, 0, 0, L, W);
      if (last) worst = Math.max(worst, Math.hypot(c[0] - last[0], c[1] - last[1]));
      last = c;
    }
    assert.ok(worst < 0.1, `largest step ${worst}`);
  });
});

describe('poseBefore', () => {
  test('goes back along the heading', () => {
    const p = poseBefore({ x: 10, y: 5, h: 0 }, 20, 0, 0.05);
    near(p.x, 9);
    near(p.y, 5);
    near(p.h, 0);
  });

  test('takes the turn back out', () => {
    near(poseBefore({ x: 0, y: 0, h: 1 }, 0, 0.5, 0.1).h, 0.95);
  });

  test('no age, no change', () => {
    assert.deepEqual(poseBefore({ x: 1, y: 2, h: 3 }, 20, 0.5, 0), { x: 1, y: 2, h: 3 });
  });
});

describe('glide', () => {
  const object = (over = {}) => ({ tx: 0, ty: 0, wx: 0, wy: 0, vx: 0, vy: 0, ...over });
  const run = (e, seconds, tau = 0.35) => { for (let i = 0; i < seconds * 60; i++) glide(e, 1 / 60, 1, tau); };

  test('an object at highway speed does not trail its estimate', () => {
    const e = object({ vx: 29 });
    run(e, 3);
    near(e.wx, e.tx);
    near(e.wx, 87, 1e-3);
  });

  test('a correction closes gradually, then fully', () => {
    const e = object();
    e.tx = 1;
    glide(e, 1 / 60, 1, 0.35);
    assert.ok(e.wx > 0 && e.wx < 0.06, `first frame ${e.wx}`);
    run(e, 3);
    near(e.wx, 1, 1e-3);
  });

  test('stands still while replay is paused', () => {
    const e = object({ vx: 29, vy: 2 });
    run(e, 1);
    const { wx, wy } = e;
    for (let i = 0; i < 60; i++) glide(e, 1 / 60, 0, 0.35);
    near(e.wx, wx, 1e-3);
    near(e.wy, wy, 1e-3);
  });
});
