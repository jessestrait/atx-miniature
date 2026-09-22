import * as THREE from 'three';
import { hash, DRIVABLE } from './city.js';

/* Street furniture and planting. Both are static instanced meshes built once:
 * the matrices never change, so the only per-frame cost is one draw call each
 * and a uniform for how lit the lamps are. */

const TREE_GREENS = ['#4e8f3a','#5fa344','#3f7d32','#6cb04e','#548f45','#79b85a','#47823c'];
const LEAF_AUTUMN = ['#c98a2e','#b7702a','#d9a53c'];

/** Lamps down both kerbs of every drivable street, every `spacing` metres. */
export function makeLamps(model, city, { spacing = 78, max = 3200 } = {}) {
  const post = new THREE.CylinderGeometry(.18, .26, 7.4, 5); post.translate(0, 3.7, 0);
  const head = new THREE.SphereGeometry(.72, 6, 4); head.translate(0, 7.7, 0);
  const postMesh = [], pts = [];
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), off = new THREE.Vector3();

  for (const r of model.roads) {
    if (!DRIVABLE.has(r.c) || r.b) continue;
    const half = ({ motorway: 11, trunk: 9, primary: 8.5, secondary: 7.5, tertiary: 6.5, street: 5.5 })[r.c] || 5.5;
    let acc = spacing * hash(pts.length + 1);
    for (let i = 1; i < r.p.length; i++) {
      const a = r.p[i - 1], b = r.p[i];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (L < 1e-3) continue;
      dir.set(dx, 0, -dy).normalize();
      off.crossVectors(up, dir);
      for (let d = spacing - acc; d < L; d += spacing) {
        const t = d / L, side = pts.length & 1 ? 1 : -1;
        pts.push({
          x: a[0] + dx * t + off.x * half * side,
          y: city.y(a[2] + (b[2] - a[2]) * t),
          z: -(a[1] + dy * t) + off.z * half * side,
          year: r.y || 1875,
        });
        if (pts.length >= max) break;
      }
      acc = (acc + L) % spacing;
      if (pts.length >= max) break;
    }
    if (pts.length >= max) break;
  }
  if (!pts.length) return null;

  const group = new THREE.Group();
  const m4 = new THREE.Matrix4(), v = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
  const postIM = new THREE.InstancedMesh(post, new THREE.MeshStandardMaterial({ color: '#3f4348', roughness: .8 }), pts.length);
  const headIM = new THREE.InstancedMesh(head, new THREE.MeshStandardMaterial({ color: '#e8dcc0', roughness: .5, emissive: new THREE.Color('#ffc978'), emissiveIntensity: 0 }), pts.length);
  postIM.castShadow = true;
  pts.forEach((p, i) => {
    v.set(p.x, p.y, p.z); m4.compose(v, q, sc);
    postIM.setMatrixAt(i, m4); headIM.setMatrixAt(i, m4);
  });
  postIM.frustumCulled = headIM.frustumCulled = false;
  group.add(postIM, headIM);
  // Sorted years let a timeline run show only the lamps whose street exists.
  const order = pts.map((p, i) => i).sort((a, b) => pts[a].year - pts[b].year);
  const sortedM = new THREE.InstancedMesh(post, postIM.material, pts.length);
  order.forEach((src, dst) => { postIM.getMatrixAt(src, m4); sortedM.setMatrixAt(dst, m4); });
  postIM.instanceMatrix.copy(sortedM.instanceMatrix);
  order.forEach((src, dst) => { headIM.getMatrixAt(src, m4); sortedM.setMatrixAt(dst, m4); });
  headIM.instanceMatrix.copy(sortedM.instanceMatrix);
  sortedM.dispose();
  const years = order.map(i => pts[i].year);

  return {
    group, count: pts.length, years,
    /** Gas light arrives around 1875 and electric spreads after; before that
     *  the street is dark, which is most of what 1870 at night looked like. */
    update(night, year, timeline) {
      let n = pts.length;
      if (timeline) {
        let lo = 0, hi = years.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (years[mid] <= year) lo = mid + 1; else hi = mid; }
        n = Math.round(lo * THREE.MathUtils.clamp((year - 1872) / 30, 0, 1));
      }
      postIM.count = headIM.count = n;
      headIM.material.emissiveIntensity = night * 2.2;
      headIM.material.color.setHex(night > .5 ? 0xffe6b8 : 0xe8dcc0);
    },
  };
}

