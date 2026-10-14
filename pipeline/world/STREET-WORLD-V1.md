# Street World V1 and startup performance

Implemented and validated on 13 October 2026. Default streets use the shared `StreetWorldSystem`; `?streets=legacy` selects the old furniture exclusively. No NPCs, traffic AI, interiors, new routing, businesses, landmarks, or economy transactions were added.

## Startup before and after

Measured in isolated headless Chrome at 960×600 against local Vite. Cold means the browser HTTP cache was cleared and disabled; warm means cache enabled. This is not a cold operating-system/GPU test or a production/mobile performance guarantee. The baseline had substantial local file-serving delays. Intermediate after runs ranged from 6–41 seconds cold while Vite initialized; the final settled-server run is below. Before uses an injected loader/playability observer; after marks completion of the actual first rendered playable frame.

| Metric | Before NORMAL | After NORMAL | After LOW |
| --- | ---: | ---: | ---: |
| Cold first playable | 78.313 s | **5.362 s** | 7.575 s |
| Warm first playable | 21.967 s | **2.279 s** | 2.332 s |
| Cold long tasks >50 ms, through world settlement | 15 | 16 | 16 |
| Warm long tasks >50 ms, through world settlement | 16 | 17 | 14 |
| Largest cold long task | 2215 ms | 1169 ms | 1638 ms |
| Largest warm long task | 2048 ms | 690 ms | 524 ms |

These are individual runs, not medians. Later screenshot-only warm validations took 9.409 s NORMAL / 8.566 s LOW during a slower session; those runs preserve rather than overwrite the primary profile JSON. Startup and later streaming remain variable. No claim is made that every warm or LOW run is faster. The improvement does not come from reducing final world density.

After milestones are navigation-relative seconds. All raw timings and resource requests are retained in `data/generated/street-world/after-*.json`; before captures are `before-normal-{cold,warm}.json`. Baseline phase-specific marks were unavailable; their resource timings are retained rather than reconstructed as CPU measurements.

| Phase / milestone | NORMAL cold | NORMAL warm | LOW cold | LOW warm |
| --- | ---: | ---: | ---: | ---: |
| Module start | 0.379 | 0.197 | 0.622 | 0.243 |
| Renderer ready | 0.396 | 0.220 | 0.642 | 0.263 |
| Terrain load duration | 1.555 | 0.098 | 4.396 | 0.135 |
| Terrain mesh ready | 2.263 | 0.470 | 5.441 | 0.550 |
| Physics initialization duration, including lazy import | 0.352 | 0.159 | 0.376 | 0.149 |
| First required road tile | 2.632 | 0.601 | 5.797 | 0.756 |
| Critical road duration | 2.540 | 1.576 | 1.690 | 1.540 |
| Minimum road collision ready | 5.005 | 2.173 | 7.340 | 2.243 |
| Player spawned | 5.006 | 2.174 | 7.341 | 2.244 |
| First playable frame | 5.362 | 2.279 | 7.575 | 2.332 |
| BuildingSystem requested | 13.915 | 8.448 | 15.577 | 7.231 |
| First building tile | 14.261 | 9.036 | 15.812 | 7.418 |
| First building render | 14.774 | 9.759 | 16.130 | 7.521 |
| Building near ring complete | 15.714 | 10.666 | 16.410 | 7.810 |
| Street World first cell/render | 15.361 | 10.255 | 16.746 | 7.805 |
| Optional world completion | 29.529 | 21.154 | 20.522 | 13.041 |

`?startupDebug=1` is DEV-only. It records `performance.mark`, `performance.measure`, long tasks, and milestones for terrain, renderer, roads, collision, physics, player, buildings, streets, and optional completion. Road worker/clip/upload/collider counters are exposed through `cityverseStartupDebug.getRoadTimings()`.

| NORMAL warm road work | Critical patch | Deferred expansion |
| --- | ---: | ---: |
| Worker CPU preparation | 1310.7 ms | 14082.7 ms |
| Terrain clipping, included in worker time | 519.3 ms | 6908.4 ms |
| Three geometry/query upload, excluding collider work | 68.2 ms | 362.1 ms |
| Road + terrain collider installation | 37.1 ms | 481.4 ms |

