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
