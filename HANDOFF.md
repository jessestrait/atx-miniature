# Handoff: Austin, miniature

**Project:** a model city of Austin that grows from 1847 to 2026 on real
construction dates.
**Repo:** `jessestrait/atx-miniature`. Entry point `index.html`, six ES modules
under `src/`, four build scripts under `tools/`.
**Written:** 2026-09-22, at the end of the session that built it.
**Read `NOTES.md` too.** It is the long-form record and is authoritative on
*why* anything is the way it is.

---

## Start here on a new machine

```bash
git clone https://github.com/jessestrait/atx-miniature
cd atx-miniature
python3 -m http.server 8765
```

Open <http://localhost:8765>. **That is the whole setup.** There is no build
step, no install, no API key and no backend. three.js comes from jsDelivr over
an import map, and `data/downtown.json` is committed, so nothing has to be
rebuilt before it runs.

One thing that will bite you: **pushing needs a bigger buffer**, because the
committed data is about 24 MB and the default post buffer fails the whole push
with an opaque `HTTP 400`. Set it once per clone:

```bash
git config http.postBuffer 524288000
git config http.version HTTP/1.1
```

## What the files are

| path | what it is |
|---|---|
| `index.html` | markup, styles, import map. No logic beyond the panel. |
| `src/main.js` | scene, post chain, UI wiring, the frame loop. Start here. |
| `src/city.js` | terrain, water, road ribbons, buildings, **the window shader**. |
| `src/life.js` | cars, horses, pedestrians, buses. Pools of instances. |
| `src/props.js` | street lamps and trees. Static instanced meshes. |
| `src/camera.js` | the camera rig: orbit, pan, keys, fly-to, the scripted film move. |
| `src/era.js` | two lookup tables — the period look by year, the light by hour. |
| `tools/build_model.py` | Overpass + terrain → `data/downtown.json`. |
| `tools/tcad_years.py` | the 595 MB appraisal export → one year per property. |
| `tools/fetch_parcels.py` | parcel polygons carrying `PROP_ID`. |
| `tools/add_years.py` | joins years onto buildings **and** onto the street grid. |

`data/tcad/*.csv` and `*.zip` are gitignored: they are 600 MB and
`pid_year.json`, which is what the join actually reads, is committed.
`data/tiles/` is gitignored too; `build_model.py` re-fetches what it needs.

## The one idea that holds it together

Everything that animates is driven by **shared uniforms**, created once in
`makeUniforms()` in `src/city.js` and handed to every material that needs
them. Nothing is rebuilt per frame.

| uniform | what it drives |
|---|---|
| `uYear` | which buildings, roads and lamps exist, and how far a building has risen |
| `uMode` | 0 = the pop-up reveal, 1 = the timeline |
| `uReveal` | the 0..1 wipe used only by the pop-up reveal |
| `uNight` | lit windows, headlights, tail lights, lamp heads |
| `uFlash` | the warm flash on a building that just went up |
| `uTime` | the slow drift that switches a few windows over |
| `uWindows` | the glazing on or off |

So **the timeline is not a rebuild.** Moving the year slider changes one float.
If you add something that should appear at a date, give its geometry an
`aYear` attribute and compare against `uYear` in the shader — do not filter on
the CPU.

## If you pick this up, the useful next moves

In the order I would actually do them.

1. **Era-specific window grids.** The pane grid is identical in 1890 and 2026,
   which is the biggest remaining tell. Smaller, denser panes before the war
   and a full curtain wall after would carry the period better than anything
   else on this list. The bay size is two constants in the fragment shader in
   `src/city.js`; make them a function of the building's year, which the shader
   already has as `aYear`.
2. **A second slice.** The whole pipeline is bbox-driven and nothing is
   hardcoded to downtown. Run the four tools with a new bbox and a new `--out`,
   then load it with `?model=data/yourslice.json`. A wider, coarser extract is
   a different and probably better shot.
3. **The live ATX Layers feeds as animation cues.** That project already
   relays buses, dispatch incidents, storm cells and 311. Incidents could flare
   on the road ribbon, storm cells drift across as shadow, buses run on the
   real feed instead of the loop.
4. **Blender export for a rendered video.** `data/downtown.json` is already a
   clean scene description; an importer is maybe 150 lines for this schema and
   buys Cycles lighting and real bokeh. Blender is not installed on the Mac
   this was built on.
5. **Neon and signage** on a handful of named buildings. The footprints carry
   an OSM `name` and it is currently unused.

## Things already decided — do not re-litigate

- **Year built comes only from TCAD's own export.** Every GIS layer was
  checked and none carries a construction date. See NOTES.
- **Road years are an inference**, from the earliest dated building nearby. A
  quartile was tried first and gave 1890 only 37 of 830 streets, which is
  plainly wrong. The UI and the README both say this is an estimate.
- **Sidewalks are generated** by offsetting street centrelines. OSM's
  `footway=sidewalk` coverage downtown is too thin to walk on.
- **The isometric view cannot use the depth-of-field pass.** Bokeh's maths is
  perspective-only; ortho uses the screen-space tilt-shift shaders instead.
- **Only what still stands is in the model.** No footprint dataset records
  demolished buildings. This is today's city replayed in build order, not a
  reconstruction, and that limit is stated in the README.

## Gotchas worth knowing before you debug

- **A hidden browser tab stops `requestAnimationFrame`.** Any frame-rate
  measurement taken while the page is not visible reads zero, and the year will
  appear frozen. This is not a bug in the loop.
- **The first render after an idle costs around 500 ms.** That is a cold
  pipeline. Measure a median of a dozen, not a first sample.
- **Depth of field needs a tight camera clip range.** It is tracked to the shot
  each frame in `src/main.js`. If you widen `near`/`far`, the blur pass loses
  its depth precision and the whole frame goes soft.
- **After deploying, check you are running what you shipped.** GitHub Pages
  caches assets for ten minutes and a reload will not re-fetch an ES module the
  browser still thinks is fresh, so a fixed bug can appear to persist. Compare
  the loaded module against a `fetch(..., {cache:'reload'})`; NOTES has the
  one-liner.

## Capturing a still

`atx.shotLink()` in the console prints a deep link to the current shot. Feed
that to headless Chrome with `ui=none`:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader \
  --hide-scrollbars --window-size=1600,900 --virtual-time-budget=25000 \
  --screenshot=/tmp/shot.png '<the link, with &light>'
```

Software rendering takes a couple of minutes, so add `&light` and expect to
wait. There is no `timeout` command on macOS; background the process and poll
for the file. A daylight hour photographs better than dusk at thumbnail size —
the lit windows turn to speckle once the image is a few hundred pixels wide.

## Where it runs

- Locally, `python3 -m http.server 8765`.
- Live at <https://jessestrait.github.io/atx-miniature/> from GitHub Pages on
  the `main` branch. Pushing to `main` redeploys it.
