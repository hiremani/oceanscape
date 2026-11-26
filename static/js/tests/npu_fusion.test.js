// node --test static/js/tests/*.test.js -- the NPU detector as the world model's fourth source (world_model.js 'cam')
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FUSION_DELAY_S, WorldModel, adasMeasurement, camRangeFits, cameraMeasurements, radarMeasurements } from '../world/world_model.js';

function radarObj(oid, x, y, { vx = 0.0, vy = 0.0, age = 40, cls = 'unclassified', w = null, l = null } = {}) {
  return { id: oid, x, y, vx, vy, age, hist: 0x3FFF, state: 3, quality: 13, cls, heading: null, w, l };
}
const camDet = (cls, x, y, extra = {}) => ({ cls, k: cls, x, y, sx: 0.4 + 0.05 * x, sy: 0.2 + 0.01 * x, conf: 0.9, score: 0.9,
  dims: { pedestrian: [0.6, 0.6, 1.7], bicycle: [0.6, 1.8, 1.7], car: [1.85, 4.6, 1.5], truck: [2.5, 8.0, 3.2] }[cls], ...extra });

/** Run `steps` frames of 50 ms at speed v (straight); feed(t) returns nothing, it adds measurements itself. */
function run(model, steps, v, feed) {
  let out = [];
  for (let i = 0; i < steps; i++) {
    const t = i * 0.05;
    model.odo.update(t, v, 0);
    feed(t, i);
    out = model.step(t);
  }
  return out;
}

test('the detector\'s class wins: a radar-and-ADAS "car" it sees as a truck becomes a truck, sized as one', () => {
  const m = new WorldModel();
  const out = run(m, 40, 0, (t) => {
    m.add(radarMeasurements(t, [radarObj(5, 30.0, 0.5)], 0.0));
    m.add([adasMeasurement(t + 0.12, { id: 9, x: 31.7, y: 0.5, cls: 'car', w: 1.9, l: 4.7, h: 1.5 })]);
    if (t > 0.5) m.add(cameraMeasurements(t, [camDet('truck', 30.5, 0.4)]));
  });
  const o = out.find(x => Math.abs(x.x - 30) < 3);
  assert.ok(o, JSON.stringify(out));
  assert.equal(out.length, 1, 'one object, not a camera copy');
  assert.equal(o.cls, 'truck');
  assert.ok(o.l >= 7, `truck length ${o.l}`);
  assert.ok(o.sources.some(s => s.src === 'cam'));
});

test('when the detector agrees with the ADAS list, the ADAS list\'s measured size stays', () => {
  const m = new WorldModel();
  const out = run(m, 40, 0, (t) => {
    m.add(radarMeasurements(t, [radarObj(5, 30.0, 0.5)], 0.0));
    m.add([adasMeasurement(t + 0.12, { id: 9, x: 31.7, y: 0.5, cls: 'car', w: 1.9, l: 4.7, h: 1.5 })]);
    m.add(cameraMeasurements(t, [camDet('car', 30.5, 0.4)]));
  });
  assert.equal(out[0].cls, 'car');
  assert.equal(out[0].w, 1.9);
});

test('a pedestrian only the detector sees becomes an object of its own; a lone car box does not while the radar reports', () => {
  const m = new WorldModel();
  const out = run(m, 40, 0, (t) => {
    m.add(radarMeasurements(t, [radarObj(5, 30.0, 0.5)], 0.0));   // the radar is reporting (something else)
    m.add(cameraMeasurements(t, [camDet('pedestrian', 15.0, 3.0), camDet('car', 45.0, -3.6)]));
  });
  const ped = out.find(o => o.cls === 'pedestrian');
  assert.ok(ped, JSON.stringify(out.map(o => [o.cls, o.x, o.y])));
  assert.ok(Math.abs(ped.cx - 15.3) < 1.0 && Math.abs(ped.cy - 3.0) < 0.5, `${ped.cx},${ped.cy}`);
  assert.ok(ped.conf > 0.6, `confidence ${ped.conf}`);
  assert.ok(!out.some(o => Math.abs(o.x - 45) < 4), 'no camera-only car while the radar is reporting');
});

test('with no radar or ADAS at all, the detector may start vehicles too', () => {
  const m = new WorldModel();
  const out = run(m, 40, 0, (t) => m.add(cameraMeasurements(t, [camDet('car', 20.0, 0.0)])));
  assert.ok(out.some(o => o.cls === 'car' && Math.abs(o.x - 20) < 1.5), JSON.stringify(out.map(o => [o.cls, o.x])));
});

test('camera veto: a standing radar track in our path the detector never finds is an overhead structure, hidden', () => {
  const m = new WorldModel();
  const gantryX = 45;   // a sign gantry 45 m ahead; we drive at 10 m/s toward it
  const out = run(m, 60, 10, (t) => {
    const x = gantryX - 10 * t;
    m.add(radarMeasurements(t, [radarObj(3, x, 0.2, { vx: -10, cls: 'car', w: 3.4, l: 0.6 })], 10));
    m.add(cameraMeasurements(t, []));   // the detector ran and found nothing there
    m.camRan(t);
  });
  const g = out.find(o => o.sources.some(s => s.src === 'radar'));
  assert.ok(!g || (g.overhead && g.conf < 0.2), JSON.stringify(g && { conf: g.conf, why: g.confWhy, overhead: g.overhead }));
});

