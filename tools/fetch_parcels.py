#!/usr/bin/env python3
"""Pull TCAD parcel polygons (with PROP_ID) for a bbox from the Austin GeoHub."""
import urllib.request, urllib.parse, json, sys, argparse, time
ap = argparse.ArgumentParser()
ap.add_argument('--bbox', default='30.255,-97.758,30.281,-97.731')
ap.add_argument('--out', default='data/parcels_downtown.json')
A = ap.parse_args()
S, W, N, E = map(float, A.bbox.split(','))
URL = 'https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/EXTERNAL_tcad_parcel/FeatureServer/0/query'

feats, offset = [], 0
while True:
    p = {'where': '1=1', 'geometry': f'{W},{S},{E},{N}', 'geometryType': 'esriGeometryEnvelope',
         'inSR': '4326', 'spatialRel': 'esriSpatialRelIntersects', 'outFields': 'PROP_ID,SITUS',
         'returnGeometry': 'true', 'outSR': '4326', 'f': 'geojson',
         'resultOffset': str(offset), 'resultRecordCount': '2000'}
    req = urllib.request.Request(URL + '?' + urllib.parse.urlencode(p), headers={'User-Agent': 'atx-miniature/0.1'})
    d = json.loads(urllib.request.urlopen(req, timeout=120).read())
    got = d.get('features', [])
    feats += got
    print(f'  +{len(got)} (total {len(feats)})', flush=True)
    if len(got) < 2000: break
    offset += 2000
    time.sleep(0.4)

json.dump({'type': 'FeatureCollection', 'features': feats}, open(A.out, 'w'), separators=(',', ':'))
withpid = sum(1 for f in feats if f['properties'].get('PROP_ID'))
print(f'{len(feats)} parcels, {withpid} with PROP_ID -> {A.out}')
