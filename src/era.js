import * as THREE from 'three';

// How the model *looks* at a given year. Not a filter for its own sake: early
// stops are hazier and warmer because that is how the period is pictured, and
// the light cools and clears as the century goes on.
const STOPS = [
  { y: 1850, sky: '#d8c9a8', sun: '#ffdca8', amb: '#9c8a63', sat: 0.70, warm: 0.30, vig: 0.42, haze: 0.150, label: 'a river town' },
  { y: 1888, sky: '#dccdab', sun: '#ffe0b0', amb: '#a08e68', sat: 0.74, warm: 0.26, vig: 0.40, haze: 0.120, label: 'the Capitol opens' },
  { y: 1915, sky: '#dfd3b6', sun: '#ffe6bd', amb: '#a5957a', sat: 0.80, warm: 0.20, vig: 0.37, haze: 0.095, label: 'streetcars and dams' },
  { y: 1939, sky: '#e2d7bd', sun: '#ffeac6', amb: '#a2977f', sat: 0.86, warm: 0.16, vig: 0.34, haze: 0.075, label: 'the New Deal city' },
  { y: 1958, sky: '#e6dcc4', sun: '#fff0d2', amb: '#a49a84', sat: 0.95, warm: 0.12, vig: 0.32, haze: 0.058, label: 'interstate and suburbs' },
  { y: 1975, sky: '#e7dfcb', sun: '#fff2da', amb: '#a49d8b', sat: 1.02, warm: 0.08, vig: 0.31, haze: 0.046, label: 'the university town' },
  { y: 1990, sky: '#e9e2d3', sun: '#fff4e2', amb: '#a69f90', sat: 1.08, warm: 0.05, vig: 0.30, haze: 0.038, label: 'silicon hills' },
  { y: 2008, sky: '#e9e3d6', sun: '#fff6e8', amb: '#a8a294', sat: 1.14, warm: 0.02, vig: 0.30, haze: 0.030, label: 'the condo boom' },
  { y: 2026, sky: '#eae4d8', sun: '#fff8ee', amb: '#aaa598', sat: 1.18, warm: 0.00, vig: 0.30, haze: 0.024, label: 'now' },
];
for (const s of STOPS) { s.cSky = new THREE.Color(s.sky); s.cSun = new THREE.Color(s.sun); s.cAmb = new THREE.Color(s.amb); }

export const FIRST_YEAR = 1847, LAST_YEAR = 2026;

const out = { cSky: new THREE.Color(), cSun: new THREE.Color(), cAmb: new THREE.Color(), sat: 1, warm: 0, vig: .3, haze: .1, label: '' };
export function eraAt(year) {
  let i = 0;
  while (i < STOPS.length - 2 && STOPS[i + 1].y < year) i++;
  const a = STOPS[i], b = STOPS[i + 1];
  const t = THREE.MathUtils.clamp((year - a.y) / (b.y - a.y), 0, 1);
  const s = t * t * (3 - 2 * t);
  out.cSky.copy(a.cSky).lerp(b.cSky, s);
  out.cSun.copy(a.cSun).lerp(b.cSun, s);
  out.cAmb.copy(a.cAmb).lerp(b.cAmb, s);
  out.sat = a.sat + (b.sat - a.sat) * s;
  out.warm = a.warm + (b.warm - a.warm) * s;
  out.vig = a.vig + (b.vig - a.vig) * s;
  out.haze = a.haze + (b.haze - a.haze) * s;
  out.label = (t < 0.5 ? a : b).label;
  return out;
}

// What moves in the street, by year. Traffic is a curve, not a switch: the
// horse era thins out through the 1910s while cars climb, and both are slow
// until the roads are paved.
export function trafficAt(year) {
  const horse = THREE.MathUtils.clamp((1925 - year) / 45, 0, 1) * THREE.MathUtils.clamp((year - 1845) / 15, 0, 1);
  const car = THREE.MathUtils.clamp((year - 1905) / 35, 0, 1);
  const growth = THREE.MathUtils.clamp((year - 1870) / 150, 0.04, 1);
  return {
    horse, car,
    carSpeed: 9 + 13 * THREE.MathUtils.clamp((year - 1915) / 50, 0, 1),
    density: 0.10 + 0.90 * growth * growth,
    pedDensity: 0.25 + 0.75 * THREE.MathUtils.clamp((year - 1860) / 120, 0, 1),
    buses: THREE.MathUtils.clamp((year - 1940) / 20, 0, 1),
  };
}

