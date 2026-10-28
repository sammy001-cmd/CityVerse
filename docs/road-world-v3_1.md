# Road World V3.1 — finalization report

## Final status: NOT ACCEPTED

The local world-0002 candidate is regenerated and integrity-checked, and bounded centerline smoothing is implemented. V3.1 remains **NOT ACCEPTED** because the live browser crashes on page navigation in this environment. No NORMAL/LOW road captures or continuous Suzuki Carry drive run were produced. Width appearance, junction visuals, terrain seams/handover, live streaming, browser worker/upload/collider timings, and runtime memory therefore remain unverified. Do not activate world-0002 or begin routing.

## Centerline resampling and smoothing

Source OSM geometry remains authoritative for way topology, endpoints, and shared junction nodes. Interior bends are cut conservatively only when both adjacent source segments are at most 24 m and the turn is at most 100 degrees. Each new point is bounded to a 1 m source-vertex neighborhood; endpoints and shared OSM nodes are preserved. The path is re-densified to an 8 m maximum segment length. Junction arm tangents are taken from the final processed path. The same generated segments feed rendering, road edges, surface queries, collision, markings, and junction approaches.

Candidate manifest measurements:

- Source points: **490,618**
- Final resampled points: **1,553,769**
- Ways with a smoothed bend: **32,096**
- Maximum sampled deviation from source alignment, including segment midpoints: **0.499 m**
- Smoothing pass CPU time across the extract: **89.9 ms** (does not include geometry generation or the later surface/collider stages)

## Candidate road layer

The local candidate is `.world-assets/releases/world-0002`. Its road manifest is `data/road-tiles/manifest.json`.

- 12,802 road tiles; 1,497,170 road segments; 61,493 junctions
- Road schema version 1; road build ID `road-world-v3.1`
- Road layer: 12,803 files / **378,455,346 bytes**
- Full release: 30,764 inventory files / **501,749,964 bytes**; release build ID `9a0360ed12fb978ece9076240363f3588aca933c`
- All 30,764 inventory payload files, the inventory descriptor, and all nine integrity group indexes verified against their SHA-256 and byte counts.
- Compared with world-0001: **17,961 unchanged**, **31 changed**, **12,772 added**, **1 removed**. Unchanged buildings, map, POI, and other assets remain compatible with their existing local copies.

`world/release.json` still pins **world-0001**. world-0002 was not activated, published, or tracked as generated tile data in Git. The candidate contains no navigation graph; routing was not implemented.

## Geometry performance investigation

Measurements below are synchronous `RoadSystem.buildTile` timings in Node, repeated three times per tile; each table value is the median of those runs. This is useful for comparing tile geometry and the synchronous fallback. The normal browser path prepares road geometry and junction clipping in `RoadWorldWorker`; actual browser worker scheduling, terrain clipping, GPU upload, and collider installation could not be measured here.

| Sample tile | Segments | Junctions | NORMAL | LOW |
|---|---:|---:|---:|---:|
| Sparse service `-17_20` | 10 | 0 | 6.53 ms | 0.94 ms |
| Median-size `-28_28` | 117 | 4 | 98.62 ms | 35.59 ms |
| Dense/junction-heavy `24_32` | 541 | 58 | 491.48 ms | 278.39 ms |
| Prior core `0_0` | 106 | 4 | 37.90 ms | 44.34 ms |

Four unique tiles cover the five requested sample categories because the most junction-heavy tile was also the densest tile. Across these four tiles, total build time p50/p95/worst was **37.90/491.48/491.48 ms NORMAL** and **35.59/278.39/278.39 ms LOW**. The worst sample remains a synchronous outlier.

Profiling identified apron clipping as the dominant cost. The original all-cutters scan took about 20.3 s NORMAL / 41.1 s LOW on the dense tile in an earlier run. A spatial index plus a direct-copy fast path for triangles outside all apron bounds reduced the latest medians to 491 ms / 278 ms. Latest component p50/p95/worst across the four tiles:

| Component | NORMAL | LOW |
|---|---:|---:|
| Road geometry | 10.50 / 77.69 / 77.69 ms | 12.05 / 41.53 / 41.53 ms |
| Junction generation | 0.10 / 2.57 / 2.57 ms | 0.16 / 1.13 / 1.13 ms |
| Junction clipping | 21.90 / 419.56 / 419.56 ms | 21.48 / 214.96 / 214.96 ms |
| Marking generation | 0.04 / 0.26 / 0.26 ms | 0.03 / 0.16 / 0.16 ms |

The sampled outlier is now understood: it is a dense tile with many apron intersections, and clipping dominates. In production browser mode this preparation runs in a worker when available, but no browser measurement confirms the worker path or main-thread upload/collider cost. The full sample data is retained at `.world-assets/road-world-v3.1-bench.json` (earlier profiling at `.world-assets/road-world-v3.1-bench-before-clip-optimization.json`).

## Streaming and browser validation

NORMAL requests a radius-2 tile neighborhood (at most 25 road tiles); LOW requests radius 1 (at most 9). Runtime stats now expose available, desired, cached, requested, unloaded, worker, terrain clipping, road geometry, junction, marking, upload, and collider counters. The 12,802-tile manifest is not iterated or loaded as a whole by `RoadSystem.update`. A travel session did not run, so actual beyond-core requests, memory, and handover remain unverified.

The local Vite candidate route returned HTTP 200 for both candidate road data and shared world assets, retaining the candidate's SHA-256 checks. Chrome’s remote-debugging page target crashed on navigation to the game and also on a static favicon; no screenshot could be captured. No browser validation path produced images, so there are **no screenshot artifacts** to claim as acceptance evidence. The Suzuki Carry was not driven; no false-recovery, collider/render, terrain-hole, or junction traversal claims are made.

## Build and automated checks

- `node --test apps/client/test/*.test.mjs`: **110/110 passed**
- `git diff --check`: passed
- Candidate payload and all nine integrity groups: hash/size checks passed
- Production build: **environment-blocked**. No `VITE_WORLD_ASSET_URL`, S3-compatible acceptance endpoint, or client `.env` configuration is present. `npm.cmd run build -w @cityverse/client` correctly stopped with the World Asset Delivery validation error; no URL was fabricated.

## Acceptance still required

Capture the requested NORMAL and LOW road views, validate width against the Suzuki Carry and building/StreetWorld edges, revisit the broken junction and terrain seams, drive straight/curved/junction/slope/handover/outside-core routes continuously, measure worker/upload/collider and memory behavior, and complete production verification against a valid asset endpoint. Until those live checks pass, world-0002 remains a candidate and Road World V3.1 remains **NOT ACCEPTED**.
