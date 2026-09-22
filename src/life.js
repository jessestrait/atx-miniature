import * as THREE from 'three';
import { DRIVABLE, hash } from './city.js';
import { trafficAt } from './era.js';

/* Everything that moves. Three instanced meshes — vehicles, pedestrians,
 * buses — each a fixed pool sized once. Per frame, a share of each pool is
 * active based on the year: 1870 has a handful of wagons on the few streets
 * that exist, 2026 has the full deck. Inactive instances are parked at a
 * scale of zero rather than being removed, so no buffer ever regrows. */

const LANE = { motorway: 4.5, trunk: 3.6, primary: 3.2, secondary: 2.8, tertiary: 2.4, street: 1.8 };
const CAR_COLORS = ['#d9d4cb','#2e3338','#8d939a','#7c2f2a','#243a52','#5d6b56','#b8b2a6','#3d4550','#94553a','#c9c2b4'];
const HORSE_COLORS = ['#4a3b2e','#5c4a38','#33291f','#6b5642'];
const PED_COLORS = ['#3a4550','#5d4a3c','#2f3b33','#6b5a48','#44404d','#7a6a58','#39424b'];

const ROAD_HALF = { motorway: 9, trunk: 7, primary: 6.5, secondary: 5.5, tertiary: 4.5, street: 3.5, service: 1.7, path: .9 };

function makePath(pts, extra) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i-1] + pts[i].distanceTo(pts[i-1]));
  const L = cum[cum.length - 1];
  return L < 40 ? null : Object.assign({ pts, cum, L }, extra);
}

function buildPaths(model, city, drivable) {
  // One path per road piece, in world space, with its year and a lane offset.
  const paths = [];
  for (const r of model.roads) {
    if (drivable !== DRIVABLE.has(r.c)) continue;
    if (r.p.length < 3) continue;
    const pts = r.p.map(p => new THREE.Vector3(p[0], city.y(p[2]), -p[1]));
    const pa = makePath(pts, { year: r.y || 1875, cls: r.c, lane: LANE[r.c] || 1.6,
      weight: drivable ? (r.c === 'motorway' || r.c === 'trunk' ? 4 : r.c === 'primary' || r.c === 'secondary' ? 3 : 1) : 1 });
    if (pa) paths.push(pa);
  }
  return paths;
}

/* Sidewalks. OSM tags footway=sidewalk on only a fraction of downtown and the
 * build script drops those anyway, so people would end up walking the hike
 * and bike trail and nowhere else. Instead offset every street centreline to
 * both kerbs: two walking lines per street, which is what a sidewalk is. */
function buildSidewalks(model, city) {
  const out = [];
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), off = new THREE.Vector3();
  for (const r of model.roads) {
    if (!DRIVABLE.has(r.c) || r.b) continue;          // no pavement on a viaduct
    if (r.p.length < 3) continue;
    const half = (ROAD_HALF[r.c] || 3.5) + 2.2;
    for (const side of [1, -1]) {
      const pts = [];
      for (let i = 0; i < r.p.length; i++) {
        const p = r.p[i], a = r.p[Math.max(i - 1, 0)], b = r.p[Math.min(i + 1, r.p.length - 1)];
        dir.set(b[0] - a[0], 0, -(b[1] - a[1]));
        if (dir.lengthSq() < 1e-9) continue;
        dir.normalize();
        off.crossVectors(up, dir).multiplyScalar(half * side);
        pts.push(new THREE.Vector3(p[0] + off.x, city.y(p[2]), -p[1] + off.z));
      }
      if (pts.length < 3) continue;
      const pa = makePath(pts, { year: r.y || 1875, cls: 'sidewalk', lane: 0,
        weight: r.c === 'primary' || r.c === 'secondary' ? 3 : r.c === 'street' ? 2 : 1 });
      if (pa) out.push(pa);
    }
  }
  return out;
}