/* ---------------------------------------------------------------- daylight
 * The hour of the day, as light rather than as a clock. Sun elevation peaks
 * at 13:00 and the sky runs from a cold dawn through white noon to a low warm
 * evening and then out. `night` is the blend that switches the city on: it
 * starts to rise before the sun is actually down, because windows come on at
 * dusk, not at darkness. */
const DAY = [
  { h: 4.0,  sky: '#1d2740', sun: '#3f5378', amb: '#141d33', I: 0.16, A: 0.46, night: 1.00 },
  { h: 6.2,  sky: '#5d6a86', sun: '#c98d6a', amb: '#3a4560', I: 0.55, A: 0.55, night: 0.72 },
  { h: 7.5,  sky: '#b9bfc4', sun: '#ffd0a0', amb: '#8a8f9a', I: 1.45, A: 0.80, night: 0.28 },
  { h: 10.0, sky: '#d9e0e4', sun: '#fff0dc', amb: '#a8b0b8', I: 2.25, A: 0.95, night: 0.02 },
  { h: 13.0, sky: '#e4e8e6', sun: '#fff8ee', amb: '#b2b6b4', I: 2.55, A: 1.00, night: 0.00 },
  { h: 16.5, sky: '#e2ddd0', sun: '#ffeed4', amb: '#aca69a', I: 2.20, A: 0.95, night: 0.03 },
  { h: 18.6, sky: '#dcc0a2', sun: '#ffc384', amb: '#8f7f72', I: 1.35, A: 0.78, night: 0.34 },
  { h: 19.8, sky: '#9c7f83', sun: '#e2794f', amb: '#584c56', I: 0.62, A: 0.55, night: 0.72 },
  { h: 21.0, sky: '#33405e', sun: '#5a6a92', amb: '#1e2740', I: 0.24, A: 0.50, night: 0.96 },
  { h: 24.0, sky: '#1d2740', sun: '#3f5378', amb: '#141d33', I: 0.16, A: 0.46, night: 1.00 },
];
for (const d of DAY) { d.cSky = new THREE.Color(d.sky); d.cSun = new THREE.Color(d.sun); d.cAmb = new THREE.Color(d.amb); }

const dayOut = { cSky: new THREE.Color(), cSun: new THREE.Color(), cAmb: new THREE.Color(),
                 I: 1, A: 1, night: 0, elev: 0, azim: 0 };
export function dayAt(hour) {
  const h = THREE.MathUtils.clamp(hour, DAY[0].h, 24);
  let i = 0;
  while (i < DAY.length - 2 && DAY[i + 1].h < h) i++;
  const a = DAY[i], b = DAY[i + 1];
  const t = THREE.MathUtils.clamp((h - a.h) / (b.h - a.h), 0, 1), s = t * t * (3 - 2 * t);
  dayOut.cSky.copy(a.cSky).lerp(b.cSky, s);
  dayOut.cSun.copy(a.cSun).lerp(b.cSun, s);
  dayOut.cAmb.copy(a.cAmb).lerp(b.cAmb, s);
  dayOut.I = a.I + (b.I - a.I) * s;
  dayOut.A = a.A + (b.A - a.A) * s;
  dayOut.night = a.night + (b.night - a.night) * s;
  // The sun tracks east to west and peaks at 13:00; below the horizon it is
  // held just above so the moonlight still has a direction to come from.
  const dayT = THREE.MathUtils.clamp((h - 6.4) / (19.4 - 6.4), 0, 1);
  dayOut.elev = Math.max(0.10, Math.sin(dayT * Math.PI) * 1.02) * (Math.PI / 2) * 0.62;
  dayOut.azim = (-0.62 + dayT * 2.4);
  return dayOut;
}
