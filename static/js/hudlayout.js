// The HUD's layouts (Settings → Display → Layout): the classic floating cards, the Glance Strip (a fixed status strip
// across the top with the essential driving set, one band for the next turn or the current alert, the 3D world, and
// a fixed bar of quick actions at the bottom) and the Tile Dash (the 3D world in the top part of the screen over a
// grid of stat and action tiles on pages that follow the car's state). The strip is built from the status card's own
// elements: they are moved into it, so hud.js keeps feeding them and the two never disagree. The quick actions go
// through the car controls (carcontrols.js set), so they send what the catalog sends and refuse what it refuses.
//
// The page also keeps a driving flag (hudlayout_logic.js drivingState, NHTSA's "not in Park") on <html
// data-driving>, which the layouts use to collapse the music card and the map while moving and to grey the actions
// that are for a parked car.
import { $, $$, el, iconSvg, setClass, setText } from './util.js';
import { drivingState, leadOf, chargeOf, rangeOf, tripOf, odometerOf, chargeLine, fmtMinutes, autoPage, pageFor, PAGES } from './hudlayout_logic.js';

export const LAYOUTS = [['classic', 'Classic'], ['glance', 'Glance strip'], ['tiles', 'Tile dash'], ['mapcenter', 'Map Centre'], ['native', 'Ocean Native']];
const TICK_MS = 150;        // the band, the bar's states and the tiles update this often
const PARKED_ONLY = 'Parked only';
const STROKE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICON = {
  car: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M3 13l2-5h14l2 5v6H3z"/><circle cx="7" cy="17" r="1.5"/><circle cx="17" cy="17" r="1.5"/><path d="M3 13h18"/></svg>`,
  map: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/></svg>`,
  music: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>`,
  replay: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/></svg>`,
  comma: `<svg viewBox="0 0 24 24" ${STROKE}><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="3"/></svg>`,
};
const icon = (name) => ICON[name] || iconSvg(name);

// the status card's parts that make the strip, in the strip's order
const STRIP_PARTS = ['#gear', '#blinkers', '.speed-row', '#limit', '#setspeed', '#gap', '#lat-icon', '#assist-text', '#telltales', '#econ', '#chips'];
const BAND_PARTS = ['#alerts', '#navcard'];

export class HudLayout {
  constructor(app) {
    this.app = app;
    this.layout = null;
    this.moved = [];          // { node, parent, index }: where each moved element came from
    this.manualPage = null;   // the tile page the user tapped
    this.autoPrev = null;
    this.page = null;
    this.lastTick = 0;
    this.driving = false;
    this.tiles = new Map();   // key -> { node, v, sub }
    this._build();
    if (window.ResizeObserver) new ResizeObserver(() => this.app.scene.resize()).observe($('#scene'));
    this.apply();
  }

  // ---- DOM ------------------------------------------------------------------------------------------------------
  _build() {
    const root = $('#app');
    this.strip = el('div.hl-strip', { id: 'hl-strip', role: 'status' });
    this.slots = {};
    for (const sel of STRIP_PARTS) this.slots[sel] = el('div.hl-slot', { dataset: { for: sel.slice(1) } });
    const spacer = el('div.hl-spacer');
    this.strip.append(this.slots['#gear'], this.slots['#blinkers'], this.slots['.speed-row'], this.slots['#limit'], this.slots['#setspeed'],
      this.slots['#gap'], this.slots['#lat-icon'], this.slots['#assist-text'], this.slots['#telltales'], spacer, this.slots['#econ'], this.slots['#chips']);
    this.band = el('div.hl-band', { id: 'hl-band' });
    this.charge = el('div.hl-charge.hidden', el('i', { html: iconSvg('bolt') }), el('span'));
    this.band.append(this.charge);
    this.tilesBox = el('div.hl-tiles', { id: 'hl-tiles' });
    this.pages = el('div.hl-pages', { id: 'hl-pages', role: 'tablist' });
    for (const p of PAGES) {
      this.pages.append(el('button.hl-page', { type: 'button', role: 'tab', dataset: { page: p }, onclick: () => { this.manualPage = p; this._tick(true); } },
        { drive: 'Drive', assist: 'Assist', charge: 'Charge', park: 'Park' }[p]));
    }
    this.bar = el('nav.hl-bar', { id: 'hl-bar', 'aria-label': 'Quick actions' });
    this.buttons = new Map();
    for (const b of this._barItems()) {
      const node = el('button.hl-btn', { type: 'button', dataset: { key: b.key, layouts: b.layouts.join(' ') }, title: b.title || b.label,
        onclick: () => this._press(b) }, el('i', { html: icon(b.icon) }), el('span', b.label), el('small'));
      if (b.key === 'view') node.append(el('div.hl-viewslot'));
      this.buttons.set(b.key, { def: b, node });
      this.bar.append(node);
    }
    root.append(this.strip, this.band, this.tilesBox, this.pages, this.bar);
    document.addEventListener('pointerdown', (e) => { if (!this.bar.contains(e.target)) this._showViewMenu(false); });
  }

  _barItems() {
    const app = this.app;
    const car = () => app.car;
    const level = { 0: 'off', 1: 'low', 2: 'med', 3: 'high' };
    return [
      { key: 'lock', label: 'Lock', icon: 'lock', layouts: ['glance', 'tiles'],
        act: () => car().set('doors.locked', !car().v['doors.locked']),
        state: () => { const l = car().v['doors.locked']; return { on: !!l, icon: l ? 'lock' : 'unlock', text: l ? 'locked' : 'unlocked', live: car().liveIds.has('doors.locked') }; } },
      { key: 'seat', label: 'Seat', icon: 'seatheat', layouts: ['glance', 'tiles'], title: 'Driver seat heat: tap to step through off, low, medium, high',
        act: () => car().set('seat.FL.heat', ((car().v['seat.FL.heat'] || 0) + 1) % 4),
        state: () => { const h = car().v['seat.FL.heat'] || 0; return { heat: h > 0, text: level[h], live: car().liveIds.has('seat.FL.heat') }; } },
      { key: 'wheel', label: 'Wheel', icon: 'wheelheat', layouts: ['glance'], title: 'Heated steering wheel (the car does not report whether it is on)',
        act: () => car().set('climate.wheel', true), state: () => ({ text: '' }) },
      { key: 'defrost', label: 'Defrost', icon: 'defrostF', layouts: ['glance', 'tiles'],
        act: () => car().set('climate.defrostF', !car().v['climate.defrostF']),
        state: () => { const d = !!car().v['climate.defrostF']; return { on: d, text: d ? 'on' : 'off', live: car().liveIds.has('climate.defrostF') }; } },
      { key: 'car', label: 'Car', icon: 'car', layouts: ['glance', 'tiles'], title: 'Car controls', act: () => car().enter() },
      { key: 'map', label: 'Map', icon: 'map', layouts: ['tiles'], title: 'Show the 2D map over the tiles',
        act: () => { const on = document.documentElement.dataset.hlmap === 'on'; document.documentElement.dataset.hlmap = on ? 'off' : 'on'; },
        state: () => ({ on: document.documentElement.dataset.hlmap === 'on' }) },
      { key: 'music', label: 'Music', icon: 'music', layouts: ['tiles'], title: 'Show what is playing',
        act: () => { const on = document.documentElement.dataset.hlmusic === 'on'; document.documentElement.dataset.hlmusic = on ? 'off' : 'on'; },
        state: () => ({ on: document.documentElement.dataset.hlmusic === 'on' }) },
      { key: 'view', label: 'View', icon: 'camera', layouts: ['glance', 'tiles'], title: 'Camera angle', act: () => this._showViewMenu() },
      { key: 'camera', label: 'Camera', icon: 'video', layouts: ['glance', 'tiles'], parkedOnly: true, title: 'The comma\'s camera (parked only)',
        act: () => { if (app.roadcam.isOpen) app.roadcam.close(); else app.roadcam.open(app.settings.roadcam); },
        state: () => ({ on: app.roadcam.isOpen }) },
      { key: 'comma', label: 'Comma', icon: 'comma', layouts: ['glance', 'tiles'], parkedOnly: true, title: 'Manage the comma (parked only)',
        act: () => app.ui.open('comma'), state: () => ({ text: app.commaConnected ? 'live' : '' }) },
      { key: 'replay', label: 'Replay', icon: 'replay', layouts: ['glance'], parkedOnly: true, title: 'Recorded drives (parked only)',
        act: () => app.ui.open('playback') },
      { key: 'settings', label: 'Settings', icon: 'gear', layouts: ['glance', 'tiles'], act: () => app.ui.open() },
    ];
  }

  _press(b) {
    this._showViewMenu(false);
    if (b.parkedOnly && this.driving) { this.app.toast(PARKED_ONLY); return; }
    try { b.act(); } catch (e) { this.app.reportError(e); }
    this._tick(true);
  }

  // the camera-angle menu (index.html #viewmenu, main.js bindViewdock) lives under the View button in these layouts
  _showViewMenu(on) {
    const menu = $('#viewmenu');
    if (!menu) return;
    const want = on === undefined ? menu.classList.contains('hidden') : on;
    if (this.layout === 'classic') return;
    setClass(menu, 'hidden', !want);
    const view = this.buttons.get('view');
    if (view) setClass(view.node, 'on', want);
  }

  // ---- the layout -------------------------------------------------------------------------------------------------
  /** Put the page into the layout the settings ask for (main.js setSetting). */
  apply() {
    const want = (LAYOUTS.find(l => l[0] === this.app.settings.layout) || LAYOUTS[0])[0];
    if (want === this.layout) return;
    this._restore();
    this.layout = want;
    document.documentElement.dataset.layout = want;
    if (want !== 'classic') {
      for (const sel of STRIP_PARTS) this._move(sel, this.slots[sel]);
      for (const sel of BAND_PARTS) this._move(sel, this.band);
      const view = this.buttons.get('view');
      this._move('#viewmenu', view.node.querySelector('.hl-viewslot'));
      $('#viewmenu')?.classList.add('hidden');
      const barLay = (want === 'mapcenter' || want === 'native') ? 'glance' : want;   // Map Centre and Ocean Native carry the glance bar
      for (const { def, node } of this.buttons.values()) setClass(node, 'hidden', !def.layouts.includes(barLay));
    }
    // Map Centre shows the 2D street map (minimap) as the whole centre and hides the 3D scene (CSS), so no camera
    // lock is needed; make sure any earlier lock is cleared.
    if (this.app.scene.viewLocked) { this.app.scene.viewLocked = false; this.app.setView(this.app.settings.view, true); }
    this.manualPage = null;
    this.tilesBox.replaceChildren();
    this.tiles.clear();
    this.page = null;
    this.app.scene.resize();
    this.app.updateLayout();
    this._tick(true);
  }

  _move(sel, into) {
    const node = $(sel);
    if (!node || !node.parentNode) return;
    const parent = node.parentNode;
    this.moved.push({ node, parent, index: Array.prototype.indexOf.call(parent.childNodes, node) });
    into.append(node);
  }

  _restore() {
    const items = this.moved.splice(0).sort((a, b) => (a.parent === b.parent ? a.index - b.index : 0));
    for (const { node, parent, index } of items) {
      try { parent.insertBefore(node, parent.childNodes[index] || null); } catch { parent.append(node); }
    }
  }

  // ---- every frame ------------------------------------------------------------------------------------------------
  frame(state, settings, now) {
    this.state = state;
    this.settings = settings;
    if (now - this.lastTick < TICK_MS) return;
    this.lastTick = now;
    this._tick();
  }

  _tick(force = false) {
    const state = this.state, app = this.app;
    const ds = drivingState(state);
    if (ds.driving !== this.driving || force) {
      this.driving = ds.driving;
      document.documentElement.dataset.driving = ds.driving ? 'true' : 'false';
    }
    if (this.layout === 'classic') return;
    const cs = app.carState, unit = app.hud.unitFor(this.settings || app.settings, state && state.fisker);
    const ch = chargeOf(cs), range = rangeOf(cs, unit);
    // the band: a charge line while parked and plugged in (the alerts and the next turn are in the band themselves)
    const line = ds.driving ? '' : chargeLine(ch, range);
    setClass(this.charge, 'hidden', !line);
    if (line) setText(this.charge.lastChild, line);
    // the bar's states
    for (const { def, node } of this.buttons.values()) {
      const st = def.state ? def.state() : {};
      setClass(node, 'on', !!st.on);
      setClass(node, 'heat', !!st.heat);
      setClass(node, 'off', !!def.parkedOnly && ds.driving);
      if (st.icon) { const i = node.firstElementChild; if (i.dataset.icon !== st.icon) { i.innerHTML = icon(st.icon); i.dataset.icon = st.icon; } }
      setText(node.querySelector('small'), def.parkedOnly && ds.driving ? 'parked only' : (st.text || ''));
    }
    if (this.layout === 'tiles') this._tiles(ds, ch, range, unit);
  }

  // ---- the tile dash ----------------------------------------------------------------------------------------------
  _tiles(ds, ch, range, unit) {
    const state = this.state || {}, app = this.app, cs = app.carState, car = app.car;
    const op = state.op || {}, f = state.fisker;
    const engaged = !!((f && f.acc && f.acc.engaged) || (op.carState && op.carState.cruise && op.carState.cruise.enabled) || (op.carControl && op.carControl.latActive) || (op.selfdriveState && op.selfdriveState.enabled));
    const auto = autoPage({ driving: ds.driving, plugged: !!(ch && ch.plugged), assist: engaged });
    const page = pageFor(auto, this.manualPage, this.autoPrev);
    if (auto !== this.autoPrev) { this.autoPrev = auto; this.manualPage = null; }
    const shown = pageFor(auto, this.manualPage, this.autoPrev);
    if (shown !== this.page) this._buildPage(shown);
    for (const b of $$('.hl-page', this.pages)) { setClass(b, 'on', b.dataset.page === shown); b.setAttribute('aria-selected', String(b.dataset.page === shown)); }
    void page;
    const metric = unit === 'kmh';
    const v = ds.v;
    const kw = f && f.power ? (f.power.kw != null ? f.power.kw : f.power.demandKw) : (ch && ch.kw != null ? -ch.kw : null);
    const lead = leadOf(state, v);
    const temp = f && f.vehicle && f.vehicle.outsideTempC;
    const trip = tripOf(cs, unit), odo = odometerOf(cs, unit);
    const lim = $('#limit'), limText = lim && !lim.classList.contains('hidden') ? (lim.querySelector('b') || lim).textContent : '';
    const set = $('#setspeed-val')?.textContent || '--';
    const bars = $$('#gap i.on').length;
    const assist = $('#assist-text')?.textContent || '';
    const ahead = op.liveMapDataSP && op.liveMapDataSP.speedLimitAhead > 0 ? op.liveMapDataSP : null;
    const conv = metric ? 3.6 : 2.236936;
    const doors = car.v['doors.open'] || [];
    const vals = {
      range: range ? [String(range.value), range.unit, range.valid === false ? 'estimate not valid' : `${ch && ch.soc != null ? ch.soc + ' %' : ''}`] : ['--', '', 'not reported'],
      power: kw != null ? [kw >= 0 ? Math.round(kw).toString() : `−${Math.round(-kw)}`, 'kW', kw < -0.3 ? 'regenerating' : 'driving'] : ['--', 'kW', ''],
      lead: lead ? [Math.round(lead.dist).toString(), 'm', `${lead.gap.toFixed(1)} s${Math.abs(lead.closing) > 0.5 ? ` · ${lead.closing > 0 ? 'closing' : 'opening'} ${Math.round(Math.abs(lead.closing) * conv)} ${metric ? 'km/h' : 'mph'}` : ''}`] : ['--', '', 'no car ahead'],
      soc: ch && ch.soc != null ? [String(ch.soc), '%', ''] : ['--', '%', 'not reported'],
      outside: temp != null ? [String(Math.round(metric ? temp : temp * 9 / 5 + 32)), metric ? '°C' : '°F', ''] : ['--', '', ''],
      trip: trip ? [trip.dist, trip.unit, trip.eff ? `${trip.eff} ${trip.effUnit}` : ''] : ['--', '', 'not reported'],
      set: [set, '', engaged ? 'engaged' : 'off'],
      gap: [bars ? String(bars) : '--', '', 'following distance'],
      steer: [assist || 'Off', '', ''],
      limit: [limText || '--', '', 'camera'],
      ahead: ahead ? [String(Math.round(ahead.speedLimitAhead * conv)), '', `in ${Math.round(ahead.speedLimitAheadDistance || 0)} m`] : ['--', '', 'needs the comma'],
      charge: ch && ch.plugged ? [ch.charging ? ch.kw.toFixed(1) : '0', 'kW', ch.charging ? 'charging' : 'plugged in, not charging'] : ['--', 'kW', 'not plugged in'],
      left: ch && ch.charging && ch.leftMin != null ? [fmtMinutes(ch.leftMin), '', 'to the limit'] : ['--', '', ''],
      odo: odo ? [odo.value.toLocaleString(), odo.unit, 'odometer'] : ['--', '', 'not reported'],
      v12: ['--', 'V', 'not on the bus yet'],
      doors: [doors.length ? String(doors.length) : 'All', '', doors.length ? doors.map(d => d.replace('Door_', '').replace('_', ' ').toLowerCase()).join(', ') + ' open' : 'closed'],
      lock: [car.v['doors.locked'] ? 'Locked' : 'Open', '', car.liveIds.has('doors.locked') ? '' : 'mockup'],
      comma: [app.commaConnected ? 'Live' : 'Off', '', app.commaConnected ? 'connected' : 'not connected'],
    };
    for (const [key, t] of this.tiles) {
      const [val, u, sub] = vals[key] || ['--', '', ''];
      setText(t.v, val); setText(t.u, u); setText(t.sub, sub);
    }
    // the action tiles follow the bar
    for (const node of $$('.hl-tile.action', this.tilesBox)) {
      const b = this.buttons.get(node.dataset.key);
      if (!b || !b.def.state) continue;
      const st = b.def.state();
      setClass(node, 'on', !!st.on); setClass(node, 'heat', !!st.heat);
      setText(node.querySelector('.s'), st.text || '');
    }
  }

  _buildPage(page) {
    this.page = page;
    this.tilesBox.replaceChildren();
    this.tiles.clear();
    const stats = {
      drive: [['range', 'Range'], ['power', 'Power'], ['lead', 'Lead'], ['soc', 'Battery'], ['outside', 'Outside'], ['trip', 'Trip']],
      assist: [['set', 'Set speed'], ['gap', 'Gap'], ['steer', 'Steering'], ['lead', 'Lead'], ['limit', 'Speed limit'], ['ahead', 'Limit ahead']],
      charge: [['soc', 'Battery'], ['charge', 'Charging'], ['left', 'Time left'], ['range', 'Range'], ['odo', 'Odometer'], ['v12', '12 V battery']],
      park: [['doors', 'Doors'], ['lock', 'Locks'], ['outside', 'Outside'], ['soc', 'Battery'], ['odo', 'Odometer'], ['comma', 'Comma']],
    }[page];
    for (const [key, label] of stats) {
      const v = el('b'), u = el('small'), sub = el('div.s');
      const node = el('div.hl-tile', { dataset: { key } }, el('div.l', label), el('div.v', v, u), sub);
      if (key === 'v12') node.classList.add('dim');
      this.tiles.set(key, { node, v, u, sub });
      this.tilesBox.append(node);
    }
    for (const key of ['seat', 'defrost', 'lock']) {
      const b = this.buttons.get(key);
      const node = el('button.hl-tile.action', { type: 'button', dataset: { key }, onclick: () => this._press(b.def) },
        el('i', { html: icon(b.def.icon) }), el('div', el('div.v', b.def.label), el('div.s')));
      this.tilesBox.append(node);
    }
  }
}
