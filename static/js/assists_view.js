// The comma's driving assists as switches (Settings -> Driving), and the buildings area download's status line
// (Settings -> Display -> Road -> Map download). No DOM here, so Node can test it (static/js/tests/assists_view.test.js).
//
// Each switch is a bool sunnypilot param the comma's web HUD lets the page change (/api/params). A switch shows only
// when /api/params returns its param: an older comma without the assist keeps it hidden. A sub-option (a shadow mode,
// a forced level) shows indented under its assist.

export const ASSIST_GROUPS = [
  {
    title: 'Speed control assists',
    desc: 'openpilot slowing for what the map shows ahead. They act only when openpilot controls the speed; with the ' +
      'car\'s own cruise control they stay off.',
    items: [
      { key: 'StopSignAssist', label: 'Stop Sign Assist', desc: 'Brakes to a stop at mapped stop signs.',
        subs: [{ key: 'StopSignAssistShadow', label: 'Log only', desc: 'Works out what it would do on every drive, without braking, for review.' }] },
      { key: 'SpeedBumpAssist', label: 'Speed Bump Assist', desc: 'Eases off to each mapped speed bump\'s crossing speed.',
        subs: [
          { key: 'SpeedBumpAlert', label: 'Chime before bumps', desc: 'A "Speed bump ahead" chime, whatever is driving the speed.' },
          { key: 'SpeedBumpAssistShadow', label: 'Log only', desc: 'Works out what it would do, without slowing, for review.' },
        ] },
      { key: 'TrafficSignalCoast', label: 'Coast toward traffic lights', desc: 'No accelerating toward a mapped traffic light ahead.' },
      { key: 'CrosswalkCaution', label: 'Crosswalk caution', desc: 'Slows for marked crosswalks on narrow streets.' },
      { key: 'NarrowStreetAssist', label: 'Narrow Street Assist', desc: 'Keeps off the center line, slows and warns on narrow streets with no lane lines.' },
    ],
  },
  {
    title: 'Map turn assist',
    desc: 'openpilot steering through signaled low-speed junction turns, from the map.',
    items: [
      { key: 'MapTurnAssist', label: 'Map turn assist', desc: 'Steers a signaled turn at a mapped junction. Needs Lane turn desire.',
        subs: [{ key: 'LaneTurnDesire', label: 'Lane turn desire', desc: 'Lets the driving model take a turn when you signal at low speed.' }] },
    ],
  },
  {
    title: 'Rain',
    desc: 'Rain is read from the wipers and traction control, no camera.',
    items: [
      { key: 'WetRoadAssist', label: 'Wet road assist', desc: 'In the rain: a longer following gap, gentler curves, stops and pull-aways, ' +
        'and at most the posted limit. Heavy rain also turns off auto lane change and the map turn assist.',
        subs: [{ key: 'WetRoadForce', label: 'Always wet', desc: 'Drives as on a wet road whatever the wipers say.' }] },
    ],
  },
];

/** The groups with only the switches this comma has (in `params`, as /api/params returns them), each item
 *  {key, label, desc, on, subs: [{key, label, desc, on}]}; groups with nothing left are dropped. */
export function assistGroups(params) {
  const has = (k) => params != null && typeof params[k] === 'boolean';
  const out = [];
  for (const g of ASSIST_GROUPS) {
    const items = [];
    for (const it of g.items) {
      const subs = (it.subs || []).filter(sb => has(sb.key)).map(sb => ({ ...sb, on: params[sb.key] }));
      if (!has(it.key)) continue;   // a sub-option without its assist means nothing
      items.push({ key: it.key, label: it.label, desc: it.desc, on: params[it.key], subs });
    }
    if (items.length) out.push({ title: g.title, desc: g.desc, items });
  }
  return out;
}

/** Every param a switch may write (the page sends nothing else from this section). */
export const ASSIST_KEYS = new Set(ASSIST_GROUPS.flatMap(g => g.items.flatMap(it => [it.key, ...(it.subs || []).map(s => s.key)])));

// ---- buildings area download (POST/GET /map/buildings/area) ----

export const BLD_AREA_KM = 3;

/** One line for the area download's status, or '' before any. */
export function describeAreaDownload(st) {
  if (!st || !st.center || !(st.cells > 0)) return '';
  const done = st.ready >= st.cells, areas = `area${st.cells === 1 ? '' : 's'}`;
  const head = done ? `${st.cells === 1 ? 'The' : 'All'} ${st.cells} ${areas} within ${st.radius_km} km downloaded`
    : `${st.ready}/${st.cells} ${areas} within ${st.radius_km} km` + (st.busy ? ', downloading' : ', paused');
  return head + (st.errors ? `, ${st.errors} failed (Download again retries them)` : '');
}