Expansion counters are cumulative worker jobs, not one main-thread task. Worker loading/queueing and shader work can also explain elapsed road durations. Optional completion means the awaited initialization jobs have settled; individual GLTF/animation/vehicle visual callbacks remain independent. The critical patch's terrain partition is separately marked; warm partition time was 89.4 ms.

## Critical path and handover

P0 loads physics while the road manifest and spawn terrain load. Only road tiles intersecting spawn ±20 m are requested initially: `0_-1` and `0_0` in this dataset. Minimum road and terrain colliders are installed before controls start.

The initial terrain patch is 700 m / 64 segments, positioned on the final terrain's grid. Its vertex spacing and triangle diagonal exactly match the final 1,400 m / 128-segment source mesh; UVs retain the full mesh's scale. Terrain loading is bounded to this patch and later reuses already downloaded elevation tiles.

P1 enables controls, hides the blocking loader and renders a frame. Optional jobs start only after that frame. P2 prepares the full terrain and clipped spawn roads in a separate scene. Partition work yields across frames. A single synchronous handover transfers render, surface-query and collider ownership; gameplay retains the critical surface until that handover. Final road radius remains NORMAL 2 / LOW 1.

Buildings then stream nearest first with a bounded prefetch queue. A slow outer tile no longer holds the spawn shell hostage. Nearby colliders install progressively. Building radius remains NORMAL 3 / LOW 2, or 49 / 25 available tiles here. Optional architecture is already restricted by the existing mixed LOD worker; shells and facade geometry within one tile still install together. There is no separate duplicate shell pass.

P3 streams Street World and loads character visuals, animations, environment lighting and existing vehicles. Navigation/minimap loads after gameplay; CityMap remains on demand. P2/P3 failures are caught without restoring the blocking loader. Street generation does not fetch procedural cell data.

The three largest remaining bottlenecks are:

1. Engineered-road worker preparation and terrain clipping, including about 1.31 s of critical CPU work warm and 14.08 s across deferred jobs. Correct profiles, junctions, clipping and colliders remain enabled.
2. Rapier's embedded WASM bundle, still 4.33 MB raw / 1.64 MB gzip and still required for real collision. Splitting moves its fetch/parse off the initial module graph and overlaps it with terrain; it does not eliminate those bytes. External terrain requests also cost about 1.4–1.6 s cold here.
3. Deferred visual decoding, GPU shader/environment preparation and atomic geometry/collider uploads. Long tasks still occur after first playable, including a LOW cold 1.64 s outlier. Timing observation alone cannot attribute that task to one function; no claim is made that all optional work is now below 50 ms.

## Production bundle audit

Standard Node zlib gzip level 6 is used consistently for both columns below. The historical Vite display was 5,075.16 / 1,867.09 kB. The consistent file-byte/zlib audit is used below. The slightly different gzip values below use the same compression method for before and after. Decimal kB, not KiB.

| Initial JavaScript | Raw kB | Gzip kB |
| --- | ---: | ---: |
| Before | 5,075.17 | 1,840.65 |
| After | **694.13** | **182.15** |

Initial raw bytes fall 86.3%; gzip bytes fall 90.1%. Three, Sky, core roads/surface and controls remain in the entry. Physics/Rapier and RoadCollider are lazy but critical; buildings, streets, GLTF, vehicles, navigation and UI are deferred or on demand. The audit walks only references reachable from the current entry and excludes old files retained in `dist`.

| Separate JavaScript chunk | Raw kB | Gzip kB |
| --- | ---: | ---: |
| Rapier | 4332.81 | 1644.23 |
| Physics | 2.18 | 1.07 |
| RoadCollider | 1.22 | 0.66 |
| RoadWorld worker | 170.84 | 47.88 |
| BuildingSystem | 45.36 | 16.54 |
| Building rules shared chunk | 6.91 | 2.95 |
| Building worker | 19.86 | 7.99 |
| StreetWorldSystem | 22.65 | 8.67 |
| Source transit adapter | 1.01 | 0.59 |
| Existing POIManager shared chunk | 4.49 | 1.75 |
| GLTFLoader | 44.24 | 13.03 |
| VehicleSystem | 6.10 | 2.66 |
| Optional navigation/minimap | 3.04 | 1.37 |
| CityMap | 18.25 | 6.28 |

