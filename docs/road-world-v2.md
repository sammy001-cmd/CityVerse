# Road World V2

## Surface integrity and streaming

`RoadTerrainBlend` partitions the original terrain into 250m chunks and clips
each affected terrain polygon against the actual asphalt, gutter/shoulder,
earth ribbon, sidewalk and junction footprints. Remaining boundary vertices
are stitched to the adjacent engineered triangle height. This avoids the
cell-sized holes caused by simply deleting terrain grid cells.

Visible terrain and Rapier use exactly the same replacement geometries.
The original whole-terrain collider is removed when collision is attached.
Terrain under roads cannot compete with their wheel contact surface. Road
unload restores the original terrain and its collider in the affected chunks.
The immutable original height grid remains the source of engineering profiles;
there is no feedback loop from edited terrain to road heights.

Road/junction/terrain preparation runs in `RoadWorldWorker` in browsers. Current
surfaces stay active until the prepared geometry, queries and colliders are
installed together in a single main-thread turn. Dirty chunks alone are
reclipped; unchanged tiles are reused. Node tests and browsers without a usable
worker use a deterministic synchronous fallback. No extra npm dependency,
texture download, routing graph or navigation calculation was added.

## Road defaults

These are game defaults rather than surveyed Nigerian engineering dimensions.
Source widths override defaults. Explicit sidewalk metadata is required.

| Class | Default lanes × lane width | Shoulder/gutter | Markings | Sidewalk eligible |
|---|---|---|---|---|
| Motorway | 4 × 3.5m | 2m | solid center, edge | no |
| Trunk | 2 × 3.5m | 1.8m | broken center, edge | no |
| Primary | 2 × 3.3m | 1m | broken center, edge | yes |
| Secondary | 2 × 3.2m | 0.8m | broken center, edge | yes |
| Tertiary | 2 × 3m | 0.7m | broken center | yes |
| Residential | 2 × 2.75m | 0.7m | none | yes |
| Unclassified | 2 × 2.75m | 0.8m | none | no |
| Service | 1 × 2.5m | 0.4m | none | no |
| Living street | 1 × 2.5m | 0.3m | none | yes |

Narrow roads and one-way roads omit opposing center lines. `_link` classes
inherit their parent cross-section. Optional `sidewalk: true/both/left/right`
adds a simple 0.12m curb and default 1.4m sidewalk, with a sloped outer earth
ribbon. Current tile data does not contain surveyed sidewalk metadata, so
existing roads receive no invented sidewalks automatically.

## Geometry and junctions

Each tile batches asphalt, shoulders, earth, curbs, sidewalks and paint by
shared material. Asphalt uses vertex tint for road hierarchy. Center/edge lines
are thin batched triangles and follow the discretized profile. Low mode omits
edge lines and reduces streaming radius from two tiles to one; collision
geometry is unchanged. Road sections remain at most 2m long.

Shared-way endpoints use common averaged heights and miters across loaded tile
boundaries. Junction arms approach a common central apron with smooth profile
blending. Convex apron hulls avoid folded fans, and covered strip/paint/sidewalk
geometry is clipped out instead of stacked. Clipped road boundaries are stitched
to the apron. Rendering, walking and collision query the final triangles.

`RoadSystem.getRoadEdges(bounds?)` exposes source ID/type, width, lane default,
shoulder/sidewalk dimensions, directions, section heights and setback edges for
future driveways, entrances and street furniture. It does not generate buildings.

## Verification and measured cost

```text
node --test pipeline/world/test-city-map.mjs apps/client/test/*.mjs
node apps/client/scripts/benchmark-road-world-v2.mjs --low
node apps/client/scripts/benchmark-road-world-v2.mjs --district --low
npm.cmd run build:client
git diff --check
```

The densest current tile has 143 road segments. A Node benchmark with synthetic
terrain measured approximately 6,645 road triangles, four road mesh batches and
0.88MB of road attribute buffers. Synchronous preparation was about 0.71s on
the development machine, including 0.29s of terrain clipping. Browser production
preparation uses the worker; these figures are CPU/geometry measurements, not
Android FPS measurements. The initial 1400m terrain becomes 36 chunks instead
of one terrain draw call. Dirty chunk geometry and Rapier collider installation
still have a main-thread cost.

Tests cover exact exclusion, restored terrain on unload, exposed floor versus
Rapier rays, worker transactions, class rules, sidewalk batching, marking LOD,
cross-tile endpoints and junction replacement. The previous unmasked overlap
fixture remains to demonstrate why exclusion is required.

## Remaining limits

This is an at-grade road system: layered bridges/tunnels and grade-separated
road collisions require elevation/layer metadata and a separate implementation.
Stop lines, lane-specific turning markings, driveways and buildings are deferred.
Dash phase is continuous on straight source segments; curved-way chainage is
not yet represented by the tile contract. Convex junction aprons are intentionally
simple and do not model traffic islands or roundabout furniture.

Real low-end Android profiling and a live visual/vehicle walkthrough are still
required. Worker clipping can delay newly streamed terrain; until it completes,
the previous consistent road/terrain state stays active. If workers are unavailable,
the synchronous fallback can cause a noticeable loading hitch.
