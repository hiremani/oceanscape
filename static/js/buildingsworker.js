// Fetches and builds one building cell (buildgeom.js) off the page's thread for buildings.js: {key, klat, klon} in;
// {key, status, near, far} back, `near` every building and `far` only the big or tall ones, each {position, normal,
// shade, tris} with the buffers handed over rather than copied. status: 'ok', 'missing' (the server has no buildings
// for the cell, or doesn't serve them), or 'failed' (try again later).
import { parseBuildings, lodFilter, extrude } from './buildgeom.js';

const FAR_MIN_AREA = 120;   // m^2: what the far version keeps (plus anything 15 m or taller)

self.onmessage = async (e) => {
  const { key, klat, klon } = e.data;
  let res;
  try {
    res = await fetch(`/map/buildings/${klat}/${klon}`);
  } catch (err) {
    self.postMessage({ key, status: 'failed', error: String(err) });
    return;
  }
  if (res.status === 404) { self.postMessage({ key, status: 'missing' }); return; }
  if (!res.ok) { self.postMessage({ key, status: 'failed', error: `HTTP ${res.status}` }); return; }
  let answer;
  try { answer = await res.json(); } catch (err) { self.postMessage({ key, status: 'failed', error: 'bad JSON' }); return; }
  const all = parseBuildings(answer, klat, klon);
  const near = extrude(all), far = extrude(lodFilter(all, FAR_MIN_AREA));
  const buffers = [near.position.buffer, near.normal.buffer, near.shade.buffer, far.position.buffer, far.normal.buffer, far.shade.buffer];
  self.postMessage({ key, status: 'ok', count: all.length, near, far }, buffers);
};
