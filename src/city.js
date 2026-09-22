import * as THREE from 'three';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';

export const PALETTE = {
  ground: '#d6cdae', groundHi: '#c9bf9c', park: '#9dbb74', water: '#5c9fbf',
  slab: '#b5a98d', slabSide: '#a89c80',
  road: { motorway: '#6d6660', trunk: '#736c66', primary: '#7c756e', secondary: '#878079', tertiary: '#918a83',
          street: '#9c958d', service: '#b0a9a0', path: '#d8cdb3', rail: '#4d4641' },
  low:   ['#f1e8d6','#e9dcc6','#e2cfb0','#dcbf9f','#cfc7a9','#e6d8cb','#d9c6b8','#efe2c9'],
  mid:   ['#d8d0c2','#cbc6bc','#bfbbb3','#e1d7c9','#c8bfb0'],
  tower: ['#93b6cb','#a9c5d4','#84a7bd','#b8ccd8','#9fb9c6','#c2d3dc'],
};

/* A building is painted for the era that built it, not for how tall it is.
 * Austin's 1920s towers are limestone and brick; its 2010s towers are blue
 * glass. Using one skyscraper palette for both put a curtain wall on the
 * Norwood Tower in 1929, which is what gave this away. */
const ERA_PALETTE = [
  { until: 1900, low: ['#e3d3bb','#d8c3a6','#cbb89f','#dfd0b4','#c9b294','#d5c6ae'],
                 mid: ['#d2bfa4','#c7b498','#dccbb0'], tower: ['#c9b194','#d6c3a5','#bfa88c'] },
  { until: 1945, low: ['#e8dcc6','#d9bfa6','#c9a289','#dcc7ad','#cbb9a2','#e3d6bf','#bf9f86'],
                 mid: ['#d6c3a8','#c8b199','#ddd0ba','#c3a892'], tower: ['#cdb69a','#dac6a9','#c0a88f','#d5c0a2'] },
  { until: 1975, low: ['#ded8cb','#d2ccc0','#e4ded1','#cfc6b6','#d8cfc0'],
                 mid: ['#d3cec4','#c6c1b7','#dcd6c9'], tower: ['#c8c6bd','#d5d2c8','#bcb9b0','#cfccc2'] },
  { until: 2000, low: ['#dcd6cc','#cfcac1','#e0dad0','#c8c2b8'],
                 mid: ['#c9c6bf','#d6d2ca','#bdb9b2'], tower: ['#b3bcc0','#c2c9cc','#a7b1b6','#c9ced0'] },
  { until: 9999, low: ['#e4ded4','#d7d1c7','#eae4da','#cfcabf'],
                 mid: ['#cfd2d2','#dcdedc','#c2c6c7'], tower: ['#93b6cb','#a9c5d4','#84a7bd','#b8ccd8','#9fb9c6','#c2d3dc'] },
];
export function eraPalette(year, kind) {
  for (const e of ERA_PALETTE) if (year <= e.until) return e[kind];
  return ERA_PALETTE[ERA_PALETTE.length - 1][kind];
}
const ROAD_W = { motorway: 18, trunk: 14, primary: 13, secondary: 11, tertiary: 9, street: 7, service: 3.4, path: 1.8, rail: 3.2 };
const ROAD_LIFT = { path: .45, service: .55, street: .65, tertiary: .75, secondary: .85, primary: .95, trunk: 1.05, motorway: 1.15, rail: .6 };
export const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'street']);

export function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

/** Shared uniforms: uYear drives every reveal, uReveal is the 0..1 wipe used
 *  by the non-timeline "pop-up" intro. */
export function makeUniforms() {
  return { uYear: { value: 2026 }, uReveal: { value: 1 }, uMode: { value: 0 } };
}

export class City {
  constructor(model, uniforms, exaggeration = 1.6) {
    this.m = model; this.u = uniforms; this.ex = exaggeration;
    this.group = new THREE.Group();
    this.halfW = model.halfW; this.halfH = model.halfH;
    this.maxR = Math.hypot(this.halfW, this.halfH);
    this.z0 = model.water.length ? model.water[0].z : Math.min(...model.terrain.z) / 10;
    this.build();
  }
  y(z) { return (z - this.z0) * this.ex; }

  dispose() {
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
    this.group.clear();
  }
  build() {
    this.dispose();
    this.terrain(); this.water();
    this.ribbons(this.m.rail, true); this.ribbons(this.m.roads, false);
    this.buildings();
  }

