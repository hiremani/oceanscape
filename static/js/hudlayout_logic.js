// The HUD layouts' arithmetic (hudlayout.js), kept apart from the DOM so it runs under node --test: whether the car
// counts as driving, the lead car, the charge and range read-outs, and which page of the tile dash is current.
//
// Units: the IBUS matrix's distances are taken as kilometres (VCU_DrvgMilg, VCU_TripMilg, BCM_TotMilg_ODO) and its
// trip consumption as Wh/km (VCU_TripAvgEgyConsmd); neither is verified against the cluster yet.

const GEAR_LETTER = {
  park: 'P', reverse: 'R', neutral: 'N', drive: 'D', eco: 'D', sport: 'D', low: 'D', brake: 'D', manumatic: 'D',
  gear_P: 'P', gear_N: 'N', R_gear: 'R', D_gear: 'D', gear_D: 'D', gear_E: 'D', gear_S: 'D',
};
const KM_TO_MI = 0.621371;
const MOVING_MS = 0.3;          // m/s: with the gear unknown, faster than this is driving
const LEAD_HALF_W = 1.9;        // m: an object this far to the side is in our lane
const LEAD_MIN_CONF = 0.5;

export function gearLetter(state) {
  if (!state) return '';
  const cs = state.op && state.op.carState, f = state.fisker;
  return GEAR_LETTER[(cs && cs.gear) || ''] || GEAR_LETTER[(f && f.vehicle && f.vehicle.gear) || ''] || '';
}

/** The car's speed, m/s, or null. */
export function speedMs(state) {
  if (!state) return null;
  const cs = state.op && state.op.carState, f = state.fisker;
  if (cs && cs.vEgo != null) return cs.vEgo;
  if (f && f.vehicle && f.vehicle.speedKph != null) return f.vehicle.speedKph / 3.6;
  return null;
}

/** NHTSA's line: driving is "not in Park". With the gear unknown the speed decides; with no data at all (the plain
 *  browser, the car asleep) the page counts as parked, so the design page and the mockup keep working. */
export function drivingState(state) {
  const gear = gearLetter(state), v = speedMs(state);
  const driving = gear ? gear !== 'P' : v != null ? v > MOVING_MS : false;
  return { driving, gear, v, known: !!gear || v != null };
}

/** The car ahead in our lane: { dist (m), gap (s), closing (m/s, + = we gain on it), src }, or null. */
export function leadOf(state, vEgo) {
  if (!state) return null;
  let best = null;
  for (const o of state.objects || []) {
    if (!(o.x > 0) || Math.abs(o.y || 0) > LEAD_HALF_W || (o.conf ?? 1) < LEAD_MIN_CONF) continue;
    if (!best || o.x < best.x) best = o;
  }
  const v = vEgo == null ? 0 : vEgo;
  if (best) return { dist: best.x, gap: best.x / Math.max(v, 0.1), closing: v - (best.vx ?? v), src: 'world' };
  const rs = state.op && state.op.radarState, ld = rs && rs.leadOne;
  if (ld && ld.present && ld.dRel != null) return { dist: ld.dRel, gap: ld.dRel / Math.max(v, 0.1), closing: -(ld.vRel ?? 0), src: 'op' };
  return null;
}

/** The battery as the car reports it. `cs` answers rawOf(name) and value(name) (carstate.js). */
export function chargeOf(cs) {
  const kw = cs.value('VCU_HVBattActPwr');
  const gunAc = cs.rawOf('VCU_ACChrgDchaGunCnctnSts'), gunDc = cs.rawOf('VCU_DCChrgDchaGunCnctnSts');
  const left = cs.rawOf('VCU_ACRmngChrgTi');
  const soc = cs.rawOf('BMS_Bat_SoC_usable');
  if (kw === undefined && soc === undefined && gunAc === undefined) return null;
  const plugged = (gunAc !== undefined && gunAc >= 2) || (gunDc !== undefined && gunDc >= 2);
  const charging = kw != null && kw > 0.3;          // the VCU's sign: into the pack is positive (carcontrols.js hero)
  return { kw: kw ?? null, soc: soc ?? null, plugged, charging, leftMin: left !== undefined && left < 0xFFFF ? left : null };
}

/** Remaining range in the display unit: { value, unit, valid }, or null when the car hasn't said. */
export function rangeOf(cs, unit) {
  const km = cs.value('VCU_DrvgMilg');
  if (km === undefined) return null;
  const vld = cs.rawOf('VCU_DrvRngVld');
  return { value: Math.round(unit === 'kmh' ? km : km * KM_TO_MI), unit: unit === 'kmh' ? 'km' : 'mi', valid: vld === undefined ? null : vld === 1 };
}

/** The trip: { dist, unit, eff, effUnit } in the display unit, or null. */
export function tripOf(cs, unit) {
  const km = cs.value('VCU_TripMilg');
  if (km === undefined) return null;
  const whkm = cs.value('VCU_TripAvgEgyConsmd');
  const metric = unit === 'kmh';
  let eff = null, effUnit = '';
  if (whkm !== undefined && whkm > 0) {
    if (metric) { eff = (whkm / 10).toFixed(1); effUnit = 'kWh/100 km'; }
    else { eff = (1000 / (whkm / KM_TO_MI)).toFixed(1); effUnit = 'mi/kWh'; }
  }
  return { dist: (metric ? km : km * KM_TO_MI).toFixed(1), unit: metric ? 'km' : 'mi', eff, effUnit };
}

/** The odometer in the display unit, or null. */
export function odometerOf(cs, unit) {
  const km = cs.value('BCM_TotMilg_ODO');
  if (km === undefined) return null;
  return { value: Math.round(unit === 'kmh' ? km : km * KM_TO_MI), unit: unit === 'kmh' ? 'km' : 'mi' };
}

export function fmtMinutes(m) {
  if (m == null) return '';
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
}

/** One line for the band while parked and plugged in, else ''. */
export function chargeLine(ch, range) {
  if (!ch || !ch.plugged) return '';
  const parts = [ch.charging ? `Charging ${ch.kw.toFixed(1)} kW` : 'Plugged in'];
  if (ch.soc != null) parts.push(`${ch.soc} %`);
  if (range) parts.push(`${range.value} ${range.unit}`);
  if (ch.charging && ch.leftMin != null) parts.push(`${fmtMinutes(ch.leftMin)} left`);
  return parts.join(' · ');
}

export const PAGES = ['drive', 'assist', 'charge', 'park'];

/** The tile dash's page by the car's state: Charge when plugged in and parked, Park when parked, Assist while the
 *  driver assistance steers or holds speed, else Drive. */
export function autoPage({ driving, plugged, assist }) {
  if (!driving) return plugged ? 'charge' : 'park';
  return assist ? 'assist' : 'drive';
}

/** The page shown: the one the user tapped, until the state's own page changes. */
export function pageFor(auto, manual, autoPrev) {
  if (manual && auto === autoPrev) return manual;
  return auto;
}

export const KM_TO_MI_ = KM_TO_MI;
