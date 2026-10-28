# Road World V4 status

**Current gate: integrated representative subset is ready for in-game review; visual and driving approval remain pending.** V4 is available in the local development game with `?roads=v4-preview`. This mode uses the existing polygon tile renderer, terrain replacement, `WorldSurface` queries, road collider manager, spawn selection, vehicle spawning, and optional StreetWorld integration. No routing or property gameplay was added. The normal production `RoadSystem` remains the default.

## V4.1 surface and collision recovery

The Team Lead reported sinking and unreliable contact. Inspection found a concrete winding defect: triangulation is performed in X/Z, then mapped to Three.js X/Y/Z, which reverses orientation. The old indices produced downward normals; a Rapier control simulation with that winding fell through to Y=−36.2 m. V4 triangles now reverse their final two indices, producing upward normals. Rendering, `RenderedRoadSurface`, and `RoadCollider` consume the same final indexed mesh. `WorldSurface` queries its triangles directly, and the collider conversion now exposes the transformed world-space vertex/index data for parity checks.

The DEV-only `?roads=v4-preview&v4TerrainReplace=0&roadV4PhysicsDebug=1` path keeps the original terrain mesh visible and installs its original terrain collider. V4 roads drape to the authoritative terrain mesh and sit 3.5 cm above it. This diagnostic path skips terrain replacement and StreetWorld. Add `&roadColliderDebug=1` to show a red wireframe built from the exact road collider input triangles. The physics HUD reports terrain, rendered-road, WorldSurface, and Rapier raycast heights; differences; road/tile/triangle identity; player grounding; wheel contacts; and WorldSafety recovery count.

Automated validation passes: 5 V4 tests cover upward normals, render/query/collider vertex and index identity, Rapier raycast height/normal, and a dynamic body resting on the V4 surface above an untouched terrain collider. The live browser gates remain unreviewed. In particular, the Team Lead must still confirm walking, vehicle wheel contact, steering, curves, junctions, and then terrain replacement and StreetWorld in order. Do not expand coverage or add routing.

## Geometry and runtime

The offline [V4 builder](../pipeline/world/build-road-world-v4.py) reads the CityMap OSM source, preserves way IDs and source nodes, applies road class and width selection, bounded centerline corner cuts, Shapely round buffers, and a global polygon union before clipping into 250 m tiles. The browser triangulates these polygons and holes in [V4PolygonRoadTile.js](../apps/client/src/world/V4PolygonRoadTile.js). The rendered mesh is shared with collision tagging and `RenderedRoadSurface` queries. Buffering and union stay at build time.

V4 runtime integration is implemented in [V4RoadSystem.js](../apps/client/src/world/V4RoadSystem.js) and selected in the game boot path in `main.js` only for local development with `?roads=v4-preview`. Roads are draped to a smoothed terrain profile with shared elevations at OSM junction nodes. `RoadTerrainBlend` cuts terrain around the rendered road surface and installs matching terrain colliders. V4 reports road IDs and road classes from rendered surface queries and exposes source road edges with sequence, width, and endpoint node identities. The broader CityMap data remains separately available.

Widths use OSM `width` or `lanes` where usable, then class defaults: service 3.6 m, residential/living street/unclassified 6 m, tertiary 7.2 m, secondary 8 m, primary 10 m, trunk 10 m, and motorway 14 m. These are initial estimates, not surveyed widths or final vehicle-scale approval.

## Representative subset and connectivity audit

The current subset spans X/Z −700…+700 m around the shared Ibadan projection origin. The latest generated audit reports 35 non-empty tiles, 84 clipped polygons, and 6 polygon-union components. It preserves 160 way IDs on polygon features; the per-tile centerline index contains 162 unique ways and 1,100 source segments. A node-identity connectivity pass over those centerlines finds 6 components: the largest has 155 ways, with component sizes 155, 3, 1, 1, 1, 1 (four isolated one-way fragments). This local sample is not one fully connected network.

Compared with all 56,597 CityMap ways, 160 IDs occur on V4 polygon features, with zero unexpected IDs and zero unexplained omissions. Of the remaining map ways, 56,435 are outside the review window and two have no positive-area surface after clipping. The latest audit measures 298,230 bytes of tile JSON, 3,954 road triangles, and 29.96 ms for Node decode, triangulation, and query indexing. These are offline measurements, not browser GPU or driving benchmarks. See [road-world-v4-subset-audit.json](road-world-v4-subset-audit.json).

This sample is centered on the projection origin and does not connect or claim reachability between UI, Bodija, Sango, Mokola, UCH, Agodi, Dugbe, Ring Road/Challenge, and Iwo Road. Named-destination reachability must be audited after the initial multi-district playable selection is built. Do not expand coverage until the live subset has been visually reviewed.

## Review gate

The standalone preview at [road-v4-preview.html](../apps/client/road-v4-preview.html) remains a flat geometry preview. In-game validation must use `?roads=v4-preview` and inspect the terrain handover, rendered/collision agreement, intersections, building conflicts, StreetWorld, LOW/NORMAL streaming, and Suzuki Carry scale and driving. The current code provides a V4 debug object at `globalThis.cityverseRoadV4Debug` for surface, vehicle, performance, building-conflict, and recovery inspection. Team Lead screenshots and driving approval have not been recorded, so the initial playable network expansion remains gated.

No all-city processing has been performed. Routing remains out of scope.