  // ---------------------------------------------------------------- terrain
  terrain() {
    const T = this.m.terrain, { nx, ny, cell } = T;
    const pos = new Float32Array(nx * ny * 3), col = new Float32Array(nx * ny * 3);
    const cG = new THREE.Color(PALETTE.ground), cH = new THREE.Color(PALETTE.groundHi),
          cP = new THREE.Color(PALETTE.park), cW = new THREE.Color('#4a8aa8'), tmp = new THREE.Color();
    let zmin = Infinity, zmax = -Infinity;
    for (let i = 0; i < T.z.length; i++) { const z = T.z[i] / 10; if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
    for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
      const i = r * nx + c, z = T.z[i] / 10;
      pos[i*3] = -this.halfW + c * cell; pos[i*3+1] = this.y(z); pos[i*3+2] = -this.halfH + r * cell;
      const cv = T.cover[i];
      if (cv === 1) tmp.copy(cP); else if (cv === 2) tmp.copy(cW);
      else tmp.copy(cG).lerp(cH, (z - zmin) / (zmax - zmin));
      tmp.offsetHSL(0, 0, (hash(i) - 0.5) * 0.03);
      col[i*3] = tmp.r; col[i*3+1] = tmp.g; col[i*3+2] = tmp.b;
    }
    const idx = [];
    for (let r = 0; r < ny - 1; r++) for (let c = 0; c < nx - 1; c++) {
      const a = r * nx + c, b = a + 1, d = a + nx, e = d + 1;
      if ((r + c) & 1) idx.push(a, d, b, b, d, e); else idx.push(a, d, e, a, e, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    mesh.receiveShadow = true; mesh.castShadow = true;
    this.group.add(mesh);
    this.grid = { nx, ny, cell, z: T.z };

    // the foam-board base
    const depth = -28, sk = [], skIdx = [], ring = [];
    const at = (r, c) => { const i = r * nx + c; return [pos[i*3], pos[i*3+1], pos[i*3+2]]; };
    for (let c = 0; c < nx; c++) ring.push(at(0, c));
    for (let r = 1; r < ny; r++) ring.push(at(r, nx - 1));
    for (let c = nx - 2; c >= 0; c--) ring.push(at(ny - 1, c));
    for (let r = ny - 2; r > 0; r--) ring.push(at(r, 0));
    ring.forEach(p => sk.push(p[0], p[1], p[2], p[0], depth, p[2]));
    for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length; skIdx.push(i*2, j*2, i*2+1, j*2, j*2+1, i*2+1); }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sk), 3));
    sg.setIndex(skIdx); sg.computeVertexNormals();
    this.group.add(new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: PALETTE.slabSide, roughness: 1, side: THREE.DoubleSide })));
    const slab = new THREE.Mesh(new THREE.BoxGeometry(this.halfW * 2 + 40, 22, this.halfH * 2 + 40),
                                new THREE.MeshStandardMaterial({ color: PALETTE.slab, roughness: 1 }));
    slab.position.y = depth - 11; slab.receiveShadow = true; this.group.add(slab);
  }

  groundAt(x, y) {
    const { nx, ny, cell, z } = this.grid;
    let fx = (x + this.halfW) / cell, fy = (this.halfH - y) / cell;
    fx = Math.min(Math.max(fx, 0), nx - 1.001); fy = Math.min(Math.max(fy, 0), ny - 1.001);
    const xi = fx | 0, yi = fy | 0, ax = fx - xi, ay = fy - yi;
    return (z[yi*nx+xi]*(1-ax)*(1-ay) + z[yi*nx+xi+1]*ax*(1-ay) + z[(yi+1)*nx+xi]*(1-ax)*ay + z[(yi+1)*nx+xi+1]*ax*ay) / 10;
  }

  water() {
    const geos = this.m.water.map(w => {
      const s = new THREE.Shape(w.p.map(p => new THREE.Vector2(p[0], p[1])));
      for (const h of w.holes) s.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1]))));
      const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); g.translate(0, this.y(w.z) + 0.05, 0);
      g.deleteAttribute('uv'); g.deleteAttribute('normal'); g.computeVertexNormals();
      return g;
    });
    if (!geos.length) return;
    const m = new THREE.Mesh(BGU.mergeGeometries(geos), new THREE.MeshStandardMaterial({ color: PALETTE.water, roughness: .35, metalness: .05 }));
    m.receiveShadow = true; this.group.add(m);
  }

  // ---------------------------------------------------------------- roads
  ribbons(list, isRail) {
    const pos = [], col = [], yr = [], dly = [], idx = [];
    const tmp = new THREE.Color(); let base = 0;
    for (const r of list) {
      const w = ROAD_W[r.c], lift = ROAD_LIFT[r.c] + (r.b ? 1.5 : 0), P = r.p, n = P.length;
      if (n < 2) continue;
      tmp.set(PALETTE.road[r.c]);
      for (let i = 0; i < n; i++) {
        const p = P[i], a = P[Math.max(i - 1, 0)], b = P[Math.min(i + 1, n - 1)];
        let dx = b[0] - a[0], dy = b[1] - a[1];
        const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
        let nx = -dy, ny = dx;
        if (i > 0 && i < n - 1) {
          const d1x = p[0]-a[0], d1y = p[1]-a[1], l1 = Math.hypot(d1x,d1y)||1;
          const d2x = b[0]-p[0], d2y = b[1]-p[1], l2 = Math.hypot(d2x,d2y)||1;
          const cos = (d1x*d2x + d1y*d2y)/(l1*l2);
          const s = Math.min(2, 1 / Math.max(0.5, Math.sqrt((1 + cos) / 2)));
          nx *= s; ny *= s;
        }
        const yy = this.y(p[2]) + lift, d = Math.hypot(p[0], p[1]) / this.maxR;
        pos.push(p[0] + nx*w/2, yy, -(p[1] + ny*w/2), p[0] - nx*w/2, yy, -(p[1] - ny*w/2));
        col.push(tmp.r, tmp.g, tmp.b, tmp.r, tmp.g, tmp.b);
        yr.push(r.y || 1875, r.y || 1875);
        dly.push(d, d);
        if (i < n - 1) { const k = base + i * 2; idx.push(k, k+2, k+1, k+1, k+2, k+3); }
      }
      base += n * 2;
    }
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aYear', new THREE.Float32BufferAttribute(yr, 1));
    g.setAttribute('aDelay', new THREE.Float32BufferAttribute(dly, 1));
    g.setIndex(idx); g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, side: THREE.DoubleSide,
                                                 polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    mat.onBeforeCompile = sh => {
      sh.uniforms.uYear = this.u.uYear; sh.uniforms.uReveal = this.u.uReveal; sh.uniforms.uMode = this.u.uMode;
      sh.vertexShader = 'attribute float aYear; attribute float aDelay; varying float vYear; varying float vDelay;\n'
        + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vYear = aYear; vDelay = aDelay;');
      sh.fragmentShader = 'uniform float uYear, uReveal, uMode; varying float vYear; varying float vDelay;\n'
        + sh.fragmentShader.replace('#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
           if (uMode > 0.5) { if (uYear < vYear) discard; }
           else if (uReveal < 0.1 + vDelay * 0.85) discard;`);
    };
    const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; this.group.add(mesh);
    if (isRail) this.railMesh = mesh; else this.roadMesh = mesh;
  }

  // ---------------------------------------------------------------- buildings
  buildings() {
    const geos = [], tmp = new THREE.Color();
    this.m.buildings.forEach((b, bi) => {
      const s = new THREE.Shape(b.p.map(p => new THREE.Vector2(p[0], p[1])));
      for (const h of b.holes) s.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1]))));
      const sink = 2.5;
      const g = new THREE.ExtrudeGeometry(s, { depth: b.h + sink, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      const baseY = this.y(b.z) - sink;
      g.translate(0, baseY, 0); g.deleteAttribute('uv');
      const pal = eraPalette(b.y || 1960, b.k);
      tmp.set(pal[Math.floor(hash(bi) * pal.length)]).offsetHSL(0, 0, (hash(bi + 7) - .5) * .06);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3), del = new Float32Array(n), bas = new Float32Array(n), yr = new Float32Array(n), inf = new Float32Array(n);
      const d = Math.hypot(b.cx || 0, b.cy || 0) / this.maxR;
      const delay = 1.6 + d * 5.2 + hash(bi + 3) * .5 + (b.k === 'tower' ? .4 : 0);
      for (let i = 0; i < n; i++) {
        col[i*3] = tmp.r; col[i*3+1] = tmp.g; col[i*3+2] = tmp.b;
        del[i] = delay; bas[i] = baseY; yr[i] = b.y || 1900; inf[i] = b.ys === 2 ? 1 : 0;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aDelay', new THREE.BufferAttribute(del, 1));
      g.setAttribute('aBase', new THREE.BufferAttribute(bas, 1));
      g.setAttribute('aYear', new THREE.BufferAttribute(yr, 1));
      g.setAttribute('aInferred', new THREE.BufferAttribute(inf, 1));
      geos.push(g);
    });
    const g = BGU.mergeGeometries(geos);
    const u = this.u;
    const patch = sh => {
      sh.uniforms.uYear = u.uYear; sh.uniforms.uReveal = u.uReveal; sh.uniforms.uMode = u.uMode;
      sh.vertexShader = 'uniform float uYear, uReveal, uMode; attribute float aDelay, aBase, aYear, aInferred;\n varying float vNew;\n'
        + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          float g;
          if (uMode > 0.5) {
            g = clamp((uYear - aYear) / 1.1, 0.0, 1.0);
            vNew = 1.0 - clamp((uYear - aYear) / 4.0, 0.0, 1.0);
          } else {
            g = clamp((uReveal * 9.0 - aDelay) / 0.7, 0.0, 1.0);
            vNew = 0.0;
          }
          float gm = g - 1.0;
          g = g <= 0.0 ? 0.0 : 1.0 + 2.2 * gm * gm * gm + 1.2 * gm * gm;
          transformed.y = aBase + (transformed.y - aBase) * g;`);
    };
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85, flatShading: true });
    mat.onBeforeCompile = sh => {
      patch(sh);
      // a building flashes warm for a few years after it goes up
      sh.fragmentShader = 'varying float vNew;\n' + sh.fragmentShader.replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\n gl_FragColor.rgb += vec3(0.55, 0.33, 0.10) * vNew * vNew * 0.8;');
    };
    const mesh = new THREE.Mesh(g, mat);
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    mesh.customDepthMaterial.onBeforeCompile = patch;
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh);
    this.buildingMesh = mesh;
  }
}