test('no veto while the detector sees the vehicle, nor when it isn\'t running', () => {
  for (const camOn of [true, false]) {
    const m = new WorldModel();
    const out = run(m, 60, 10, (t) => {
      const x = 45 - 9 * t;   // a slower car ahead... standing: a stopped car we approach
      const xs = 45 - 10 * t;
      m.add(radarMeasurements(t, [radarObj(3, xs, 0.2, { vx: -10, cls: 'car', w: 1.9, l: 4.5 })], 10));
      if (camOn) { m.add(cameraMeasurements(t, [camDet('car', xs, 0.2)])); m.camRan(t); }
      void x;
    });
    const c = out.find(o => o.sources.some(s => s.src === 'radar'));
    assert.ok(c && !c.overhead, `camOn=${camOn}: ${JSON.stringify(c && { conf: c.conf, why: c.confWhy })}`);
  }
});

test('the detector\'s boxes leave no identity behind (no sticky entries pile up)', () => {
  const m = new WorldModel();
  run(m, 100, 0, (t) => m.add(cameraMeasurements(t, [camDet('pedestrian', 12.0, 2.0)])));
  assert.ok(![...m.sticky.keys()].some(k => k.startsWith('cam:')));
});

test('cameraMeasurements skips malformed entries and clamps weights', () => {
  const ms = cameraMeasurements(1.0, [camDet('car', 10, 0, { conf: 0.05 }), { cls: 'car', x: NaN, y: 0 }, null]);
  assert.equal(ms.length, 1);
  assert.equal(ms[0].src, 'cam');
  assert.ok(ms[0].weight >= 0.3);
  assert.equal(ms[0].t, 1.0);
  void FUSION_DELAY_S;
});

test('a low-scoring box (0.44, lane paint) refines an existing track\'s class but never starts an object of its own', () => {
  const m = new WorldModel();
  const out = run(m, 40, 0, (t) => {
    m.add(radarMeasurements(t, [radarObj(5, 30.0, 0.5)], 0.0));
    m.add([adasMeasurement(t + 0.12, { id: 9, x: 31.7, y: 0.5, cls: 'car', w: 1.9, l: 4.7, h: 1.5 })]);
    m.add(cameraMeasurements(t, [camDet('truck', 30.5, 0.4, { score: 0.4, conf: 0.4 }), camDet('pedestrian', 12.0, 1.0, { score: 0.44, conf: 0.44 })]));
  });
  assert.equal(out.length, 1, JSON.stringify(out.map(o => [o.cls, o.x])));
  assert.equal(out[0].cls, 'truck');
});

test('a camera-only object needs CAM_SPAWN_FRAMES boxes in a row: two-frame flashes never start one', () => {
  const m = new WorldModel();
  const out = run(m, 60, 0, (t, i) => {
    m.add(radarMeasurements(t, [radarObj(5, 30.0, 0.5)], 0.0));
    if (i % 4 < 2) m.add(cameraMeasurements(t, [camDet('pedestrian', 14.0, 2.0)]));   // two frames on, two off
    m.camRan(t);   // every frame, boxes or not (state.js feedCamera)
  });
  assert.ok(!out.some(o => o.cls === 'pedestrian'), JSON.stringify(out.map(o => [o.cls, o.x])));
});

test('a box does not override the radar\'s range on an object the radar measures', () => {
  const m = new WorldModel();
  const out = run(m, 60, 0, (t) => {
    m.add(radarMeasurements(t, [radarObj(5, 30.0, 0.5)], 0.0));
    m.add(cameraMeasurements(t, [camDet('car', 36.0, 0.5)]));   // the box's range 6 m long
  });
  const o = out.find(x => x.sources.some(s => s.src === 'radar'));
  assert.ok(o && Math.abs(o.x - 30.0) < 0.8, `range ${o && o.x}`);
  assert.equal(o.cls, 'car');
});

test('a near box on the same bearing never joins a far lead (night drive: 40 m boxes joined 68-70 m leads)', () => {
  assert.equal(camRangeFits(40, 69), false);
  assert.equal(camRangeFits(40, 45), true);    // within 25 %
  assert.equal(camRangeFits(10, 15.5), true);  // within the 6 m floor
  assert.equal(camRangeFits(10, 17), false);
  assert.equal(camRangeFits(NaN, 20), false);
  const m = new WorldModel();
  const out = run(m, 40, 0, (t) => {
    m.add(radarMeasurements(t, [radarObj(5, 69.0, 0.3)], 0.0));
    if (t > 0.5) m.add(cameraMeasurements(t, [camDet('truck', 40.0, 0.2, { sx: 15.0 })]));
  });
  const far = out.find(x => Math.abs(x.x - 69) < 4);
  assert.ok(far, JSON.stringify(out));
  assert.ok(!far.sources.some(s => s.src === 'cam'), 'the far lead took no camera update');
  assert.notEqual(far.cls, 'truck');
});