Vite production compilation passed. Vite still warns about the >500 kB Three entry and Rapier chunk. Validation builds reused copied public files (`copyPublicDir:false`, `emptyOutDir:false`); the normal repository build configuration was not changed.

## Street World budgets and behavior

Shared code uses road classes/edges, building occupancy, `WorldSurface` and label-free registry recipes. Seeds include region and source identity. Ibadan and Ogbomoso identity/cache isolation is tested; the live captures use the available Ibadan road dataset. No per-city street generator exists.

| Settled spawn, warm run | NORMAL | LOW |
| --- | ---: | ---: |
| Loaded cells / cache | 25 / 32 | 9 / 16 |
| Poles | 100 | 32 |
| Lights | 17 | 5 |
| Trees / palms combined | 29 | 2 |
| Shrubs | 9 | 3 |
| Wire line segments | 90 | 0 |
| Drain metres | 5322.8 | 2743.9 |
| Signs | 2 | 0 |
| Frontage features | 9 | 3 |
| Gates / walls / shelters | 0 / 0 / 0 | 0 / 0 / 0 |
| Additional visible triangles | **14,346** | **4,496** |
| Additional primary-pass draw calls | **9** | **6** |
| Near colliders | 5 | 2 |
| Cell generation CPU average / peak | 5.38 / 49.90 ms | 11.57 / 64.60 ms |
| Largest generation CPU slice | 9.0 ms | 32.3 ms |
| Largest batch-update CPU slice | 30.0 ms | 9.7 ms |

Generation totals can exceed 50 ms across several yielded frames. Work is split at road/building/strip or mesh-family boundaries with a 4 ms target. The table records the primary profile. In the final screenshot-only streaming pass, NORMAL generation slices peaked at 39.2 ms and batch slices at **291.9 ms**; LOW peaked at 38.6 / **67.9 ms**. The routine <50 ms target is therefore **not fully met in those outliers**. Slicing does not bound one allocation, geometry upload, GC pause or driver call; those still need further CPU/GPU attribution. The audit avoids counting time spent awaiting unrelated microtasks as street CPU work.

Across the final six views, NORMAL visible street triangles peaked at **14,808** and calls at **11**; LOW at **4,496 / 6**. Shadow passes are additional to primary draw counts. Counters conservatively include whole visible instanced batches rather than individually counting only on-screen instances.

Drainage supports concrete, shallow and earth variants or none, segments before junctions and batches surfaces. Walkways respect existing road sidewalks; generated concrete/earth edges, informal shoulders and sparse rough verges use the road style and density. No universal residential boulevard is generated.

Poles and lights use shared instanced assets, stable road spacing and selective road-class eligibility. Wires share one `LineSegments` buffer, have bounded sag and compatible same-way/side links, and break across excessive distance or height differences. Vegetation combines restrained broadleaf/palm/shrub assets. Occupancy uses spatial road capsules, exact footprint/hole checks, rendered carriageway checks, junction sight zones and local furniture separation; it avoids explicit gates. There are no per-candidate global physics queries.

FAR retains major context; MEDIUM retains trees, poles, lights, drainage and frontage; NEAR adds wires, signs and small detail. LOW shortens detail distances and reduces vegetation, wires and clutter. Substantial pole/light, wall, barrier, bollard and shelter colliders are restricted to the near range and removed with cells. Open shelters use roof/posts/seat colliders rather than a solid invisible box. Grass, wires, small signs and shrubs have no colliders.

Street names come only from real road names. Unnamed regulatory/direction holders do not invent official signs or destinations. Bins, benches, bollards, slope-eligible barriers and planters are conservative near candidates; awnings require explicit local source data. Some of these families have zero eligible instances in the captured spawn area, rather than forced showcase clutter.

## Housing context and source limits

Final NORMAL housing remains 1,231 basic, 2,355 affordable, 1,707 standard, 556 upper-mid, 7 premium and 1 luxury; 7,577 estimated units and 4,416 starter candidate units. LOW retains 2 premium / 1 luxury, 3,210 estimated units and 1,837 starter units. Affordable/basic buildings are not assigned dirt or refuse. Tier labels appear only in opted-in DEV housing inspection, never normal street UI.

