// The driver profile section's data (Settings → Driving): what the comma's GET /api/profiles returns, turned into
// rows to show. The profile is a file of the driver's own habits (sunnypilot driver_profile.py, made from their drives
// by driver_profile_gen.py); with the DriverProfile param on, openpilot's speed planner drives by it in place of its
// defaults. No DOM here, so Node can test it (static/js/tests/profile_view.test.js).

// The values the planner reads, in the order shown: [key, label, unit, what it changes]. launch_accel is in the file
// but only drive_sim uses it, so it isn't listed. Units are the profile's own (it is defined in mph).
export const PROFILE_FIELDS = [
  ['follow_gap_s', 'Following gap', 's', 'Time gap behind the car ahead. Replaces the personality above.'],
  ['lead_coast_s', 'Lift off for a slower car', 's', 'No accelerating toward a slower car closer than this. 0 = off.'],
  ['town_offset_mph', 'Speed in town', 'mph', 'Over (+) or under (−) the limit, below the fast-road limit. Needs the speed cap.'],
  ['fast_offset_mph', 'Speed on fast roads', 'mph', 'Over or under the limit on fast roads. Needs the speed cap.'],
  ['fast_zone_mph', 'Fast roads from', 'mph', 'The posted limit from which a road counts as fast.'],
  ['curve_lat_accel', 'Curve speed', 'm/s²', 'Sideways acceleration Smart Cruise Control allows in curves.'],
  ['stop_decel', 'Braking to a stop', 'm/s²', 'Stop Sign Assist braking rate.'],
  ['coast_s', 'Coast before braking', 's', 'Stop Sign Assist lift-off time before it brakes.'],
  ['junction_turn_mph', 'Junction turn speed', 'mph', 'Speed through a signaled sharp turn.'],
  ['turn_exit_accel', 'Pull away after a turn', 'm/s²', 'Most acceleration just after a junction turn.'],
  ['turn_stop_start_left_m', 'Turn start from a stop, left', 'm', 'Map turn assist starts the turn this close to the junction. 0 = off.'],
  ['turn_stop_start_right_m', 'Turn start from a stop, right', 'm', 'The same for right turns. 0 = off.'],
  ['narrow_speed_mph', 'Narrow street speed', 'mph', 'Speed cap on narrow streets (Narrow Street Assist).'],
];

// offsets carry a sign; the rest don't
const SIGNED = new Set(['town_offset_mph', 'fast_offset_mph']);

export function fmtValue(key, v, unit) {
  if (v == null || !Number.isFinite(Number(v))) return '–';
  const n = Number(v);
  const digits = unit === 'm' || unit === 'mph' ? (Number.isInteger(n) ? 0 : 1) : 2;
  let s = n.toFixed(digits);
  if (SIGNED.has(key)) s = n > 0 ? `+${s}` : n < 0 ? `−${s.slice(1)}` : s;   // a real minus sign
  return `${s} ${unit}`;
}

/** The state of the section, from GET /api/profiles (or the error it threw):
 *  {kind: 'unsupported' | 'unbuilt' | 'ok', ...}. */
export function profileState(resp) {
  if (!resp || resp instanceof Error || resp.error || !Array.isArray(resp.profiles)) {
    return { kind: 'unsupported' };   // an older comma web HUD server: no /api/profiles
  }
  if (resp.enabled === null || resp.enabled === undefined) return { kind: 'unbuilt' };   // its params don't have DriverProfile
  const names = resp.profiles.map(p => p.name);
  const active = resp.profiles.find(p => p.name === resp.active) || null;
  return {
    kind: 'ok',
    enabled: !!resp.enabled,
    speed: !!resp.speed,
    editable: resp.editable !== false,
    names,
    activeName: resp.active,
    activeMissing: !active,          // the DriverProfileName file isn't there: the planner uses the defaults
    active,
    defaults: resp.defaults || {},
  };
}

/** One line about where the active profile came from (driver_profile_gen.py's meta), or ''. */
export function provenance(meta) {
  if (!meta || typeof meta !== 'object') return '';
  let s = '';
  if (meta.generated) {
    const d = new Date(meta.generated);
    s = `Made ${Number.isNaN(d.getTime()) ? meta.generated : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  const n = Array.isArray(meta.routes) ? meta.routes.length : null;
  if (n != null) s += `${s ? ' from' : 'From'} ${n} drive${n === 1 ? '' : 's'}`;
  if (Number.isFinite(meta.miles)) s += `${s ? ', ' : ''}${meta.miles} mi`;
  return s;
}

/** The rows for the active profile: {key, label, unit, desc, value, def, text, defText, changed, note}. */
export function profileRows(active, defaults) {
  const values = (active && active.values) || {};
  const meta = (active && active.meta && active.meta.values) || {};
  return PROFILE_FIELDS.map(([key, label, unit, desc]) => {
    const value = key in values ? values[key] : defaults[key];
    const def = defaults[key];
    const m = meta[key] || {};
    let note = '';
    if (typeof m.note === 'string' && m.note.includes('too few samples')) note = 'Not enough driving yet: the default.';
    else if (Number.isFinite(m.samples) && m.samples > 0) note = `From ${m.samples} sample${m.samples === 1 ? '' : 's'}.`;
    const changed = Number.isFinite(Number(value)) && Number.isFinite(Number(def)) && Math.abs(Number(value) - Number(def)) > 1e-6;
    return { key, label, unit, desc, value, def, text: fmtValue(key, value, unit), defText: fmtValue(key, def, unit), changed, note };
  });
}

/** The per-posted-limit offsets, smallest limit first: [{limit, text}]. */
export function limitOffsets(active) {
  const offs = (active && active.values && active.values.limit_offsets_mph) || {};
  return Object.entries(offs)
    .map(([k, v]) => [Number(k), Number(v)])
    .filter(([k, v]) => Number.isFinite(k) && Number.isFinite(v))
    .sort((a, b) => a[0] - b[0])
    .map(([limit, v]) => ({ limit, text: fmtValue('town_offset_mph', v, 'mph') }));
}
