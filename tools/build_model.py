#!/usr/bin/env python3
"""Build a miniature-model dataset for a slice of Austin.

Inputs : an Overpass `out geom` JSON (buildings / highways / water / parks / rail),
         AWS terrarium elevation tiles (fetched here, cached under data/tiles/),
         the GTFS route shapes from the ATX Layers repo (optional).
Output : data/<name>.json in local metres, y-up-ready, with ground elevation
         baked into every feature so the renderer never has to sample terrain.
"""
import json, math, os, sys, io, urllib.request, argparse
import numpy as np
from PIL import Image, ImageDraw

ap = argparse.ArgumentParser()
ap.add_argument('--overpass', default='data/overpass_downtown.json')
ap.add_argument('--bbox', default='30.255,-97.758,30.281,-97.731', help='S,W,N,E')
ap.add_argument('--cell', type=float, default=8.0, help='terrain grid spacing, metres')
ap.add_argument('--routes', default=os.path.expanduser('~/dev/jessestrait.github.io/atx/data/routes.geojson'))
ap.add_argument('--out', default='data/downtown.json')
A = ap.parse_args()

S, W, N, E = map(float, A.bbox.split(','))
LAT0, LON0 = (S + N) / 2, (W + E) / 2
MX = 111320 * math.cos(math.radians(LAT0))   # metres per degree lon
MY = 110574                                   # metres per degree lat

def proj(lon, lat):
    return ((lon - LON0) * MX, (lat - LAT0) * MY)

HALF_W, HALF_H = (E - W) / 2 * MX, (N - S) / 2 * MY   # half extents in metres
print(f'extent {2*HALF_W:.0f} x {2*HALF_H:.0f} m, origin {LAT0:.5f},{LON0:.5f}')

# ---------------------------------------------------------------- terrain
def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y

