// The 2D map card: a heading-up street map that moves with the car, drawn on a canvas from the roads layer the worker
// already sends for the 3D road (state.js _roadsLayer), so it costs no download of its own. The road ahead from the map
// matcher is in the accent colour. It only draws: nothing here decides where the car is (world/pose.js) or which road
// it's on (world/mapmatch.js). Redrawn at the snapshots' rate, not every frame, to keep the 3D view's frame budget.
import { $, el, setClass, setText } from './util.js';
import { mapView, placeLabels, viewHalfMeters, viewTransform, wayLabel, wayStyle } from './minimap_geom.js';

const DRAW_MS = 100;
const COLOR_MS = 2000;   // how often to look at the theme's colours again
const FONT = '600 11px system-ui, sans-serif';

export class MiniMap {
  constructor() {
    this.canvas = el('canvas.mm-canvas');
    this.road = el('div.mm-road');
    this.status = el('div.mm-status');
    this.card = el('section.card.mapcard.hidden', { id: 'mapcard', 'aria-label': 'Map' }, this.canvas, this.status, this.road);
    $('#app').append(this.card);
    this.lastDraw = 0;
    this.lastColors = -Infinity;
    this.colors = null;
  }

  /** Called every frame with the snapshot being shown: draws at most every DRAW_MS. */
  update(state, settings, now = performance.now()) {
    const on = !settings || settings.miniMap !== false;
    const view = on ? mapView(state) : { mode: 'hidden', stale: false };
    setClass(this.card, 'hidden', view.mode === 'hidden');
    if (view.mode === 'hidden') return;
    if (now - this.lastDraw < DRAW_MS) return;
    this.lastDraw = now;
    setClass(this.card, 'stale', view.stale);
    setText(this.status, view.mode === 'loading' ? 'Loading map…' : view.stale ? 'GPS lost' : '');
    setText(this.road, view.mode === 'map' ? wayLabel(state.map.way) : '');
    if (view.mode === 'map') this._draw(state, now);
    else this._size();
  }

  _size() {
    const css = this.canvas.clientWidth;
    if (!css) return 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.round(css * dpr);
    if (this.canvas.width !== px) { this.canvas.width = px; this.canvas.height = px; }
    return css;
  }

  _palette(now) {
    if (this.colors && now - this.lastColors < COLOR_MS) return this.colors;
    this.lastColors = now;
    const css = getComputedStyle(document.documentElement);
    const v = (k, d) => css.getPropertyValue(k).trim() || d;
    const dark = document.documentElement.dataset.theme === 'dark';
    this.colors = {
      ground: dark ? '#1b1e24' : '#e8eaee',
      casing: dark ? '#0d0f12' : '#c3c8d0',
      road: dark ? '#3a3f49' : '#ffffff',
      text: v('--text', dark ? '#f1f3f6' : '#16181c'),
      halo: dark ? '#1b1e24' : '#ffffff',
      accent: v('--accent', '#3e6ae1'),
      signal: '#d8241c',
    };
    return this.colors;
  }

  _draw(state, now) {
    const size = this._size();
    if (!size) return;
    const ctx = this.canvas.getContext('2d');
    const col = this._palette(now);
    const pose = state.pose, map = state.map;
    const scale = this.canvas.width / size;
    const t = viewTransform(pose, size, viewHalfMeters(pose.v));
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = col.ground;
    ctx.fillRect(0, 0, size, size);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const ways = map.roads.ways.map((w) => {
      const s = wayStyle(w.className, t.pxPerM);
      return { label: wayLabel(w), order: s.order, width: s.width, pts: w.pts.map(p => t.project(p[0], p[1])) };
    }).sort((a, b) => a.order - b.order);
    const trace = (pts) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    };
    // the casing under every road first, so that junctions join up
    ctx.strokeStyle = col.casing;
    for (const w of ways) { ctx.lineWidth = w.width + 2; trace(w.pts); ctx.stroke(); }
    ctx.strokeStyle = col.road;
    for (const w of ways) { ctx.lineWidth = w.width; trace(w.pts); ctx.stroke(); }

    // the road ahead the matcher follows, from the car on
    if (map.horizon && map.horizon.length > 1) {
      const from = Math.max(0, map.carIndex || 0);
      const ahead = map.horizon.slice(from).map(p => t.project(p[0], p[1]));
      if (ahead.length > 1) {
        ctx.strokeStyle = col.accent;
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 4;
        trace(ahead);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // traffic signals
    ctx.fillStyle = col.signal;
    for (const f of map.roads.features || []) {
      if (f.kind !== 'signal') continue;
      const [x, y] = t.project(f.x, f.y);
      if (x < 0 || x > size || y < 0 || y > size) continue;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.fill();
    }

    // street names
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = col.halo;
    ctx.fillStyle = col.text;
    for (const l of placeLabels(ways, size, { skip: wayLabel(map.way), avoid: [t.cx, t.cy] })) {
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.angle);
      ctx.strokeText(l.text, 0, 0);
      ctx.fillText(l.text, 0, 0);
      ctx.restore();
    }

    this._drawNorth(ctx, size, t.northAngle, col);
    this._drawCar(ctx, t.cx, t.cy, col);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  _drawNorth(ctx, size, angle, col) {
    ctx.save();
    ctx.translate(size - 18, 18);
    ctx.fillStyle = col.road;
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, 2 * Math.PI);
    ctx.fill();
    ctx.rotate(angle);
    ctx.fillStyle = col.signal;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(4, 0);
    ctx.lineTo(-4, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = col.text;
    ctx.beginPath();
    ctx.moveTo(0, 9);
    ctx.lineTo(4, 0);
    ctx.lineTo(-4, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawCar(ctx, x, y, col) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = col.accent;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(8, 9);
    ctx.lineTo(0, 5);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
