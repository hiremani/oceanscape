// The HUD layouts' arithmetic (hudlayout_logic.js): the driving flag, the lead car, the read-outs and the page.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { drivingState, leadOf, chargeOf, rangeOf, tripOf, odometerOf, chargeLine, fmtMinutes, autoPage, pageFor } from '../../hudlayout_logic.js';

/** A stand-in for carstate.js: raw values by name, physical = raw * res + off. */
function cs(raws, defs = {}) {
  return {
    rawOf: (n) => raws[n],
    value: (n) => { const r = raws[n]; if (r === undefined) return undefined; const d = defs[n] || {}; return r * (d.res ?? 1) + (d.off ?? 0); },
  };
}
const DEFS = { VCU_HVBattActPwr: { res: 0.1, off: -600 }, VCU_DrvgMilg: { res: 0.1 }, VCU_TripMilg: { res: 0.1 }, BCM_TotMilg_ODO: { res: 0.01 } };

describe('drivingState', () => {
  test('Park is parked, whatever the speed', () => {
    assert.equal(drivingState({ op: { carState: { gear: 'park', vEgo: 3 } } }).driving, false);
    assert.equal(drivingState({ fisker: { vehicle: { gear: 'gear_P', speedKph: 10 } } }).driving, false);
  });
  test('any other gear is driving, even stopped', () => {
    assert.equal(drivingState({ op: { carState: { gear: 'drive', vEgo: 0 } } }).driving, true);
    assert.equal(drivingState({ fisker: { vehicle: { gear: 'R_gear', speedKph: 0 } } }).driving, true);
  });
  test('with the gear unknown the speed decides; with no data the page is parked', () => {
    assert.equal(drivingState({ op: { carState: { vEgo: 1 } } }).driving, true);
    assert.equal(drivingState({ op: { carState: { vEgo: 0.1 } } }).driving, false);
    assert.equal(drivingState(null).driving, false);
    assert.equal(drivingState({}).known, false);
  });
});

describe('leadOf', () => {
  test('the nearest confident object in our lane, with its gap and closing speed', () => {
    const st = { objects: [{ x: 60, y: 0.5, vx: 25, conf: 0.9 }, { x: 34, y: -0.8, vx: 26, conf: 0.8 }, { x: 20, y: 4, vx: 20, conf: 1 }, { x: 10, y: 0, vx: 0, conf: 0.2 }] };
    const l = leadOf(st, 29);
    assert.equal(l.dist, 34);
    assert.ok(Math.abs(l.gap - 34 / 29) < 1e-9);
    assert.equal(l.closing, 3);
    assert.equal(l.src, 'world');
  });
  test('openpilot\'s lead stands in when the world model has none', () => {
    const l = leadOf({ op: { radarState: { leadOne: { present: true, dRel: 40, vRel: -2 } } } }, 20);
    assert.equal(l.dist, 40);
    assert.equal(l.closing, 2);
    assert.equal(l.src, 'op');
    assert.equal(leadOf({ op: { radarState: { leadOne: { present: false } } } }, 20), null);
  });
});

describe('the read-outs', () => {
  test('charging: the VCU\'s power into the pack, the gun, the time left', () => {
    const ch = chargeOf(cs({ VCU_HVBattActPwr: 6074, VCU_ACChrgDchaGunCnctnSts: 2, VCU_ACRmngChrgTi: 100, BMS_Bat_SoC_usable: 61 }, DEFS));
    assert.ok(Math.abs(ch.kw - 7.4) < 1e-9);
    assert.deepEqual([ch.plugged, ch.charging, ch.soc, ch.leftMin], [true, true, 61, 100]);
    assert.equal(chargeLine(ch, { value: 187, unit: 'mi' }), 'Charging 7.4 kW · 61 % · 187 mi · 1 h 40 left');
    const idle = chargeOf(cs({ VCU_HVBattActPwr: 5990, VCU_ACChrgDchaGunCnctnSts: 2, VCU_ACRmngChrgTi: 0xFFFF }, DEFS));
    assert.equal(idle.charging, false);
    assert.equal(chargeLine(idle, null), 'Plugged in');
    assert.equal(chargeLine(chargeOf(cs({ VCU_HVBattActPwr: 5800 }, DEFS)), null), '');
    assert.equal(chargeOf(cs({})), null);
  });
  test('range and trip convert to the display unit', () => {
    const r = rangeOf(cs({ VCU_DrvgMilg: 3010, VCU_DrvRngVld: 1 }, DEFS), 'mph');
    assert.deepEqual(r, { value: 187, unit: 'mi', valid: true });
    assert.deepEqual(rangeOf(cs({ VCU_DrvgMilg: 3010 }, DEFS), 'kmh'), { value: 301, unit: 'km', valid: null });
    assert.equal(rangeOf(cs({}), 'mph'), null);
    const t = tripOf(cs({ VCU_TripMilg: 377, VCU_TripAvgEgyConsmd: 200 }, DEFS), 'mph');
    assert.equal(t.dist, '23.4');
    assert.equal(t.unit, 'mi');
    assert.equal(t.effUnit, 'mi/kWh');
    assert.ok(Math.abs(Number(t.eff) - 3.1) < 0.05);
    assert.deepEqual(tripOf(cs({ VCU_TripMilg: 377, VCU_TripAvgEgyConsmd: 200 }, DEFS), 'kmh'), { dist: '37.7', unit: 'km', eff: '20.0', effUnit: 'kWh/100 km' });
    assert.deepEqual(odometerOf(cs({ BCM_TotMilg_ODO: 1234500 }, DEFS), 'kmh'), { value: 12345, unit: 'km' });
  });
  test('minutes', () => {
    assert.equal(fmtMinutes(45), '45 min');
    assert.equal(fmtMinutes(100), '1 h 40');
    assert.equal(fmtMinutes(125), '2 h 05');
    assert.equal(fmtMinutes(null), '');
  });
});

describe('the tile pages', () => {
  test('follow the car\'s state', () => {
    assert.equal(autoPage({ driving: false, plugged: true, assist: false }), 'charge');
    assert.equal(autoPage({ driving: false, plugged: false, assist: true }), 'park');
    assert.equal(autoPage({ driving: true, plugged: true, assist: true }), 'assist');
    assert.equal(autoPage({ driving: true, plugged: false, assist: false }), 'drive');
  });
  test('a tapped page holds until the state\'s page changes', () => {
    assert.equal(pageFor('drive', 'charge', 'drive'), 'charge');
    assert.equal(pageFor('assist', 'charge', 'drive'), 'assist');
    assert.equal(pageFor('drive', null, 'drive'), 'drive');
  });
});