Frontage uses deterministic finish and landscape recipes. Walls, gates, driveway hints and awnings require explicit local boundary/source geometry: source building footprints do not establish parcels. The current source tiles contain no such boundary input, so wall/gate counts are zero. Premium/luxury footprints are not enlarged or surrounded with guessed property walls. The captured upper-mid frontage is a T3 interpretation, not a claim about actual wealth or ownership.

Citywide scan: all 12,477 canonical Ibadan building tiles, 837,572 decoded footprints, 5 malformed records skipped. Among 756,207 residential candidates: 130,244 basic; 256,604 affordable; 246,831 standard; 120,171 upper-mid; **2,276 premium; 81 luxury**. Premium/luxury together are about 0.312%, and 1,886 footprints satisfy the existing luxury geometry eligibility test. They are very scarce under the current spacing/area rules. Weights and eligibility were not inflated. Citywide counts are offline source interpretations without live road-conflict filtering, not actual property inventory.

The existing OSM POI export has three transport records citywide, including one named bus stop, all outside the spawn neighborhood. A bounded, deferred source adapter uses this data where available. Only source bus/taxi/platform records qualify; rail stations and motor parks do not automatically become street stops. Stop shelters/benches/sign holders are explicitly procedural structures at source locations, not verified existing shelter claims. There are no invented stops at spawn and no changes to CityMap's POI data or routing.

## Validation and screenshots

All **76 client tests passed**: deterministic generation, synchronous/yielded parity, road/footprint/junction exclusion, pole spacing, wire gaps, drain segmentation, selective lights, LOW density, housing frontage, source transit, cache bounds, unload/dispose, city isolation, legacy exclusivity and optional failure. A held outer building request test proves the spawn shell and nearby collider install first. Spawn/full terrain height and UV parity and synchronous/deferred terrain partitions are tested. Existing Road World profile, junction, clipping, render/query/collider and building courtyard tests pass.

Browser smoke tests: a building manifest forced to HTTP 503 still reaches first playable and optional completion; `streets=legacy` reaches gameplay with no `StreetWorld` group. Live surface validation sampled 360 road/shoulder/terrain positions, with zero missing colliders and maximum query/collider height error **0.000095 m**. Final counts remain **6,420 / 92,070 building triangles NORMAL** and **2,744 / 37,710 LOW**, with 40 / 24 building primary draw calls at spawn. Source footprints, road classes/profile/junction geometry, CityMap, NavigationGraph, POIManager and canonical public datasets are unchanged. The physics class is extracted without changing existing stepping behavior.

Screenshots and camera/source metadata are under `data/generated/street-world/` (ignored generated artifacts). Each mode has residential, major road, junction, upper-mid frontage, affordable/standard and dense views, plus a DEV debug image. Files:

- [NORMAL residential](../../data/generated/street-world/normal-residential.png)
- [NORMAL major road](../../data/generated/street-world/normal-major-road.png)
- [NORMAL junction](../../data/generated/street-world/normal-junction.png)
- [NORMAL upper-mid frontage](../../data/generated/street-world/normal-upper-mid-frontage.png)
- [NORMAL affordable/standard](../../data/generated/street-world/normal-affordable-standard.png)
- [NORMAL dense city view](../../data/generated/street-world/normal-dense.png)
- [LOW residential](../../data/generated/street-world/low-residential.png)
- [LOW dense city view](../../data/generated/street-world/low-dense.png)
- [NORMAL debug](../../data/generated/street-world/normal-debug.png)
- [LOW debug](../../data/generated/street-world/low-debug.png)

Reproduce with a local Vite server and an isolated Chrome debug port 9222:

```powershell
node --test apps/client/test/*.test.mjs
node pipeline/world/validate-street-world.mjs
node pipeline/world/validate-street-world-smoke.mjs
node pipeline/world/validate-street-world-surface.mjs
node pipeline/world/benchmark-street-housing-citywide.mjs
npm run build:client
node pipeline/world/audit-street-world-bundle.mjs
```

`--before` on the capture script is for the unmodified baseline implementation. The final default uses real Street World; legacy rendering is only the explicit comparison toggle, not an optimization fallback. The surface validation script uses the currently connected settled debug world. `--screens-only` refreshes the two mode galleries without overwriting the primary startup profiles. No changes were committed or published.
