import * as THREE from 'three';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';

export const PALETTE = {
  ground: '#dfd6b4', groundHi: '#cfc79c', park: '#7fc05c', water: '#3fa8d8',
  slab: '#c2b493', slabSide: '#b3a486',
  road: { motorway: '#5f5a58', trunk: '#69635f', primary: '#726c67', secondary: '#7e7872', tertiary: '#8a847d',
          street: '#968f88', service: '#aaa49b', path: '#e0cfa8', rail: '#463f3a' },
  low:   ['#f1e8d6','#e9dcc6','#e2cfb0','#dcbf9f','#cfc7a9','#e6d8cb','#d9c6b8','#efe2c9'],
  mid:   ['#d8d0c2','#cbc6bc','#bfbbb3','#e1d7c9','#c8bfb0'],
  tower: ['#93b6cb','#a9c5d4','#84a7bd','#b8ccd8','#9fb9c6','#c2d3dc'],
};

/* A building is painted for the era that built it, not for how tall it is.
 * Austin's 1920s towers are limestone and brick; its 2010s towers are blue
 * glass. Using one skyscraper palette for both put a curtain wall on the
 * Norwood Tower in 1929, which is what gave this away. */
const ERA_PALETTE = [
  { until: 1900, low: ['#e0c9a2','#d8ab86','#c99a72','#e6d3ad','#c98f6e','#d9bd95','#bf8f6a'],
                 mid: ['#d3ab84','#c79370','#e0c6a0'], tower: ['#cf9f78','#dcb98f','#c08d68'] },
  { until: 1945, low: ['#edd9b4','#e0a889','#cf7f68','#dcbf9a','#c9a184','#efdcb8','#b8705c','#d9b07e'],
                 mid: ['#dcae83','#c98f6e','#e8cfa4','#c4906f'], tower: ['#d6a87c','#e2be8d','#c4906d','#dcb489'] },
  { until: 1975, low: ['#e8e2cf','#cfd8c4','#efe4cd','#d4c6a8','#b8ccbd','#e6cfc0','#ccd4dc'],
                 mid: ['#d8d2c0','#c2ccc4','#e4dcc8'], tower: ['#cfcdbe','#dcd8c8','#bcc4c0','#d4cfc2'] },
  { until: 2000, low: ['#dcd6c8','#c9cdc4','#e4dcce','#c2bcae','#cfd2cd'],
                 mid: ['#c9c9c0','#d6d6cc','#bcbcb2'], tower: ['#a8bcc4','#bcccd2','#98aeb8','#c6d2d4'] },
  { until: 9999, low: ['#ece4d6','#dcd4c4','#f2ece0','#cfcabc','#d8ddd6'],
                 mid: ['#cdd6d8','#dee4e2','#bfc8cb'], tower: ['#7fb4d2','#9cc8de','#6fa4c4','#b2d0e0','#8cb8cc','#c0dae8'] },
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
  return {
    uYear: { value: 2026 }, uReveal: { value: 1 }, uMode: { value: 0 },
    uNight: { value: 0 }, uTime: { value: 0 }, uWindows: { value: 1 }, uFlash: { value: 0 },
    uLampCol: { value: new THREE.Color('#ffc978') },
  };
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
      const col = new Float32Array(n * 3), del = new Float32Array(n), bas = new Float32Array(n),
            yr = new Float32Array(n), top = new Float32Array(n), sd = new Float32Array(n);
      const d = Math.hypot(b.cx || 0, b.cy || 0) / this.maxR;
      const delay = 1.6 + d * 5.2 + hash(bi + 3) * .5 + (b.k === 'tower' ? .4 : 0);
      const topY = this.y(b.z) + b.h;
      for (let i = 0; i < n; i++) {
        col[i*3] = tmp.r; col[i*3+1] = tmp.g; col[i*3+2] = tmp.b;
        del[i] = delay; bas[i] = baseY; yr[i] = b.y || 1900; top[i] = topY; sd[i] = bi;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aDelay', new THREE.BufferAttribute(del, 1));
      g.setAttribute('aBase', new THREE.BufferAttribute(bas, 1));
      g.setAttribute('aYear', new THREE.BufferAttribute(yr, 1));
      g.setAttribute('aTop', new THREE.BufferAttribute(top, 1));
      g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
      geos.push(g);
    });
    const g = BGU.mergeGeometries(geos);
    const u = this.u;
    const patch = sh => {
      sh.uniforms.uYear = u.uYear; sh.uniforms.uReveal = u.uReveal; sh.uniforms.uMode = u.uMode;
      sh.vertexShader = `uniform float uYear, uReveal, uMode;
        attribute float aDelay, aBase, aYear, aTop, aSeed;
        varying float vNew, vTop, vSeed, vBase;
        varying vec3 vWPos, vWNrm;\n`
        + sh.vertexShader
          .replace('#include <begin_vertex>', `#include <begin_vertex>
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
          transformed.y = aBase + (transformed.y - aBase) * g;
          vTop = aTop; vSeed = aSeed; vBase = aBase;`)
          .replace('#include <project_vertex>', `#include <project_vertex>
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWNrm = normalize(mat3(modelMatrix) * objectNormal);`);
    };
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .78, flatShading: true });
    mat.onBeforeCompile = sh => {
      patch(sh);
      sh.uniforms.uNight = u.uNight;
      sh.uniforms.uTime = u.uTime;
      sh.uniforms.uFlash = u.uFlash;
      sh.uniforms.uWindows = u.uWindows;
      sh.uniforms.uLampCol = u.uLampCol;
      /* Windows are generated in the fragment shader from world position, not
       * from a texture: the facade coordinate is the wall's own tangent, so a
       * grid of panes wraps every elevation of every building with no UVs and
       * no extra geometry. At night a per-pane hash decides which are lit, and
       * a slow term lets a few switch over while you watch. */
      sh.fragmentShader = `uniform float uNight, uTime, uWindows, uFlash;
        uniform vec3 uLampCol;
        varying float vNew, vTop, vSeed, vBase;
        varying vec3 vWPos, vWNrm;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n`
        + sh.fragmentShader
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 winGlow = vec3(0.0);
        float winMask = 0.0;
        if (uWindows > 0.5) {
          vec3 N = normalize(vWNrm);
          if (abs(N.y) < 0.62) {
            // a coordinate that runs along the wall, and one that runs up it
            vec3 tan3 = normalize(cross(vec3(0.0, 1.0, 0.0), N));
            float u1 = dot(vWPos.xz, tan3.xz);
            float v1 = vWPos.y - vBase;
            // Chunky panes on purpose. A true 3 m window grid aliases into
            // static at model distance; grouping it into bays that survive
            // the shrink is what a model maker does too.
            float floorH = 5.0, colW = 5.4;
            float seedOff = h21(vec2(vSeed, 3.0));
            float fy = (v1 - 2.9) / floorH;
            float fx = (u1 / colW) + seedOff * 3.0;
            // don't glaze the plinth or run panes off the parapet
            float body = step(3.4, v1) * (1.0 - step(vTop - vBase - 1.1, v1));
            vec2 cell = vec2(floor(fx), floor(fy));
            vec2 f = vec2(fract(fx), fract(fy));
            // Antialias the pane edges against their own screen-space
            // derivative, and dissolve the whole grid to its average once a
            // cell is smaller than a pixel, so distance fades rather than
            // shimmers.
            vec2 w = vec2(fwidth(fx), fwidth(fy)) * 0.9 + 1e-5;
            vec2 lo = vec2(0.24, 0.26), hi = vec2(0.76, 0.74);
            vec2 pa = smoothstep(lo - w, lo + w, f) * (1.0 - smoothstep(hi - w, hi + w, f));
            float pane = pa.x * pa.y;
            float cover = (hi.x - lo.x) * (hi.y - lo.y);
            float detail = 1.0 - smoothstep(0.65, 1.80, max(w.x, w.y));
            pane = mix(cover, pane, detail);
            winMask = pane * body;
            float r = h21(cell + vSeed * 0.137);
            // a slow drift so a few windows change over while you watch
            float flick = step(0.5, fract(r * 7.3 + uTime * 0.035 + h21(cell.yx) * 3.0));
            // Roughly a third of panes are lit, and a small building is not an
            // office tower: its share drops with its height.
            float occupancy = mix(0.22, 0.46, clamp((vTop - vBase) / 55.0, 0.0, 1.0));
            float lit = step(1.0 - occupancy, r) * mix(1.0, flick, 0.35);
            // not every window is the same lamp: mostly tungsten, some
            // cold office fluorescent, a few screens and a little neon
            float tint = h21(cell + 11.0);
            vec3 warm = uLampCol;
            warm = mix(warm, vec3(0.78, 0.88, 1.00), step(0.62, tint));
            warm = mix(warm, vec3(0.55, 0.78, 1.00), step(0.82, tint));
            warm = mix(warm, vec3(1.00, 0.55, 0.42), step(0.92, tint));
            warm = mix(warm, vec3(0.52, 1.00, 0.76), step(0.975, tint));
            winGlow = warm * winMask * lit * uNight * 0.85;
          }
        }
        // In daylight a window is a faint cool reflection, not a dark hole:
        // a strong tint here turned every facade into checkered noise. After
        // dark the glass goes properly black behind the lit panes.
        vec3 glass = mix(diffuseColor.rgb * 0.70 + vec3(0.03, 0.055, 0.085),
                         diffuseColor.rgb * 0.26 + vec3(0.01, 0.015, 0.03), uNight);
        diffuseColor.rgb = mix(diffuseColor.rgb, glass, winMask * mix(0.80, 0.94, uNight));
        totalEmissiveRadiance += winGlow;`)
          .replace('#include <dithering_fragment>',
        `#include <dithering_fragment>
        gl_FragColor.rgb += vec3(0.62, 0.36, 0.11) * vNew * vNew * uFlash;`);
    };
    const mesh = new THREE.Mesh(g, mat);
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    mesh.customDepthMaterial.onBeforeCompile = patch;
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh);
    this.buildingMesh = mesh;
  }
}
