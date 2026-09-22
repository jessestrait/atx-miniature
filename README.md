# Austin, miniature

A tilt-shift model of Austin built from real data: OpenStreetMap streets and
building footprints, USGS terrain (via the AWS terrarium tiles), and the
CapMetro route shapes already gathered for [ATX Layers](https://jessestrait.com/atx/).
Inspirations: the model-city establishing shots in *Game Night* and the BBC
*Sherlock*, and the pop-up isometric city in the *Silicon Valley* title sequence.

Started 2026-09-22 as a side project of ATX Layers. Its own repo on purpose:
every commit to `jessestrait.github.io` rebuilds the Pages site.

## Run it

```
python3 -m http.server 8765
```

then open <http://localhost:8765>. No build step; three.js comes from jsDelivr.

- **Miniature** is a perspective camera with a real depth-of-field pass; the
  blur slider is the aperture. **Isometric** is a true 35.264° orthographic
  view with a screen-space tilt-shift band instead (the bokeh pass's depth
  math is perspective-only).
- **Replay** (or space) reruns the reveal: roads wipe outward from the centre,
  buildings pop up in rings with an ease-out-back overshoot, buses start at
  6.5 s.
- **Record 14 s** captures the canvas with MediaRecorder and offers a `.webm`.
- `?model=data/other.json` loads a different slice.

## Rebuild the data

```
python3 tools/build_model.py --bbox S,W,N,E --out data/name.json
```

`tools/build_model.py` expects an Overpass `out geom` JSON (the query used for
downtown is in the git history of this README's first commit and in
`data/overpass_downtown.json`). It:

1. projects everything onto a local metre plane centred on the bbox;
2. stitches terrarium z15 tiles into an 8 m grid, flattens it under water
   polygons and sets one water level per model;
3. clips polygons (Sutherland–Hodgman) and lines (Liang–Barsky) to the box;
4. bakes a ground elevation into every road vertex and building base, so the
   renderer never samples terrain — bridges are straightened between their
   abutments rather than dipping to the riverbed;
5. writes a land-cover raster (ground / park / water) that tints the terrain;
6. clips the GTFS route shapes so buses can run on them.

Heights: `height` tag, else `building:levels × 3.6 + 1.5`, else a default by
footprint area. Downtown Austin has 2,058 of 3,359 buildings with a real
`height` tag, which is why the skyline is right.

## Where this could go

- **Time as the fourth axis** — the Silicon Valley title works because the
  skyline *changes*. Travis CAD publishes a year-built per improvement; join
  it to footprints and the reveal becomes downtown growing from 1900 to now,
  one decade per second.
- **The live layers as animation** — ATX Layers already relays buses, dispatch
  incidents, storm cells and 311. Each is a cue: incidents flare on the road
  ribbon, storm cells drift across as shadow, buses run on the real-time feed
  instead of the loop.
- **Film-quality output** — the model JSON is already a clean scene
  description. A Blender importer (bpy is ~150 lines for this schema) gets
  Cycles lighting, real bokeh and a rendered video. Blender is not on this
  Mac yet.
- **Bigger slices** — the pipeline is bbox-driven. A whole-city slice at a
  coarser cell size is a different, wider shot.

## Data credits

© OpenStreetMap contributors (ODbL). Terrain: USGS 3DEP / SRTM via
the AWS Terrain Tiles (Mapzen terrarium encoding). Routes: CapMetro GTFS.
