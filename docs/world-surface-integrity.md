# World surface integrity

Walking keeps the player root at the feet, with no extra height offset. The
grounded path follows `WorldSurface.sample().height`; an explicit jump clears
grounded and integrates gravity until landing. Grounded downhill motion does
not repeatedly enter an airborne state.

## Terrain topology

After rotating Three.js PlaneGeometry into X/Z, a cell has heights `a` at
top-left, `b` at top-right, `c` at bottom-left and `d` at bottom-right. Its
indices connect **b to c**, so the triangle choice is `tx + tz <= 1`.
The former `tx >= tz` code instead interpolated across a-d and could place
the player below the visible terrain. The non-planar regression fixture
returns 15 metres at the center; the former calculation returned 40 metres.

Validation uses downward Three.js ray intersections with actual indexed
triangles, not raw terrain elevation. Road queries likewise use a spatial
index of the final asphalt, shoulder and junction triangles. This includes
discretized longitudinal profiles and mitered endpoints. Markings are paint,
not walking/collision surfaces. Triangle entries are removed on tile unload.

## Engineered roads and collider overlap

RoadCollider and Physics.addTerrainMesh already copy the corresponding
rendered vertices/indices with world transforms. Tests verify these agree
with the meshes, including a fixture with terrain above an engineered road.
No collider vertex or index correction was necessary.

Longitudinal road smoothing can lower a road below terrain. The terrain is
currently neither cut visually nor removed from the Rapier collider. Both
surfaces remain present, so wheel suspension rays can contact the protruding
terrain first; the chassis may also contact it. This overlap remains and
requires a coordinated terrain cut/fill or collision-hole solution later.

Walking has no Rapier body, so its interpolation bug is separate from wheel
physics. WorldSurface now selects the exposed top triangle of the actual
terrain/road coverage. It does not globally raise engineered road vertices
or clamp their profile to raw terrain. Terrain wins only where its still
visible mesh covers the queried road. Junctions are sampled as rendered
road triangles rather than as a nearby analytic segment.

## Diagnostics and validation

In the development server, append `?surfaceDebug=1` (or `&surfaceDebug=1`).
A small HUD reports player x/z/y, sampled height, difference, surface type,
road ID when available, grounded state and driving state. It updates with
the existing HUD; production builds disable it.

Run all current tests with:

```text
node --test pipeline/world/test-city-map.mjs apps/client/test/*.mjs
npm.cmd run build:client
git diff --check
```

The tests cover terrain vertices/edges/diagonals and multiple cells,
transformed terrain, terrain discretization, terrain/shoulder/road/junction
transitions, buried road coverage, unloading, grounded slopes, jumping, and
the separate terrain and road Rapier colliders.
