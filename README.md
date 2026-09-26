# Austin, miniature

A model city of Austin built from real data, that grows from 1847 to 2026.

Every building rises in the year it was actually built, taken from the Travis
Central Appraisal District's improvement roll. The streets appear as their
blocks fill in. The palette moves from limestone through concrete to blue
glass, horse traffic crossfades into cars through the 1910s, and people walk
the sidewalks the whole way.

Run the clock round to the evening and the city switches itself on: every
facade is glazed, a third of the panes light up in tungsten, fluorescent and a
little neon, headlights and tail lights come on, and the street lamps follow
the grid out from the centre.

Inspirations: the model-city establishing shots in *Game Night* and the BBC
*Sherlock*, and the pop-up isometric city in the *Silicon Valley* title.

Started 2026-09-22 as a side project of [ATX Layers](https://jessestrait.com/atx/).
Its own repo on purpose: every commit to `jessestrait.github.io` rebuilds the
Pages site.

**Live:** <https://jessestrait.github.io/atx-miniature/>
**Picking this up on another machine?** Read [HANDOFF.md](HANDOFF.md) first.

## Run it

```
python3 -m http.server 8765
```

Open <http://localhost:8765>. No build step; three.js comes from jsDelivr.

### Controls

| | |
|---|---|
| drag / right-drag | orbit / pan across the ground |
| scroll, `+` `-` | zoom |
| `W` `A` `S` `D`, arrows | move over the ground, screen-relative (`Shift` to hurry) |
| `Q` `E` | drop and raise the camera |
| `R` `F` | tilt |
| double-click | fly in to that spot |
| `0`, **Frame** | reframe the whole model |
| `Space` | play / pause the timeline |
| `T` | timeline vs. pop-up reveal |
| `N` | jump between midday and night |
| `C` | collapse the panel to the year and the scrubber |
| `H` | hide the panel |

**Play the film** runs the whole thing with a single scripted push-in, which is
the shot worth recording. **Record** does the same and hands back a `.webm`.

**Miniature** is a perspective camera with a real depth-of-field pass; the blur
slider is the aperture. **Isometric** is a true 35.264° orthographic view with a
screen-space tilt-shift band instead, because the bokeh pass's maths is
perspective-only.

The panel has three states — full, collapsed to the year and the scrubber, and
hidden behind one small button. A phone opens collapsed, because the full panel
covered a third of an iPhone screen, and the choice is remembered.

**Time** is the hour of the day, not a compass: it drives the sun's elevation
and bearing together, with the sky, the exposure and the bloom. **Lit** toggles
the window shader and **Trees** the planting.

### Deep links

The page opens on whatever the URL asks for, so you can send someone a moment
rather than the front door.

| parameter | |
|---|---|
| `year=1935` | open parked on that year |
| `hour=19.4` | the hour of the day, 4 to 24 |
| `blur=40` | aperture, 0 to 100 |
| `view=iso` | open in the isometric view |
| `ui=mini` | `full`, `mini`, `hidden`, or `none` for no chrome at all |
| `cam=x,y,z,tx,ty,tz` | an exact camera and target, in model metres |
| `orbit=1` | start the slow auto-orbit |
| `light` | halve the traffic, lamps, trees and shadow map |
| `pop` | open on the pop-up reveal instead of the timeline |
| `model=data/other.json` | load a different slice |

`atx.shotLink()` in the console prints a link to exactly what is on screen.
That is how the portfolio thumbnail is captured, with `ui=none`.

## Rebuild the data

Four steps, each independent.

```bash
# 1. footprints, streets, water, parks  (edit the bbox inside if you move it)
#    Overpass query is in the git history; data/overpass_downtown.json is the
#    saved response.
python3 tools/build_model.py --bbox 30.255,-97.758,30.281,-97.731 --out data/downtown.json

# 2. the appraisal roll: 69 MB zip, 595 MB of CSV, ~4.3 M rows
curl -o data/tcad/improvement_detail_2026.zip \
  https://traviscad.org/wp-content/largefiles/improvement_detail_2026.zip
unzip -d data/tcad data/tcad/improvement_detail_2026.zip
python3 tools/tcad_years.py            # -> data/tcad/pid_year.json

# 3. parcel polygons carrying PROP_ID
python3 tools/fetch_parcels.py --bbox 30.255,-97.758,30.281,-97.731

# 4. join years onto the footprints and onto the street grid
python3 tools/add_years.py
```

`build_model.py` projects onto a local metre plane, stitches terrarium z15
terrain into an 8 m grid, flattens it under the water polygons, clips polygons
(Sutherland–Hodgman) and lines (Liang–Barsky) to the box, bakes a ground
elevation into every road vertex and building base, straightens bridge decks
between their abutments, and writes a land-cover raster that tints the terrain.

Heights come from the OSM `height` tag, else `building:levels × 3.6 + 1.5`,
else a default by footprint area. Downtown has a real `height` on 2,058 of
3,359 buildings, which is why the skyline is right.

## How good are the years?

| source | downtown buildings |
|---|---|
| Travis CAD appraisal roll | 2,775 |
| OSM `start_date` | 11 |
| inferred from neighbours | 560 |

The OSM tag outranks TCAD when they disagree, because tax-exempt property —
the Capitol, the courthouses, the churches — is in no appraisal roll at all.

**Road years are an inference, not a record.** No road dataset carries a
construction date, so a street takes the earliest year among its nearest
dated buildings, less six years, floored by road class.

**Only what still stands is in the model.** No footprint dataset records
demolished buildings, so this is the city as it is today, replayed in the order
it was built — not a reconstruction. See [NOTES.md](NOTES.md).

## Where this could go

- **The live layers as animation.** ATX Layers already relays buses, dispatch
  incidents, storm cells and 311. Each is a cue: incidents flare on the road
  ribbon, storm cells drift across as shadow, buses run on the real feed.
- **Film-quality output.** The model JSON is a clean scene description; a
  Blender importer is maybe 150 lines for this schema and buys Cycles lighting
  and real bokeh. Blender is not on this Mac yet.
- **Bigger slices.** The pipeline is bbox-driven. A whole-city extract at a
  coarser cell size is a different, wider shot.
- **Windows keyed to the era.** They are the same grid in 1890 and 2026 today.
  Smaller, denser panes before the war and a full curtain wall after would
  carry the period better than anything else on this list.
- **Neon and signage.** A handful of named buildings with their own lit signs
  would do more for the night shot than any amount of extra glow.

## Data credits

© OpenStreetMap contributors (ODbL). Terrain: USGS 3DEP / SRTM via the AWS
Terrain Tiles, Mapzen terrarium encoding. Year built: Travis Central Appraisal
District 2026 improvement detail export. Parcels: City of Austin GeoHub
(`EXTERNAL_tcad_parcel`). Routes: CapMetro GTFS.