Z = 15
os.makedirs('data/tiles', exist_ok=True)
x0, y0 = tile_xy(N, W, Z); x1, y1 = tile_xy(S, E, Z)
tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
mosaic = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256), dtype=np.float32)
for ty in range(ty0, ty1 + 1):
    for tx in range(tx0, tx1 + 1):
        path = f'data/tiles/{Z}_{tx}_{ty}.png'
        if not os.path.exists(path):
            url = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png'
            raw = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'atx-miniature/0.1'}), timeout=60).read()
            open(path, 'wb').write(raw)
        im = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
        h = im[..., 0] * 256 + im[..., 1] + im[..., 2] / 256 - 32768
        mosaic[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = h
print(f'terrain mosaic {mosaic.shape} from {(tx1-tx0+1)*(ty1-ty0+1)} tiles')

# Resample the mosaic onto a regular metre grid over the bbox (row 0 = north).
NX = int(round(2 * HALF_W / A.cell)) + 1
NY = int(round(2 * HALF_H / A.cell)) + 1
gx = np.linspace(-HALF_W, HALF_W, NX)
gy = np.linspace(HALF_H, -HALF_H, NY)           # north to south
glon = LON0 + gx / MX
glat = LAT0 + gy / MY
px = (np.array([tile_xy(LAT0, lo, Z)[0] for lo in glon]) - tx0) * 256
py = (np.array([tile_xy(la, LON0, Z)[1] for la in glat]) - ty0) * 256
def bilinear(img, xs, ys):
    xs = np.clip(xs, 0, img.shape[1] - 1.001); ys = np.clip(ys, 0, img.shape[0] - 1.001)
    X, Y = np.meshgrid(xs, ys)
    xi, yi = X.astype(int), Y.astype(int); fx, fy = X - xi, Y - yi
    return (img[yi, xi] * (1 - fx) * (1 - fy) + img[yi, xi + 1] * fx * (1 - fy)
            + img[yi + 1, xi] * (1 - fx) * fy + img[yi + 1, xi + 1] * fx * fy)
grid = bilinear(mosaic, px, py)
print(f'grid {NX}x{NY} @ {A.cell} m, elev {grid.min():.1f}..{grid.max():.1f} m')

def sample(x, y):
    """Bilinear ground elevation at local metres (x east, y north)."""
    fx = (x + HALF_W) / A.cell; fy = (HALF_H - y) / A.cell
    fx = min(max(fx, 0), NX - 1.001); fy = min(max(fy, 0), NY - 1.001)
    xi, yi = int(fx), int(fy); ax, ay = fx - xi, fy - yi
    return float(grid[yi, xi] * (1 - ax) * (1 - ay) + grid[yi, xi + 1] * ax * (1 - ay)
                 + grid[yi + 1, xi] * (1 - ax) * ay + grid[yi + 1, xi + 1] * ax * ay)

# ---------------------------------------------------------------- overpass parsing
d = json.load(open(A.overpass))
els = d['elements']

def ring_from_geom(geom):
    return [proj(p['lon'], p['lat']) for p in geom]

def assemble_rings(ways):
    """Join way fragments end-to-end into closed rings (multipolygon relations)."""
    segs = [list(w) for w in ways if len(w) >= 2]
    rings = []
    while segs:
        ring = segs.pop()
        while ring[0] != ring[-1] and segs:
            for i, s in enumerate(segs):
                if s[0] == ring[-1]: ring += s[1:]; segs.pop(i); break
                if s[-1] == ring[-1]: ring += s[-2::-1]; segs.pop(i); break
                if s[-1] == ring[0]: ring = s[:-1] + ring; segs.pop(i); break
                if s[0] == ring[0]: ring = s[::-1][:-1] + ring; segs.pop(i); break
            else:
                break
        if len(ring) >= 4: rings.append(ring)
    return rings

def clip_poly(poly):
    """Sutherland-Hodgman against the bbox rectangle."""
    def clip_edge(pts, inside, intersect):
        out = []
        for i in range(len(pts)):
            cur, prev = pts[i], pts[i - 1]
            if inside(cur):
                if not inside(prev): out.append(intersect(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(intersect(prev, cur))
        return out
    def ix(a, b, axis, val):
        t = (val - a[axis]) / (b[axis] - a[axis])
        return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    pts = [tuple(p) for p in poly]
    if pts and pts[0] == pts[-1]: pts = pts[:-1]
    for axis, val, sign in ((0, -HALF_W, 1), (0, HALF_W, -1), (1, -HALF_H, 1), (1, HALF_H, -1)):
        pts = clip_edge(pts, lambda p: (p[axis] - val) * sign >= 0, lambda a, b: ix(a, b, axis, val))
        if len(pts) < 3: return []
    return pts

def clip_line(pts):
    """Cut a polyline into the pieces that lie inside the bbox."""
    def inside(p): return -HALF_W <= p[0] <= HALF_W and -HALF_H <= p[1] <= HALF_H
    def clip_seg(a, b):   # Liang-Barsky
        dx, dy = b[0] - a[0], b[1] - a[1]; t0, t1 = 0.0, 1.0
        for p, q in ((-dx, a[0] + HALF_W), (dx, HALF_W - a[0]), (-dy, a[1] + HALF_H), (dy, HALF_H - a[1])):
            if p == 0:
                if q < 0: return None
            else:
                t = q / p
                if p < 0: t0 = max(t0, t)
                else: t1 = min(t1, t)
        if t0 > t1: return None
        return (a[0] + dx * t0, a[1] + dy * t0), (a[0] + dx * t1, a[1] + dy * t1)
    pieces, cur = [], []
    for i in range(len(pts) - 1):
        s = clip_seg(pts[i], pts[i + 1])
        if s is None:
            if len(cur) > 1: pieces.append(cur)
            cur = []; continue
        a, b = s
        if not cur or cur[-1] != a: 
            if len(cur) > 1: pieces.append(cur)
            cur = [a]
        cur.append(b)
    if len(cur) > 1: pieces.append(cur)
    return pieces

def resample(pts, step=10.0):
    out = [pts[0]]
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        L = math.hypot(b[0] - a[0], b[1] - a[1]); n = max(1, int(L // step))
        for k in range(1, n + 1):
            t = k / n; out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out

def area(ring):
    return abs(sum(ring[i][0] * ring[i - 1][1] - ring[i - 1][0] * ring[i][1] for i in range(len(ring))) / 2)

def parse_height(t):
    h = t.get('height')
    if h:
        h = h.strip().lower()
        try:
            if h.endswith('m'): return float(h[:-1])
            if "'" in h: return float(h.split("'")[0]) * 0.3048
            return float(h.split()[0])
        except ValueError: pass
    lv = t.get('building:levels')
    if lv:
        try: return float(lv) * 3.6 + 1.5
        except ValueError: pass
    return None

# -- polygons: buildings, water, parks
buildings, water, parks = [], [], []
water_rings = []
for el in els:
    t = el.get('tags', {})
    outers, inners = [], []
    if el['type'] == 'way' and 'geometry' in el:
        r = ring_from_geom(el['geometry'])
        if r[0] == r[-1]: outers = [r]
    elif el['type'] == 'relation':
        outers = assemble_rings([ring_from_geom(m['geometry']) for m in el.get('members', []) if m.get('role') == 'outer' and 'geometry' in m])
        inners = assemble_rings([ring_from_geom(m['geometry']) for m in el.get('members', []) if m.get('role') == 'inner' and 'geometry' in m])
    if not outers: continue
    inners = [c for c in (clip_poly(r) for r in inners) if c]
    for r in outers:
        c = clip_poly(r)
        if not c or area(c) < 4: continue
        holes = [h for h in inners if area(h) > 4]
        if 'building' in t:
            h = parse_height(t)
            a = area(c)
            if h is None: h = 4.5 if a < 120 else 7.0 if a < 600 else 11.0
            base = min(sample(x, y) for x, y in c)
            kind = 'tower' if h > 60 else 'mid' if h > 18 else 'low'
            buildings.append({'p': [[round(x, 1), round(y, 1)] for x, y in c],
                              'holes': [[[round(x, 1), round(y, 1)] for x, y in h] for h in holes],
                              'h': round(h, 1), 'z': round(base, 2), 'k': kind,
                              'n': t.get('name', '')})
        elif t.get('natural') == 'water' or t.get('waterway') in ('river', 'riverbank'):
            water_rings.append((c, holes))
        elif t.get('leisure') == 'park':
            parks.append({'p': [[round(x, 1), round(y, 1)] for x, y in c],
                          'holes': [[[round(x, 1), round(y, 1)] for x, y in h] for h in holes],
                          'n': t.get('name', '')})

# Flatten the terrain under water and give each body one level.
mask_img = Image.new('L', (NX, NY), 0)
draw = ImageDraw.Draw(mask_img)
def to_px(pt): return ((pt[0] + HALF_W) / A.cell, (HALF_H - pt[1]) / A.cell)
for ring, holes in water_rings:
    draw.polygon([to_px(p) for p in ring], fill=255)
    for h in holes: draw.polygon([to_px(p) for p in h], fill=0)
mask = np.asarray(mask_img) > 0
if mask.any():
    level = float(np.percentile(grid[mask], 5))
    grid[mask] = np.minimum(grid[mask], level - 1.5)
    # soften the bank so the shoreline is not a vertical wall
    for ring, holes in water_rings:
        water.append({'p': [[round(x, 1), round(y, 1)] for x, y in ring],
                      'holes': [[[round(x, 1), round(y, 1)] for x, y in h] for h in holes],
                      'z': round(level, 2)})
    print(f'water: {len(water)} polygons at {level:.1f} m, {int(mask.sum())} cells flattened')

# -- lines: roads, rail
ROAD_CLASS = {
    'motorway': 'motorway', 'motorway_link': 'motorway', 'trunk': 'trunk', 'trunk_link': 'trunk',
    'primary': 'primary', 'primary_link': 'primary', 'secondary': 'secondary', 'secondary_link': 'secondary',
    'tertiary': 'tertiary', 'tertiary_link': 'tertiary', 'residential': 'street', 'unclassified': 'street',
    'living_street': 'street', 'service': 'service', 'pedestrian': 'path', 'footway': 'path',
    'cycleway': 'path', 'path': 'path', 'track': 'path',
}
roads, rail = [], []
for el in els:
    t = el.get('tags', {})
    if el['type'] != 'way' or 'geometry' not in el or 'building' in t: continue
    if 'highway' in t:
        cls = ROAD_CLASS.get(t['highway'])
        if not cls: continue
        if t.get('footway') in ('sidewalk', 'crossing') or t.get('tunnel') in ('yes', 'building_passage'): continue
        if t.get('area') == 'yes' or t.get('indoor') == 'yes': continue
        kind = 'road'
    elif t.get('railway') == 'rail' and t.get('service') is None:
        cls = 'rail'; kind = 'rail'
    else:
        continue
    bridge = t.get('bridge') in ('yes', 'viaduct')
    try: layer = int(t.get('layer', 0))
    except ValueError: layer = 0
    for piece in clip_line(ring_from_geom(el['geometry'])):
        pts = resample(piece, 10.0)
        zs = [sample(x, y) for x, y in pts]
        if bridge and len(pts) > 1:
            # a deck is straight: interpolate between the abutments by arc length
            cum = [0.0]
            for i in range(1, len(pts)): cum.append(cum[-1] + math.hypot(pts[i][0] - pts[i-1][0], pts[i][1] - pts[i-1][1]))
            L = cum[-1] or 1.0
            z0, z1 = zs[0], zs[-1]
            zs = [max(z0 + (z1 - z0) * c / L, z) + 0.5 for c, z in zip(cum, zs)]
            zs = [z + max(0, layer) * 6.0 for z in zs]
        rec = {'c': cls, 'p': [[round(x, 1), round(y, 1), round(z, 2)] for (x, y), z in zip(pts, zs)],
               'b': 1 if bridge else 0, 'n': t.get('name', '')}
        (roads if kind == 'road' else rail).append(rec)

# -- bus route shapes for the moving pieces
routes = []
if os.path.exists(A.routes):
    for f in json.load(open(A.routes))['features']:
        p = f['properties']
        if p.get('type') == 0: continue           # MetroRail; the rail ribbon carries it
        g = f['geometry']
        lines = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
        segs = []
        for line in lines:
            for piece in clip_line([proj(lon, lat) for lon, lat in line]):
                pts = resample(piece, 10.0)
                if len(pts) < 4: continue
                segs.append([[round(x, 1), round(y, 1), round(sample(x, y), 2)] for x, y in pts])
        if segs:
            routes.append({'id': p['id'], 'short': p['short'], 'color': p['color'], 'segs': segs})
    print(f'routes: {len(routes)} with {sum(len(r["segs"]) for r in routes)} segments inside the box')

from collections import Counter
print(f'buildings {len(buildings)} ({Counter(b["k"] for b in buildings)}), '
      f'roads {len(roads)} ({Counter(r["c"] for r in roads)}), rail {len(rail)}, parks {len(parks)}')

# Land cover per terrain cell: 0 ground, 1 park, 2 water. Lets the renderer tint the mesh.
cover_img = Image.new('L', (NX, NY), 0)
cd = ImageDraw.Draw(cover_img)
for pk in parks:
    cd.polygon([to_px(p) for p in pk['p']], fill=1)
    for h in pk['holes']: cd.polygon([to_px(p) for p in h], fill=0)
cover = np.asarray(cover_img).astype(np.uint8)
cover[mask] = 2

out = {
    'name': os.path.splitext(os.path.basename(A.out))[0],
    'origin': {'lat': LAT0, 'lon': LON0}, 'bbox': [S, W, N, E],
    'halfW': round(HALF_W, 1), 'halfH': round(HALF_H, 1),
    'terrain': {'nx': NX, 'ny': NY, 'cell': A.cell,
                'z': [int(round(v * 10)) for v in grid.ravel()],   # decimetres, row 0 = north
                'cover': cover.ravel().tolist()},
    'buildings': buildings, 'roads': roads, 'rail': rail, 'water': water, 'parks': parks, 'routes': routes,
}
json.dump(out, open(A.out, 'w'), separators=(',', ':'))
print(f'wrote {A.out}: {os.path.getsize(A.out)//1024} KB')
