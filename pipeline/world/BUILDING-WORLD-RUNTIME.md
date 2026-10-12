# Building World V1 — Phase B runtime

Real footprint streaming is the default after live Chrome validation. `?buildings=real` remains explicit opt-in; `?buildings=legacy` selects the retained legacy renderer and colliders exclusively. No facade, window, door, balcony, storefront or interior generation was added. The old scaffold's facade batches were removed from the real renderer.

The previous scaffold decoded an incompatible pre-v2 tuple and fetched the obsolete `/data/building-tiles` directory. Native fetch remains safely wrapped with `(...args) => globalThis.fetch(...args)`; it never receives the BuildingSystem instance as its native receiver.

## Runtime contract

- Validate manifest schema v2, field/table/flag mappings and shared projection before decoding. Decode full OSM IDs, string-table names/tags, explicit/inferred sources and signed integer decimetre footprints. Optional tile versions are checked. Invalid rows are counted and skipped.
- Fetch the lightweight region index once. Select by shared world bounds; fetch one active manifest. Region transitions remove all prior tile meshes, geometry, colliders and cached tile data, abort pending tile requests, and use an epoch to discard stale results. Local tile cache identities include the region slug.
- Request only manifested keys, deduplicate in-flight requests, cap requests at three, use LRU caches, prepare nearest tiles first, unload distant tiles, and retry failures after five seconds. Failed manifests/tiles are optional; subsystem-specific diagnostics preserve the actual errors. An unavailable index is caught at startup and disposed safely.
- LOW: radius 2, at most 25 tiles, cache 32, flat roofs, at most 50 loaded building mesh batches. NORMAL: radius 3, at most 49 tiles, cache 64, near/medium simple rectangular gable or hipped roofs, at most 98 batches. Other/irregular roofs preserve the polygon with a flat cap. Near and medium deliberately share detail level.
- Two shared vertex-colour materials; no image textures or per-building Mesh/Material. Existing BuildingWorker does extrusion/triangulation and transfers typed geometry arrays. Worker construction/errors/timeouts fall back to chunks of 16 records with yields. Main-thread record decoding also yields after each 16 accepted records. Three objects, GPU uploads and physics installation stay on the main thread.
- Stable base at the highest sampled WorldSurface footprint vertex, with foundation down to the lowest sample. Source footprints and height are preserved. No terrain or road deformation is added.
- Query public `RoadSystem.getRoadEdges(bounds)` once per tile, then filter candidates per footprint. Skip rendering/collision at estimated carriageway coverage >=25%; retain full conflicting IDs in tile diagnostics. The estimate clips against road rectangles and sums coverage, so intersecting road rectangles can overcount. No source coordinates are altered.
- At most nine nearby tile shell colliders, installed one tile at a time with yields. Remove on unload, region switch or movement outside the collider radius. Concave outlines, min-height passages and courtyards remain represented; no citywide per-building colliders. Player blockers use a 50 m spatial grid.
- DEV-only `?buildingDebug=1` reports active region, cache/loaded/pending counts, buildings, loaded and frustum-visible mesh triangles/calls, tile timing, geometry timing, road conflicts, malformed rows and colliders. No debug DOM, exported debug handle or frustum work when disabled or in production.

Inferred height/category/roof remain procedural inputs. `explicit` means tagged in OSM, not surveyed or independently verified. The decoder does not create a `verified` property.

## Validation and measured costs

73 JavaScript tests and 12 Python tests pass. Runtime tests cover schema v2, signed reconstruction, projection/table rejection, semantics, deterministic colours, LOD, courtyard geometry/collision, worker transfer/error fallback, request deduplication/concurrency, LRU, manifested radius, malformed rows, tile unloading, region switching/isolation, missing manifests and real/legacy exclusivity. Existing road, surface, map, POI and navigation regression tests remain passing.

Final production build: async `BuildingSystem` **18.91 kB / 7.20 kB gzip**, dedicated `BuildingWorker` **141.35 kB**, main client **5,075.14 kB / 1,867.09 kB gzip**. The building module is dynamically imported only in real mode; the existing large main-chunk warning remains. Road worker stays at 169.68 kB.

Commands:

```text
node --test pipeline/world/test-world-regions.mjs pipeline/world/test-building-data.mjs pipeline/world/test-city-map.mjs apps/client/test/*.mjs
pipeline/world/.venv/Scripts/python.exe pipeline/world/test-buildings.py
npm run build:client
git diff --check
git status --short
node pipeline/world/benchmark-building-runtime.mjs
```

Live Chrome at 960×600, actual player spawn, real WorldSurface/RoadSystem/Rapier, worker enabled. These building-specific measurements disabled shadows, lamps and vehicles to isolate building cost; they are not hardware FPS guarantees.

| Metric | LOW | NORMAL |
|---|---:|---:|
| Loaded tiles | 25 | 49 |
| Rendered building records | 2,744 | 6,420 |
| Loaded building triangles | 35,776 | 85,726 |
| Loaded building mesh calls | 50 | 98 |
| Frustum-visible triangles | 12,490 | 21,605 |
| Frustum-visible mesh calls | 24 | 40 |
| Tile body bytes fetched | 318,503 | 748,319 |
| Geometry elapsed average per tile | 19.2 ms | 19.3 ms |
| Geometry elapsed peak per tile | 155.0 ms | 105.3 ms |
| Last tile fetch/parse elapsed | 10.4 ms | 8.2 ms |
| Road conflicts skipped | 7 | 19 |
| Malformed rows skipped | 0 | 0 |
| Near tile colliders | 9 | 9 |

