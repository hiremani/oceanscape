// The sun from the clock and the GPS (scene.js lighting, main.js Auto theme), by NOAA's solar position equations
// (the NOAA solar calculator spreadsheet's; good to about a tenth of a degree for this century). No DOM here, so
// Node tests it (tests/sun.test.js).

const RAD = Math.PI / 180;

/** The sun at `date` seen from lat, lon (degrees): {elevation, azimuth} in degrees, azimuth clockwise from north.
 *  Elevation includes atmospheric refraction near the horizon. */
export function sunPosition(date, lat, lon) {
  const ms = date instanceof Date ? date.getTime() : Number(date);
  const jd = ms / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T))
    + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan(eps * RAD / 2) ** 2;
  const eot = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD)
    + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) - 0.5 * y * y * Math.sin(4 * L0 * RAD)
    - 1.25 * e * e * Math.sin(2 * M * RAD));   // equation of time, minutes
  const minutes = ((ms / 60000) % 1440 + 1440) % 1440;   // UTC minutes of the day
  const tst = ((minutes + eot + 4 * lon) % 1440 + 1440) % 1440;
  let ha = tst / 4 - 180;   // hour angle, degrees
  if (ha < -180) ha += 360;
  const phi = lat * RAD, h = ha * RAD;
  const cosZ = Math.min(1, Math.max(-1, Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(h)));
  const zenith = Math.acos(cosZ);
  let elevation = 90 - zenith / RAD;
  elevation += refraction(elevation);
  const az = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) / RAD + 180;
  return { elevation, azimuth: (az % 360 + 360) % 360 };
}

/** NOAA's refraction correction (degrees) for a true elevation (degrees). */
function refraction(el) {
  if (el > 85) return 0;
  const te = Math.tan(el * RAD);
  let r;
  if (el > 5) r = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (el > -0.575) r = 1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711)));
  else r = -20.772 / te;
  return r / 3600;
}

// Auto theme: night once the sun is this far below the horizon, day again once it's back above this (hysteresis, so
// the theme doesn't flip back and forth at dusk)
export const NIGHT_BELOW = -3, DAY_ABOVE = -1;

/** Night (true) or day after `wasNight`, with hysteresis. */
export function isNight(elevation, wasNight = false) {
  return wasNight ? elevation < DAY_ABOVE : elevation < NIGHT_BELOW;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The lights for a sun elevation: the sun's intensity and color (warmer when low), the sky light's intensity, and the
 *  angle above the horizon to light from (kept off grazing and off straight down, so shading always reads). */
export function sunLighting(elevation) {
  const day = smooth(-4, 14, elevation);
  const warm = 1 - smooth(2, 28, elevation);
  const lerp = (a, b, k) => Math.round(a + (b - a) * k);
  const color = (255 << 16) | (lerp(255, 190, warm) << 8) | lerp(255, 140, warm);
  return {
    sun: 0.45 + 1.15 * day,      // 1.6 in full day: the scene's fixed rig
    hemi: 1.0 + 0.6 * day,
    color,
    lightElevation: Math.min(70, Math.max(22, elevation)),
  };
}

/** Where to put the directional light (scene frame: X right, Y up, Z backward), `dist` from the car, for a sun at
 *  azimuth (deg from north, clockwise) and lighting elevation (deg), with the car heading `h` (rad, the pose frame's:
 *  0 = east, counter-clockwise). */
export function sunDirection(azimuth, elevation, h, dist = 18) {
  const enu = (90 - azimuth) * RAD;   // the sun's direction as an angle from east, counter-clockwise
  const rel = enu - h;                // ...from the car's nose, to its left
  const ce = Math.cos(elevation * RAD), se = Math.sin(elevation * RAD);
  const x = Math.cos(rel) * ce, yl = Math.sin(rel) * ce;   // car frame: x ahead, y left
  return [-yl * dist, se * dist, -x * dist];
}