class Pool {
  constructor(geo, mat, count, paths, opts) {
    this.opts = opts;
    // Sorted oldest first, so "every street that exists in year Y" is a prefix
    // of the array and a binary search gives its length.
    this.paths = paths.slice().sort((a, b) => a.year - b.year);
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.castShadow = true; this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Cumulative weights, so a pick inside the first n paths stays weighted.
    // Weight falls off away from the middle of the model: downtown blocks
    // should look busy while the edges stay quiet, which is also true.
    this.cum = new Float64Array(this.paths.length);
    let acc = 0;
    this.paths.forEach((p, i) => {
      const m = p.pts[(p.pts.length / 2) | 0];
      const d = Math.hypot(m.x, m.z);
      p.w = p.weight * (1 / (1 + d / 520));
      acc += p.w; this.cum[i] = acc;
    });
    this.items = [];
    for (let i = 0; i < count; i++) {
      const it = { p: null, s: 0, dir: hash(i * 11.3) > .5 ? 1 : -1,
                   vj: .75 + hash(i * 5.9) * .5, seed: i, r: hash(i * 3.7 + 1) };
      this.place(it, this.paths.length, hash(i * 7.1));
      this.items.push(it);
    }
    this._m = new THREE.Matrix4(); this._p = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(); this._f = new THREE.Vector3(); this._lm = new THREE.Matrix4();
    this._up = new THREE.Vector3(0, 1, 0); this._o = new THREE.Vector3();
  }
  /** Put an item on a weighted-random path drawn from the first n (oldest n). */
  place(it, n, at) {
    n = Math.max(1, Math.min(n, this.paths.length));
    const total = this.cum[n - 1];
    let lo = 0, hi = n - 1, t = (at ?? Math.random()) * total;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.cum[mid] < t) lo = mid + 1; else hi = mid; }
    it.p = this.paths[lo];
    it.s = (at ?? Math.random()) * it.p.L;
    return it;
  }
  /** Number of paths already built in the given year (the array is sorted). */
  builtBy(year) {
    let lo = 0, hi = this.paths.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.paths[mid].year <= year) lo = mid + 1; else hi = mid; }
    return lo;
  }

  setColors(pick) {
    const c = new THREE.Color();
    for (let i = 0; i < this.items.length; i++) { c.set(pick(i)); this.mesh.setColorAt(i, c); }
    this.mesh.instanceColor.needsUpdate = true;
  }
  /** share 0..1 of the pool that should be alive; year gates by road age. */
  step(dt, year, share, speed, timeline) {
    const n = this.items.length, live = Math.round(n * THREE.MathUtils.clamp(share, 0, 1));
    // Traffic moves onto the streets that exist rather than vanishing with
    // them, so 1890 shows a few wagons on the few blocks that are there
    // instead of an empty grid.
    const built = timeline ? this.builtBy(year) : this.paths.length;
    if (built < 1) { this.mesh.count = 0; this.mesh.instanceMatrix.needsUpdate = true; return; }
    this.mesh.count = this.items.length;
    for (let i = 0; i < n; i++) {
      const it = this.items[i];
      if (i < live && timeline && it.p.year > year) this.place(it, built, hash(i + year * .37));
      const on = i < live;
      if (!on) { this._m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this._m); continue; }
      it.s += speed * it.vj * it.dir * dt;
      if (it.s > it.p.L) { it.s = it.p.L; it.dir = -1; }
      if (it.s < 0) { it.s = 0; it.dir = 1; }
      const cum = it.p.cum;
      let j = 1; while (j < cum.length - 1 && cum[j] < it.s) j++;
      const t = (it.s - cum[j-1]) / Math.max(1e-6, cum[j] - cum[j-1]);
      this._p.lerpVectors(it.p.pts[j-1], it.p.pts[j], t);
      this._f.subVectors(it.p.pts[j], it.p.pts[j-1]).multiplyScalar(it.dir);
      if (this._f.lengthSq() < 1e-9) this._f.set(0, 0, 1);
      this._f.normalize();
      // shift onto the right-hand lane
      this._o.crossVectors(this._up, this._f).normalize().multiplyScalar(it.p.lane * (this.opts.lane ?? 1) * it.dir);
      this._p.add(this._o);
      this._p.y += this.opts.lift;
      this._lm.lookAt(this._f, new THREE.Vector3(), this._up);
      this._q.setFromRotationMatrix(this._lm);
      const bob = this.opts.bob ? 1 + Math.sin(performance.now() * .009 + it.seed) * this.opts.bob : 1;
      this._s.set(1, bob, 1);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Life {
  constructor(model, city, opts = {}) {
    this.city = city;
    this.group = new THREE.Group();
    const density = opts.density ?? 1;
    const drive = buildPaths(model, city, true);
    const trails = buildPaths(model, city, false).filter(p => p.cls === 'path');
    const walk = buildSidewalks(model, city).concat(trails);

    // --- cars: a body with a slightly narrower cabin on top
    const carGeo = boxCluster([[0, .75, 0, 2.0, 1.5, 4.4], [0, 1.75, -.25, 1.7, .95, 2.3]]);
    this.cars = new Pool(carGeo, new THREE.MeshStandardMaterial({ roughness: .45, metalness: .15 }),
                         Math.round(620 * density), drive, { lift: .9, lane: 1 });
    this.cars.setColors(i => CAR_COLORS[Math.floor(hash(i * 4.4) * CAR_COLORS.length)]);
    this.group.add(this.cars.mesh);

    // --- horse traffic: a small dark cart, used before the cars take over
    const horseGeo = boxCluster([[0, .7, .4, 1.3, 1.1, 2.4], [0, .85, -1.2, .7, 1.3, 1.5]]);
    this.horses = new Pool(horseGeo, new THREE.MeshStandardMaterial({ roughness: .9 }),
                           Math.round(260 * density), drive, { lift: .8, lane: .9, bob: .05 });
    this.horses.setColors(i => HORSE_COLORS[Math.floor(hash(i * 6.2) * HORSE_COLORS.length)]);
    this.group.add(this.horses.mesh);

    // --- pedestrians: a capsule, bobbing as it walks
    const pedGeo = new THREE.CapsuleGeometry(.34, 1.05, 3, 6); pedGeo.translate(0, .86, 0);
    this.peds = new Pool(pedGeo, new THREE.MeshStandardMaterial({ roughness: .9 }),
                         Math.round(1500 * density), walk.length > 20 ? walk : drive, { lift: .5, lane: 0, bob: .09 });
    this.peds.setColors(i => PED_COLORS[Math.floor(hash(i * 8.8) * PED_COLORS.length)]);
    this.group.add(this.peds.mesh);

    this.buildBuses(model);
  }

  buildBuses(model) {
    const paths = [];
    for (const r of model.routes || []) for (const seg of r.segs) {
      const pts = seg.map(p => new THREE.Vector3(p[0], this.city.y(p[2]), -p[1]));
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i-1] + pts[i].distanceTo(pts[i-1]));
      const L = cum[cum.length - 1];
      if (L < 200) continue;
      paths.push({ pts, cum, L, year: 1940, cls: 'bus', lane: 1.6, weight: 1, color: r.color });
    }
    if (!paths.length) { this.buses = null; return; }
    const geo = boxCluster([[0, 1.6, 0, 2.7, 3.0, 12.0], [0, 3.15, .4, 2.4, .35, 10.6]]);
    this.buses = new Pool(geo, new THREE.MeshStandardMaterial({ roughness: .5 }),
                          Math.min(90, paths.length), paths, { lift: 1.0, lane: 1 });
    this.buses.setColors(i => this.buses.items[i].p.color || '#2f6fb0');
    this.group.add(this.buses.mesh);
  }

  setVisible(v) { this.group.visible = v; }

  update(dt, year, timeline) {
    const T = trafficAt(timeline ? year : 2026);
    this.cars.step(dt, year, T.density * T.car, T.carSpeed, timeline);
    this.horses.step(dt, year, T.density * T.horse * .8, 3.2, timeline);
    this.peds.step(dt, year, T.pedDensity * (timeline ? Math.min(1, T.density * 1.6) : 1), 1.35, timeline);
    if (this.buses) this.buses.step(dt, year, timeline ? T.buses : 1, 11, timeline);
  }
  dispose() {
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
}

/** Merge a few boxes into one geometry: [x,y,z,w,h,d] each. */
function boxCluster(specs) {
  const parts = specs.map(([x, y, z, w, h, d]) => {
    const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); g.deleteAttribute('uv'); return g;
  });
  const out = mergeSimple(parts);
  parts.forEach(p => p.dispose());
  return out;
}
function mergeSimple(geos) {
  let vc = 0, ic = 0;
  geos.forEach(g => { vc += g.attributes.position.count; ic += g.index.count; });
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), idx = new Uint16Array(ic);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo;
    vo += g.attributes.position.count; io += g.index.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
