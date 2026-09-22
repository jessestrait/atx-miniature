#!/usr/bin/env python3
"""Attach a construction year to every building in a model file.

Sources, in order of trust:
  0  TCAD  - the building's centroid falls in a parcel whose property id has an
             actualYearBuilt in the improvement-detail export.
  1  OSM   - a start_date / building:start_date tag on the footprint itself.
             This is what carries the Capitol, the courthouses and the churches,
             which are tax-exempt and so appear in no appraisal roll.
  2  guess - the median year of the nearest matched neighbours. Flagged, and the
             renderer can grey these out.
"""
import json, math, argparse, re, os
from collections import Counter

ap = argparse.ArgumentParser()
ap.add_argument('--model', default='data/downtown.json')
ap.add_argument('--parcels', default='data/parcels_downtown.json')
ap.add_argument('--years', default='data/tcad/pid_year.json')
ap.add_argument('--overpass', default='data/overpass_downtown.json')
A = ap.parse_args()

M = json.load(open(A.model))
LAT0, LON0 = M['origin']['lat'], M['origin']['lon']
MX = 111320 * math.cos(math.radians(LAT0)); MY = 110574
def proj(lon, lat): return ((lon - LON0) * MX, (lat - LAT0) * MY)

# ---- parcels, projected and put in a grid index
years = json.load(open(A.years))
P = json.load(open(A.parcels))
CELL = 120.0
grid = {}
parcels = []
for f in P['features']:
    pid = f['properties'].get('PROP_ID')
    if pid is None: continue
    rec = years.get(str(int(pid)))
    if not rec: continue
    g = f['geometry']
    if not g: continue
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    for poly in polys:
        ring = [proj(x, y) for x, y in poly[0]]
        if len(ring) < 4: continue
        xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
        idx = len(parcels)
        parcels.append((ring, min(xs), min(ys), max(xs), max(ys), rec[0], rec[2]))
        for cx in range(int(min(xs) // CELL), int(max(xs) // CELL) + 1):
            for cy in range(int(min(ys) // CELL), int(max(ys) // CELL) + 1):
                grid.setdefault((cx, cy), []).append(idx)
print(f'{len(parcels)} parcel rings carry a year')

def inside(ring, x, y):
    c = False; n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]; x2, y2 = ring[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c

def parcel_at(x, y):
    for i in grid.get((int(x // CELL), int(y // CELL)), []):
        ring, x0, y0, x1, y1, yr, st = parcels[i]
        if x0 <= x <= x1 and y0 <= y <= y1 and inside(ring, x, y):
            return yr, st
    return None

# ---- OSM start_date, keyed by rounded centroid so it survives the clip
osm_year = {}
if os.path.exists(A.overpass):
    for el in json.load(open(A.overpass))['elements']:
        t = el.get('tags', {})
        if 'building' not in t: continue
        raw = t.get('start_date') or t.get('building:start_date') or t.get('year_of_construction')
        if not raw: continue
        m = re.search(r'(1[6-9]\d\d|20[0-2]\d)', str(raw))
        if not m: continue
        geo = el.get('geometry') or [p for mem in el.get('members', []) if mem.get('role') == 'outer' for p in mem.get('geometry', [])]
        if not geo: continue
        pts = [proj(p['lon'], p['lat']) for p in geo]
        cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
        osm_year[(round(cx / 20), round(cy / 20))] = int(m.group(1))
print(f'{len(osm_year)} footprints carry an OSM start_date')

# ---- assign
src = Counter()
for b in M['buildings']:
    ring = b['p']
    cx = sum(p[0] for p in ring) / len(ring); cy = sum(p[1] for p in ring) / len(ring)
    b['cx'] = round(cx, 1); b['cy'] = round(cy, 1)
    hit = parcel_at(cx, cy)
    o = osm_year.get((round(cx / 20), round(cy / 20)))
    if o and (not hit or abs(o - hit[0]) > 3):
        b['y'] = o; b['ys'] = 1          # a dated landmark beats the appraisal roll
    elif hit:
        b['y'] = hit[0]; b['ys'] = 0
    else:
        b['y'] = None; b['ys'] = 2
    src[b['ys']] += 1

# ---- fill the gaps from the neighbourhood
known = [(b['cx'], b['cy'], b['y']) for b in M['buildings'] if b['y'] is not None]
kgrid = {}
for i, (x, y, _) in enumerate(known):
    kgrid.setdefault((int(x // CELL), int(y // CELL)), []).append(i)
def guess(x, y):
    for r in (1, 2, 3, 5, 8):
        near = []
        for cx in range(int(x // CELL) - r, int(x // CELL) + r + 1):
            for cy in range(int(y // CELL) - r, int(y // CELL) + r + 1):
                for i in kgrid.get((cx, cy), []):
                    kx, ky, ky2 = known[i]
                    near.append((math.hypot(kx - x, ky - y), ky2))
        if len(near) >= 5:
            near.sort()
            v = sorted(n[1] for n in near[:9])
            return v[len(v) // 2]
    return 1975
for b in M['buildings']:
    if b['y'] is None:
        b['y'] = guess(b['cx'], b['cy'])

ys = [b['y'] for b in M['buildings']]
M['years'] = {'min': min(ys), 'max': max(ys),
              'hist': dict(Counter((y // 5) * 5 for y in ys))}
print(f"years {min(ys)}-{max(ys)}  |  TCAD {src[0]}, OSM {src[1]}, inferred {src[2]}")
dec = Counter((y // 10) * 10 for y in ys)
print('  ' + '  '.join(f'{d}s:{n}' for d, n in sorted(dec.items())))
json.dump(M, open(A.model, 'w'), separators=(',', ':'))
print(f'wrote {A.model} {os.path.getsize(A.model)//1024} KB')

# ---- a year for every road vertex, so the street grid grows with the city
# There is no construction date in any road dataset, so a road takes the
# median year of the buildings around it: streets appear as their
# neighbourhood fills in. Approximate, and labelled as such in the UI.
def road_year(x, y):
    # The street comes before the buildings on it, so take the EARLIEST of the
    # nearby structures and back off a few more years. A quartile was tried
    # first and left 1890s downtown with 37 of 830 streets, which is wrong:
    # Waller's 1839 grid was all there, it was the blocks that filled in.
    for r in (1, 2, 4, 7):
        near = []
        for cx in range(int(x // CELL) - r, int(x // CELL) + r + 1):
            for cy in range(int(y // CELL) - r, int(y // CELL) + r + 1):
                for i in kgrid.get((cx, cy), []):
                    kx, ky, kyr = known[i]
                    d = math.hypot(kx - x, ky - y)
                    if d < 300: near.append((d, kyr))
        if len(near) >= 3:
            near.sort()
            return min(n[1] for n in near[:16]) - 6
    return None

for coll, dflt in (('roads', 1885), ('rail', 1875)):
    for r in M[coll]:
        pts = r['p']
        cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
        yr = road_year(cx, cy)
        # a motorway is never older than the interstate programme
        floor = {'motorway': 1955, 'trunk': 1950, 'primary': 1872, 'secondary': 1874,
                 'street': 1872, 'service': 1890, 'path': 1900}.get(r.get('c'), 1872)
        r['y'] = max(floor, yr if yr is not None else dflt)
        if r.get('b'): r['y'] = max(r['y'], 1930)      # bridges are not 1880s
ry = [r['y'] for r in M['roads']]
print(f'road years {min(ry)}-{max(ry)}, median {sorted(ry)[len(ry)//2]}')
json.dump(M, open(A.model, 'w'), separators=(',', ':'))
print('rewrote with road years')
