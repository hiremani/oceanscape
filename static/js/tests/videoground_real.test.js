// Camera on road against real data: a comma four's calibration and model output from a recorded drive
// (tests/fixtures/real_calib_model.json, route 00000151--6a38b4d0fc segment 6). The page places video on the road
// with carToCalib + projectCalib on a road plane fitted to the model's lane lines (groundFit); for each confident
// lane-line point that must land on the same stream pixel as the comma's own projection (M . point), or the real
// lane paint in the video won't sit on the drawn lane lines. (Checked against the decoded frames: the model's lines
// land within about 0.1 m of the paint, see the replay video tests in sunnypilot webhud.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { carToCalib, projectCalib, groundFit } from '../videoground_geom.js';


const fx = JSON.parse(readFileSync(new URL('./fixtures/real_calib_model.json', import.meta.url)));
const cal = fx.calib.cameras.road;
const CAM_X = -1.6;   // any: the page's car frame is the model's shifted by it, and it cancels out

function pixel(M, p) {
  const w = M[2][0] * p[0] + M[2][1] * p[1] + M[2][2] * p[2];
  return [(M[0][0] * p[0] + M[0][1] * p[1] + M[0][2] * p[2]) / w, (M[1][0] * p[0] + M[1][1] * p[1] + M[1][2] * p[2]) / w];
}

/** The largest pixel error between the page's projection of each confident model lane point (on the road profile
 *  `road(model)` gives) and the comma's own (M . point), and the largest lateral error in metres. */
function worst(road) {
  let n = 0, px = 0, lat = 0;
  for (const m of fx.models) {
    const r = road(m);
    const cam = { x: CAM_X, y: 0, h: r.h, slope: r.slope, curv: r.curv || 0 };
    m.lanes.forEach((line, i) => {
      if (m.laneProbs[i] < 0.6) return;
      for (const [x, yRight, zDown] of line) {
        if (x < 6 || x > 40) continue;
        const truth = pixel(cal.M, [x, yRight, zDown]);
        // the page: a ground point ahead of the bumper (x + cam.x), y left, on its fitted road
        const uv = projectCalib(cal.M, cal.width, cal.height, carToCalib(x + CAM_X, -yRight, 0, cam));
        if (!uv) continue;
        const du = uv[0] * cal.width - truth[0], dv = uv[1] * cal.height - truth[1];
        n++;
        px = Math.max(px, Math.hypot(du, dv));
        lat = Math.max(lat, Math.abs(du) * x / cal.K[0][0]);
      }
    });
  }
  return { n, px, lat };
}

test('real calibration: the page puts model lane points on the pixels the comma projects them to', () => {
  assert.ok(fx.calib.calibrated && cal.M && cal.width === 1280 && cal.height === 720);
  const r = worst((m) => groundFit(m).quad);
  assert.ok(r.n >= 30, `only ${r.n} lane points checked`);
  // the curved profile follows the model's road to a couple of pixels; a sign or axis error would be tens to hundreds
  assert.ok(r.px < 3, `up to ${r.px.toFixed(1)} px off`);
  assert.ok(r.lat < 0.02, `lateral error up to ${r.lat.toFixed(3)} m`);
});

test('real calibration: a straight road profile would not do on this drive (it climbs about 1 m in 37 m)', () => {
  // the straight fit misses near and far points by more: at the far end 2 px are metres along the road
  const flat = worst((m) => { const f = groundFit(m); return { h: f.h, slope: f.slope, curv: 0 }; });
  const curved = worst((m) => groundFit(m).quad);
  assert.ok(flat.px > 8 && curved.px < flat.px / 3, `straight ${flat.px.toFixed(1)} px vs curved ${curved.px.toFixed(1)} px`);
});

test('real calibration: the curved fit puts the camera at its calibrated height once calibration has settled', () => {
  for (const m of fx.models) {
    if (m.pathZ === 1.22) continue;   // calibrationd's HEIGHT_INIT: not measured yet
    const q = groundFit(m).quad;
    assert.ok(Math.abs(q.h - m.pathZ) < 0.1, `frame ${m.frameId}: fit ${q.h.toFixed(2)} m vs calibrated ${m.pathZ} m`);
  }
});
