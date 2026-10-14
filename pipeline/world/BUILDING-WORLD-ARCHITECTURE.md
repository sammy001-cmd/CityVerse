# Building World V1 — Phase C exterior architecture

Phase C adds deterministic procedural exterior interpretation to the Phase B footprint streamer. OSM footprint, position, tags, height/levels and provenance remain source inputs. The facade, palette, roof fallback, windows, entrances and optional attachments are Cityverse interpretation, not verified real-world architecture. Inferred Phase A metadata is unchanged.

## Runtime

- Nine reusable archetypes: bungalow, low-rise residential, multi-storey residential, potential roadside commercial, office/institutional, school block, industrial, worship and generic fallback. Explicit categories take precedence; area, aspect, height, levels and stable source seed support generic records. Streamed road proximity/class enables potential commercial frontage without changing a building's core identity or colours as roads load.
- Eight restrained render colours, occasional concrete and muted accent variations, and five roof colours use vertex colours. Two globally shared GPU materials serve all tiles. Windows, doors, sign bands, slabs and rails join the wall batch; roofs join the roof batch. There are at most two procedural Mesh objects per loaded tile, regardless of building count.
- FAR uses the source shell and flat cap. MEDIUM adds a roof silhouette, plinth and cheap windows on one LOW/two NORMAL facades. NEAR adds windows on outer facades, frame/recess impressions in NORMAL, an entrance, and selected blank commercial fronts, verandas or balconies. No interiors or named businesses.
- NORMAL near/medium thresholds: 95/285 m with 18 m hysteresis. LOW: 45/170 m with 12 m hysteresis. Distance is to footprint bounds, not tile centre. Existing states persist inside the hysteresis band. Movement checks are quantized to 30 m; only tiles whose per-building LOD signature, road revision or override revision changes are rebuilt. Streaming remains radius 2 LOW / 3 NORMAL, at most 25/49 tiles.
- Flat, gable, hipped, pyramidal and shed roofs fit within the source total-height envelope. Rectangular pitched forms get subtle overhangs; small convex footprints can use pyramidal silhouettes. Concave/courtyard/unsupported forms keep a triangulated source cap. Courtyard holes remain open. Optional geometry failures fall back to a source shell; malformed records are skipped and counted.
- Road-facing entrances use public loaded road-edge data and outward facade normals; motorway edges are excluded. Without a suitable edge, use a deterministic longest facade. Source footprints never rotate or move.
- WorldSurface samples establish a horizontal base at the highest footprint vertex and foundation below the lowest. Near/medium plinths cover the base; modest steps appear on small slopes. Walls remain vertical. Collision shells exclude windows, canopies, steps and other decoration.
- Conservative compound support requires an explicit local boundary within 8 m of the footprint. No parcel is inferred from a building outline. Current source tiles provide no boundaries, so no compounds are fabricated.
- Worker preparation uses numeric builders and transferable Float32Arrays, with cooperative yields after roughly 4 ms of work in chunks of 16 records. It creates no Three.js objects. Only buildings assigned NEAR receive NEAR detail. Main-thread fallback also yields in chunks; main-thread uploads and nearby tile collision batches remain bounded.
- BuildingOverrideRegistry starts empty. Register a full `way:ID`/`relation:ID` with a factory to replace procedural geometry. The revision triggers refresh even while stationary. No landmarks are registered.
- Real buildings remain default; `?buildings=legacy` selects the exclusive temporary fallback. DEV `?buildingDebug=1` reports LOD/archetype counts, part triangles, material batches, entrances/plinths and worker timing. `?buildingLodDebug=1` tints near/medium/far. Regular HUD counting avoids aggregating detailed architecture metrics when debugging is disabled.

## Validation

Commands:

```text
node --test pipeline/world/test-world-regions.mjs pipeline/world/test-building-data.mjs pipeline/world/test-city-map.mjs apps/client/test/*.mjs
pipeline/world/.venv/Scripts/python.exe pipeline/world/test-buildings.py
npm.cmd run build:client
node pipeline/world/benchmark-building-runtime.mjs
node pipeline/world/validate-building-architecture.mjs
git diff --check
```

Browser validation requires Vite on 127.0.0.1:5173 and a disposable Chrome profile with remote debugging on port 9222. The script captures street, neighborhood and dense views in both modes, stats JSON and browser errors/world requests under ignored `data/generated/building-phase-c/`. Camera overrides apply only within the validation session; player location, streaming radius and source geometry stay unchanged.

Architecture tests cover identity/material determinism, explicit source preservation, five roofs/courtyard fallback, three LODs and hysteresis, LOW budgets, window envelopes, road-facing facade orientation in both winding directions, sloped foundations, geometry batching, empty override replacement and malformed geometry. Existing runtime tests verify actual worker transfer, error fallback, collision, schema, cache/radius/concurrency, region transitions and exclusive legacy mode. A 381-record dense mixed-LOD test enforces bounded triangle cost and shared batches.

## Measured results

Live Chrome, 960×600, actual spawn, actual WorldSurface/RoadSystem/Rapier, worker enabled, default NORMAL graphics and LOW graphics. All six views completed with zero uncaught/browser console errors and no inactive-region building requests. The initial NORMAL run had unusually slow local HTTP tile delivery (last tile 12.68 seconds); geometry timings below exclude fetching. LOW's warmed last fetch was 7.8 ms. These are local observations, not mobile FPS guarantees or a controlled hardware comparison.

