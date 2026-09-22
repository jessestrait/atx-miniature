#!/usr/bin/env python3
"""Reduce the TCAD improvement-detail export to one year-built per property.

The export is one row per *detail* (a floor, a canopy, a paved area), roughly
4.3 M rows across four CSVs.  For a model city we want, per property id, the
year its principal structure went up and how tall it is, so we keep the row
with the largest heated area and remember the earliest substantial year.
"""
import csv, sys, glob, json, os
csv.field_size_limit(1 << 24)

# Detail types that are actual enclosed building, not paving or a canopy.
SKIP_DESC = ('PAVED', 'CANOPY', 'POOL', 'FENCE', 'DECK', 'PATIO', 'PORCH',
             'CARPORT', 'SHED', 'WALL', 'DOCK', 'SPA', 'YARD', 'DRIVE')

best = {}      # pid -> [year, area, stories]
rows = 0
for path in sorted(glob.glob('data/tcad/improvement_detail_*.csv')):
    with open(path, newline='', encoding='utf-8', errors='replace') as fh:
        for r in csv.DictReader(fh):
            rows += 1
            desc = (r.get('imprvDetailTypeDesc') or '').upper()
            if any(s in desc for s in SKIP_DESC):
                continue
            try:
                y = int(float(r['actualYearBuilt'] or 0))
                a = float(r['area'] or 0)
                st = float(r['imprvStories'] or 0)
            except ValueError:
                continue
            if not (1830 <= y <= 2027) or a <= 0:
                continue
            pid = r['pID']
            cur = best.get(pid)
            if cur is None:
                best[pid] = [y, a, st]
            else:
                if a > cur[1]:
                    cur[1] = a
                    cur[2] = max(cur[2], st)
                cur[0] = min(cur[0], y)          # earliest substantial structure
                cur[2] = max(cur[2], st)
    print(f'  {os.path.basename(path)} done, {rows:,} rows, {len(best):,} properties', flush=True)

out = {pid: [v[0], round(v[1]), v[2]] for pid, v in best.items()}
json.dump(out, open('data/tcad/pid_year.json', 'w'), separators=(',', ':'))
from collections import Counter
dec = Counter((v[0] // 10) * 10 for v in best.values())
print(f'{len(out):,} properties with a year; decades:',
      ', '.join(f'{d}s:{n:,}' for d, n in sorted(dec.items()) if n > 500))
print('wrote data/tcad/pid_year.json', os.path.getsize('data/tcad/pid_year.json') // 1024, 'KB')