Geometry timings include worker startup/transfer or fallback yields, not a single uninterrupted main-thread task. An earlier cold LOW run peaked at 672 ms; worker startup and warm caches affect timings. Frustum metrics count tile batches intersecting the frustum, not individual building occlusion. Shadow passes can add draw calls beyond these building batch counts.

The additional **full default-settings** browser run (shadows and lamps enabled) also completed startup without errors: 49 tiles, 6,420 buildings, 85,726 loaded building triangles, 98 loaded building batches, 21,605 frustum-visible building triangles, 40 frustum-visible building batches and nine colliders. Geometry average/peak was 18.5/114.9 ms. The settled screenshot is `live-full.png`. The region index and active Ibadan manifest add 113,257 uncompressed bytes beyond the tile-body totals above; total building data bodies are 431,760 bytes LOW / 861,576 bytes NORMAL.

Dense sample: tile `10_20` contains the city's maximum 381 buildings. The repeatable Node fallback benchmark centres on `(2625,5125)`, uses the generated city data, a flat test surface, no roads, no physics and no GPU. It does not pretend the existing terrain covers that distant location.

| Dense fallback metric | LOW | NORMAL |
|---|---:|---:|
| Tiles | 25 | 49 |
| Buildings | 4,495 | 7,387 |
| Triangles | 50,499 | 89,873 |
| Mesh batches | 50 | 98 |
| Tile body bytes | 494,171 | 812,094 |
| Geometry average elapsed | 169.7 ms | 147.5 ms |
| Geometry peak elapsed | 326.6 ms | 328.7 ms |
| Full load elapsed | 9.08 s | 15.13 s |

Fallback is substantially slower than the browser worker and these wall-clock timings include yields/concurrent browser load. LOW keeps flat roofs and the smaller radius; the underlying city database is unchanged. Initial budgets are the tile/batch bounds above, with measured dense geometry below 51k/90k triangles. Device-specific tuning remains necessary.

Network isolation: actual NORMAL browser trace requested **one Ibadan manifest, 49 Ibadan tiles, zero Ogbomoso manifests or tiles**. Unit tests switch to Ogbomoso and verify no prior-region tile/cache/geometry survives. No travel or teleport control was introduced.

Live failure checks intercept the active manifest with HTTP 404: startup overlay disappears, game starts, zero building tile requests and zero uncaught exceptions. Explicit legacy mode also completes startup, renders its 1,415 legacy buildings and makes zero world-building requests.

Local screenshots and traces are under ignored `data/generated/building-phase-b/`: `live-full.png`, `live-normal.png`, `live-low.png`, `browser-events.json`, and timing JSON. Chrome uses a disposable profile there. Generated building tiles remain ignored; the publishing policy from BUILDING-WORLD.md still applies.

## Phase B files

- `apps/client/src/main.js`: exclusive mode integration, optional startup, blockers, streaming and DEV diagnostics.
- `apps/client/src/world/BuildingData.js`: new schema decoder, validation, region selection and road overlap estimate.
- `apps/client/src/world/BuildingSystem.js`: region runtime, queues/cache/unloading, worker fallback, batching, nearby collision and metrics.
- `apps/client/src/world/BuildingGeometry.js`: two simple shell/roof batches; remove facade work.
- `apps/client/src/world/BuildingRules.js`: remove obsolete 512-vertex rejection of otherwise validated footprints.
- `apps/client/test/building-world.test.mjs`: v2 fixtures and runtime coverage.
- `pipeline/world/test-building-data.mjs`: replace obsolete Phase A prohibition on runtime startup with the retained prohibition on browser raw-source dependencies.
- `pipeline/world/benchmark-building-runtime.mjs`: reproducible dense fallback benchmark.
- `pipeline/world/BUILDING-WORLD-RUNTIME.md`: this report.
- `.gitignore`: local browser captures/profiles/measurements.

Existing BuildingWorker and road geometry-transfer helpers are reused without edits. Protected Road World V2, WorldSurface, Terrain, CityMap, Minimap, POIManager, NavigationGraph, VehicleSystem and routing files have no Phase B edits. The existing uncommitted Phase A.5 pipeline/config/metadata work is preserved.

## Remaining limits

- Existing terrain/roads/navigation still cover the current Ibadan play area; Ogbomoso runtime selection is a foundation, not playable intercity travel.
- Compact pipeline tiles omit an optional tile version; the manifest schema is authoritative and optional versions are checked if present.
- Only simple rectangular pitched roofs. No precise surveyed elevations, complex roof kits, terrain cut-outs, facade or interior work.
- Approximate road overlap and loaded-road visibility can change skip decisions as road tiles commit. No global road exclusion data is fetched.
- Whole-tile batches limit fine-grained culling. Nearby colliders reuse the simple shell geometry; there is no per-building physics object.
- Main-thread fallback/decoding/upload/physics work yields but a single unusually complex footprint can still be costly. Profiling on LOW mobile hardware remains outstanding.
- Missing optional world assets leave an empty real building layer; legacy mode is explicit. Generated assets must be deployed separately.
- Vite retains the existing large main-chunk warning. Builds copy the ignored generated public tile data locally; no mass tile output is added to Git.