/** Trees, scattered over the park cells of the land-cover raster and thinned
 *  along the kerbs of the smaller streets. */
export function makeTrees(model, city, { parkDensity = 0.055, streetSpacing = 34, max = 9000 } = {}) {
  const T = model.terrain, { nx, ny, cell } = T;
  const spots = [];
  for (let r = 1; r < ny - 1 && spots.length < max; r++) {
    for (let c = 1; c < nx - 1; c++) {
      if (T.cover[r * nx + c] !== 1) continue;
      const i = r * nx + c;
      if (hash(i * 1.7) > parkDensity * 14) continue;
      const jx = (hash(i * 3.1) - .5) * cell * 1.6, jz = (hash(i * 5.3) - .5) * cell * 1.6;
      const x = -city.halfW + c * cell + jx, z = -city.halfH + r * cell + jz;
      spots.push({ x, y: city.y(city.groundAt(x, -z)), z, s: .7 + hash(i * 7.7) * .75 });
      if (spots.length >= max) break;
    }
  }
  // street trees on the quieter streets only, so arterials stay readable
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), off = new THREE.Vector3();
  for (const rd of model.roads) {
    if (spots.length >= max) break;
    if (rd.c !== 'street' && rd.c !== 'tertiary') continue;
    if (rd.b) continue;
    let acc = streetSpacing * hash(spots.length + 2);
    for (let i = 1; i < rd.p.length; i++) {
      const a = rd.p[i - 1], b = rd.p[i];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (L < 1e-3) continue;
      dir.set(dx, 0, -dy).normalize(); off.crossVectors(up, dir);
      for (let d = streetSpacing - acc; d < L; d += streetSpacing) {
        const t = d / L, side = spots.length & 1 ? 1 : -1, hw = 7.2;
        const x = a[0] + dx * t + off.x * hw * side;
        const z = -(a[1] + dy * t) + off.z * hw * side;
        spots.push({ x, y: city.y(a[2] + (b[2] - a[2]) * t), z, s: .62 + hash(spots.length * 2.9) * .5 });
        if (spots.length >= max) break;
      }
      acc = (acc + L) % streetSpacing;
    }
  }
  if (!spots.length) return null;

  const trunk = new THREE.CylinderGeometry(.34, .5, 3.2, 5); trunk.translate(0, 1.6, 0);
  const crown = new THREE.IcosahedronGeometry(2.5, 0);
  crown.translate(0, 4.6, 0);
  const group = new THREE.Group();
  const trunkIM = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: '#6b4f38', roughness: 1 }), spots.length);
  const crownIM = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true, vertexColors: false }), spots.length);
  crownIM.castShadow = true; trunkIM.castShadow = true;
  crownIM.frustumCulled = trunkIM.frustumCulled = false;
  const m4 = new THREE.Matrix4(), v = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), col = new THREE.Color();
  spots.forEach((p, i) => {
    v.set(p.x, p.y, p.z);
    q.setFromAxisAngle(up, hash(i * 9.1) * Math.PI * 2);
    sc.set(p.s, p.s * (.85 + hash(i * 4.2) * .5), p.s);
    m4.compose(v, q, sc);
    trunkIM.setMatrixAt(i, m4); crownIM.setMatrixAt(i, m4);
    const pal = hash(i * 13.7) > .93 ? LEAF_AUTUMN : TREE_GREENS;
    col.set(pal[Math.floor(hash(i * 6.1) * pal.length)]).offsetHSL(0, 0, (hash(i * 8.3) - .5) * .07);
    crownIM.setColorAt(i, col);
  });
  crownIM.instanceColor.needsUpdate = true;
  crownIM.material.vertexColors = false;
  group.add(trunkIM, crownIM);
  return { group, count: spots.length };
}