| Building metric | LOW | NORMAL |
|---|---:|---:|
| Loaded tiles | 25 | 49 |
| Loaded buildings | 2,744 | 6,420 |
| Loaded triangles | 37,710 | 92,070 |
| Street-visible building draw calls | 24 | 40 |
| Neighborhood-visible building draw calls | 24 | 40 |
| Dense-view visible building draw calls | 36 | 54 |
| Loaded material batches | 50 | 98 |
| LOD far / medium / near | 2,645 / 82 / 17 | 6,211 / 160 / 49 |
| Worker average / peak | 9.14 / 47.2 ms | 9.98 / 53.3 ms |
| Geometry preparation average / peak | 12.20 / 51.8 ms | 14.11 / 56.3 ms |
| Wall / roof triangles | 28,470 / 8,390 | 66,658 / 19,740 |
| Window / other detail triangles | 782 / 68 | 5,150 / 522 |
| NEAR window + detail triangles | 458 | 4,110 |
| Foundation/plinth buildings | 99 | 209 |
| Entrances / road-facing entrances | 17 / 17 | 49 / 49 |
| Windows | 391 | 1,379 |
| Verandas / balconies / compounds | 0 / 0 / 0 | 6 / 0 / 0 |
| Roof silhouette fallbacks | 34 | 70 |
| Malformed records / build failures | 0 / 0 | 0 / 0 |

Both modes use **two material families**. Loaded triangle growth versus Phase B is **5.4% LOW** and **7.4% NORMAL**, with unchanged tile/building counts and street-visible draw calls. NORMAL remains well below 250k loaded triangles and below 60 visible building batches in every captured view. Observed geometry average/peak are lower than Phase B's NORMAL 18.5/114.9 ms, but cache, startup and machine load prevent a general speedup claim. Shadow/other world passes add renderer calls beyond building-specific frustum counts. The aerial camera preserves player-centred LOD selection; it exercises batch visibility without changing streaming or presenting a separate aerial LOD mode.

| Procedural archetype | LOW | NORMAL |
|---|---:|---:|
| Bungalow | 2,273 | 5,410 |
| Potential roadside commercial | 341 | 775 |
| Generic | 113 | 200 |
| School block | 10 | 20 |
| Industrial | 7 | 13 |
| Worship | 0 | 1 |
| Multi-storey | 0 | 1 |
| Low-rise / office-institutional | 0 / 0 | 0 / 0 |

Potential commercial archetypes are procedural forms; a commercial front additionally requires an explicit commercial category or a nearby suitable road. Counts do not identify real businesses or verified uses.

The separate densest-tile Node fallback benchmark at `(2625,5125)` uses a flat surface without roads, physics or GPU. LOW: 4,495 buildings, 58,965 triangles, 50 batches, LOD 3,959/491/45. NORMAL: 7,387 buildings, 111,711 triangles, 98 batches, LOD 6,146/1,058/183. An isolated repeat after stopping the browser/build measured fallback geometry elapsed averages/peaks of 191.6/386.0 ms LOW and 157.5/510.5 ms NORMAL, with full load times of 9.54/15.55 seconds. The saved results are in `dense-stats.json` (`--save`). Phase B dense fallback averages/peaks were 169.7/326.6 ms LOW and 147.5/328.7 ms NORMAL: averages increased 12.9%/6.8% and peaks 18.2%/55.3%. These elapsed measurements include cooperative timer yields; the increased fallback peak is a remaining limitation. An earlier concurrent build/browser run was much slower, so worker availability and device load matter.

Screenshots under `data/generated/building-phase-c/`:

- `normal-street.png`: street road, readable windows/entrance and canopy.
- `normal-neighborhood.png`: medium-distance roof forms and facade rhythm.
- `normal-dense.png`: wide city view, low-rise distribution and 54 visible batches.
- `low-street.png`, `low-neighborhood.png`, `low-dense.png`: corresponding LOW detail reduction.

Each has a matching `*-stats.json`; `validation-events.json` records browser errors and world requests. Visual review found readable close facades, modest roof variety and no obvious open foundation gaps in these views. The existing steep terrain produces exposed plinths and uneven ground; some distant shells still look simple, and window/colour variety remains restrained. Screenshot FPS varies by camera and includes the entire world; no device FPS target is claimed.

Validation: 83 JavaScript tests and 12 Python tests pass; production build succeeds with the existing large-main-chunk warning. Building worker is 18.91 kB (Phase B 141.35 kB); async BuildingSystem is 37.65 kB / 13.84 kB gzip. Protected-file hash audit found zero changes. `git diff --check` passes.

## Remaining limits

This is a small procedural kit, not a reconstruction of surveyed facades. Most generic source records are single-storey; taller archetypes remain rare in the captured play area. Complex roofs use flat caps. Compound gates/fence variants await explicit boundary data. Foundations sample footprint vertices, so unusual terrain peaks between vertices need a future terrain-fitting pass. Large slopes can expose tall plinths and exceed the simple step kit. Whole-tile batches limit culling; LOD refresh rebuilds the changed tile and its nearby collider. Mobile hardware profiling remains necessary. The existing large main-chunk build warning remains.

No CityMap, road/routing/navigation, WorldSurface or Phase A data changes are required. No interiors, business population, NPCs or landmark models are included.
