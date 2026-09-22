# NOTES

Running record of what was tried and why, in the habit of the ATX Layers repo.

## The data join, 2026-09-22

**Year built comes from Travis CAD, not from any GIS layer.** Checked first:
`EXTERNAL_tcad_parcel` on the Austin GeoHub carries `PROP_ID`, `SITUS`,
`ZONING`, `LAND_VALUE` and no construction date; `PLANNINGCADASTRE_land_use_inventory`
carries a land use and no date either. The date lives only in TCAD's own
`improvement_detail_2026.zip` (69 MB, four CSVs, 595 MB unpacked, 4.3 M rows),
one row per improvement *detail* — a floor, a canopy, a paved area.

The join is: OSM footprint centroid → TCAD parcel polygon (point in polygon)
→ `PROP_ID` → `actualYearBuilt`. Downtown result: 2,775 of 3,346 buildings get
a real appraisal year, 11 more come from an OSM `start_date`, 560 are inferred
from the median of their nearest dated neighbours and flagged `ys: 2`.

Two things had to be handled:

- **Skip the non-building details.** A property's earliest "improvement" is
  often its parking lot. Rows whose detail type is PAVED / CANOPY / POOL /
  FENCE / DECK / PATIO / PORCH / CARPORT / SHED / WALL / DOCK / SPA / YARD /
  DRIVE are dropped before taking the earliest year.
- **Tax-exempt property is not in the roll at all.** The Capitol, the
  courthouses and the churches appear in no appraisal export, which is exactly
  why the OSM `start_date` fallback is ranked *above* TCAD when the two
  disagree by more than three years.

## Road years are a heuristic, and the first one was wrong

No road dataset anywhere carries a construction date. The model gives each
road the year of the buildings around it.

First attempt took the **lower quartile** of nearby building years. Result:
1890 downtown had 37 of 830 streets. That is plainly wrong — Waller's 1839
grid was all there by then; it was the *blocks* that filled in. Changed to the
**earliest of the sixteen nearest buildings, minus six years**, with a floor
per road class (motorway 1955, trunk 1950, everything else 1872). Now: 204
streets by 1875, 655 by 1890, 2,127 by 1910.

This is an inference, not a record, and the UI says so.

## Depth of field needs a tight clip range

The miniature look is a real `BokehPass`, which reads the depth buffer. With
the camera at `near: 5, far: 60000` there is no precision left and *everything*
renders out of focus — a close shot came back as an even smear. The clip range
now tracks the shot (`near = d * 0.03`, `far = d * 5 + model radius`) and
`nearClip` / `farClip` are pushed into the bokeh material when it changes.

Aperture also eases off as you fly in. A street-level shot with a model-scale
aperture is blurred end to end and reads as a mistake rather than a miniature.

**The orthographic view cannot use it at all.** Bokeh's circle-of-confusion
maths is perspective-only, so the isometric mode uses the two-pass screen-space
tilt-shift shaders instead, driven by the same slider.

## Street life

- **Sidewalks are generated, not sourced.** `footway=sidewalk` covers a
  fraction of downtown and the model build drops those ways anyway, so
  pedestrians placed on OSM paths ended up walking the hike-and-bike trail and
  nothing else. Every drivable centreline is offset to both kerbs instead:
  2,016 walking lines downtown.
- **Traffic moves onto the streets that exist, rather than vanishing with
  them.** Each pool sorts its paths by year, binary-searches the count built by
  the current year, and re-rolls any instance whose street is not there yet.
  Without this, 1890 rendered an empty grid because almost every pool member
  had been assigned to a street built after 1950.
- **Weighted toward the middle.** Path weight falls off as `1/(1 + d/520)`, so
  downtown blocks look busy and the edges stay quiet.
- Horse traffic and cars are a **crossfade**, not a switch: horses thin out
  through the 1910s while cars climb from 1905.

## Buildings are painted for the era that built them

One skyscraper palette put a blue curtain wall on a 1929 tower. Colour is now
chosen from the building's own year: masonry and limestone before 1945,
concrete and pastel to 1975, darker stone and early glass to 2000, blue glass
after. This is the single change that made the timeline read as history rather
than as a progress bar.

## Known limits

- **Only what still stands.** The model has no demolished buildings, because no
  footprint dataset records them. The run is "the city as it is today, in the
  order it was built", not a true reconstruction. Everything lost to the
  1928 plan, to urban renewal, or to a condo tower is simply absent.
- `actualYearBuilt` is a renovation-sensitive field. A gut remodel can reset it.
- The inferred 560 are neighbourhood medians and will be wrong individually.

## Windows without textures, 2026-09-22

Facades are glazed in the fragment shader from world position. The wall's own
tangent, `cross(up, N)`, is the horizontal facade coordinate and height above
the building's base is the vertical one, so every elevation of every building
gets a pane grid with no UVs, no atlas and no extra geometry. Roofs are
excluded by `abs(N.y) < 0.62`, the plinth and the parapet by a band test
against the per-vertex base and top.

Three things this needed before it looked right.

- **Chunky panes.** A true 3.15 m column grid turned into static at model
  distance. Bays of 5.4 m by 5.0 m survive the shrink. A model maker does the
  same thing.
- **Antialias against the derivative.** `fwidth` on the cell coordinate gives
  the pane edges a real soft edge, and once a cell is smaller than a pixel the
  whole grid is mixed toward its own average coverage. Without that last step
  the towers shimmered whenever the camera moved.
- **Daylight is a reflection, not a hole.** The first pass darkened panes hard
  in all conditions and every facade read as a checkerboard. Glass is now a
  faint cool tint by day and properly black behind the lit panes at night.

At night a hash per cell decides what is lit, occupancy runs from 22% on a low
building to 46% on a tower, and a slow term lets a few switch over while you
watch.

## The flash had to be gated

Buildings flash warm for four years after they go up. Parked at 2026 that left
every tower built since 2022 permanently glowing orange, which read as a
rendering bug. It is now driven by a `uFlash` uniform that eases in only while
a run is actually playing.

## Performance, measured

On this Intel Mac, steady state at 2026 with everything on:

| | |
|---|---|
| scene render, median of 12 | 1.6 ms |
| same without tree and lamp shadows | 0.8 ms |
| life update (2,120 instance matrices) | 1.6 ms |

The first render after an idle costs around 500 ms, which is a cold pipeline,
not a frame cost — measure a median, not a first sample. Scene totals: 3,346
buildings in one draw call, 5,938 trees, 1,178 lamps, 620 cars, 1,500 people.

Note that a hidden browser tab stops `requestAnimationFrame` entirely, so any
frame-rate measurement taken while the page is not visible reads zero.
