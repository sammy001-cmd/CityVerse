# City Map V2: exploration and place discovery

The fullscreen map opens near the current player or vehicle, uses a warm land/road palette, and supports free exploration, Follow, recentering, city overview, lazy search and place details. Selecting a destination stores its identity and region, closes the map and shows a pin or edge indicator and straight-line distance in the minimap. No route is calculated.

## Regional source pipeline

`extract-map-context.py` reads the existing local Nigeria PBF offline using the validated city configurations and shared projection. It collects roads, named places, source POIs, landuse, parks, institutional grounds, water and rivers. Multipolygon outer ways are joined and inner rings retained; clipping/simplification happens in `build-map-context.mjs`. No raw PBF, citywide building footprint layer or server routing graph is emitted.

Map manifests and data are under `apps/client/public/data/world/<slug>/map/`; the small map-region index is under `data/city-map-v2/regions.json`. One provider selects the current region using world-coordinate bounds. Activating a new region clears its cache, registry and search index; stale responses cannot install data in the new region. Both regions use the same code. Adding a validated city config and passing its slug to both pipeline commands extends coverage.

The overview contains only major roads and coarse land context. Near views stream combined basemap/POI tiles of 1 km, using local geometry coordinates and absolute POI coordinates. NORMAL permits 48 cached tiles and three concurrent requests; LOW permits 24 and two. Per-view requests are capped at 36 / 20 respectively, nearest first. Far views request no detail tiles. Queued work outside the view is discarded; in-flight requests may finish. The complete regional search index is fetched only on a nonempty search; selecting a result fetches at most its metadata tile.

`LandmarkRegistry` retains source identities, coordinates, region, category, importance, label priority and a null future model override ID. It rejects records without a source or from another region. Source-backed name aliases support common abbreviations where matching records exist. Polygon POI anchors are derived from source vertices and are map anchors, not verified entrances. Missing phone, address, hours and website fields are omitted. Importance/landmark eligibility are map interpretations of source names and categories, not verified designations. No landmark model was created and no missing landmark coordinate was guessed. Adamasingba Stadium was not found by that name; a source pharmacy referring to Adamasingba Junction remains a pharmacy, and no stadium location was invented. A named road is excluded from fallback landmark eligibility; LAUTECH aliases apply to source university names, not Ladoke Akintola Avenue.

## Runtime boundaries

CityMap remains a dynamic import. Its UI, provider, registry, regional data and search index are absent from startup requests. The minimap imports the small shared map design in the deferred optional-navigation job and reads only `RoadSystem.getRoadEdges()`. It never fetches CityMap tiles or a navigation/routing graph. The pre-existing lightweight public `road-tiles/navigation-graph.json` remains for compatibility but is unused by the minimap; the full server routing graph remains outside public.

The existing game update supplies position while CityMap is open. Hidden 3D rendering pauses while the fullscreen map is opening/open after the required first playable render; physics and streaming continue. Closing a map during pending data resumes 3D rendering immediately. Deferred GPU/shader preparation can still cost time on returning to the game. Walking uses player position/yaw; driving uses vehicle position/heading. The adapter accounts for their different forward conventions. Fullscreen maps remain north-up; the driving minimap rotates streets around the centered vehicle. Rendering is invalidated by interactions or streamed data, with live redraws capped at 10 Hz. Follow streaming is based on displacement and cannot starve under continuous movement. No permanent second animation loop was added.

Labels use actual measured rectangles, duplicate-name rejection, zoom rules and budgets of 48 NORMAL / 32 LOW. Markers use screen-cell separation and budgets of 85 / 45. Source geometry and building footprints are not drawn as individual buildings. Mobile uses pointer capture, drag/pinch anchoring, horizontal category chips, large controls, a bottom detail sheet, safe-area offsets and DPR caps of 1.5 NORMAL / 1 LOW. Escape closes the dialog, Tab remains inside it, and map input is blocked from gameplay.

Overview, tile, search and metadata failures are caught independently. Controls and the player marker remain available; overview/registry or nearby roads continue where available. Failed search permits retry, failed tiles have the shared cache's cooldown, and reopening can retry an unavailable overview.

## Validation and measurements

Implemented and validated on 13 October 2026. All 95 client tests and five pipeline checks pass; production compilation and the bundle/protected-source audit pass. Browser validation produced zero uncaught exceptions. Native touch pinch preserved its world anchor exactly, the mobile document remained 390 CSS pixels wide, and its canvas backing width was capped at 585 pixels. The final driving capture recorded 2.39 m of real vehicle movement; marker and Follow center matched vehicle coordinates. The minimap retained 196 nearby road edges after the terrain/road handover, with a visible offscreen destination indicator and distance. Forced overview, detail/POI and search failures left controls and location available. Ogbomoso was validated with a map-only regional fixture using shared world coordinates, without moving the Ibadan 3D runtime outside its existing road coverage. Raw profiles, source extracts, screenshots and the isolated browser profile live under `data/generated/city-map-v2/` and are ignored generated artifacts. No changes have been committed or published.

Reproduce from the repository root with the existing local PBF and an isolated Chrome debug port 9222:

```powershell
pipeline/world/.venv/Scripts/python.exe pipeline/world/extract-map-context.py --regions ibadan ogbomoso
node pipeline/world/build-map-context.mjs
node --test apps/client/test/*.test.mjs
node pipeline/world/test-city-map.mjs
node pipeline/world/test-map-context.mjs
npm.cmd run build:client
node pipeline/world/audit-city-map-v2.mjs
node pipeline/world/validate-city-map-v2.mjs --game-only
node pipeline/world/validate-city-map-v2.mjs
```

The normal build copies public data. During local validation the production compile reuses the already copied public directory with `copyPublicDir:false, emptyOutDir:false`; new regional map data is copied explicitly into the production output; repository build configuration is unchanged.

## Map opening and data budgets

Measured in isolated headless Chrome, 960×600, against local Vite. Cold clears/disables the browser HTTP cache; warm enables it after a cold pass. These are individual runs, not medians or a production/mobile guarantee. Times start at the user's open action and include lazy module loading; UI paint contains the player and controls, basemap paint adds the overview/context, and detail paint is the first nearby tile. Settled-view timing includes the validation polling interval.

| Browser cache | First UI paint | Basemap paint | First detail paint | View settled | Peak map render CPU at open |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cold | 2.370 s | 2.426 s | 2.610 s | 2.962 s | 8.3 ms |
| Warm | 0.901 s | 0.958 s | 1.291 s | 1.832 s | 8.5 ms |

Earlier captures ranged from 0.144–0.802 s for UI paint before the final rendering policy, and later intermediate runs took 3–6 seconds through settlement while optional world work and serving were busy. They remain in the ignored profile directory. No claim is made that every warm run is faster. In the final normal opens, map render CPU peaked at 8.3 / 8.5 ms; the Ogbomoso fixture had a 57.9 ms render outlier. Global long tasks can also include the existing optional world work; they cannot all be attributed to the map.

| Source data, raw bytes | Ibadan | Ogbomoso |
| --- | ---: | ---: |
| Overview | 322,740 | 177,097 |
| Landmark registry | 42,906 | 7,063 |
| Lazy search index | 68,435 | 10,213 |
| Detail tiles available | 914 | 906 |
| All detail tile bytes, never loaded together | 10,879,609 | 2,633,641 |
| Largest tile | 36,514 | 19,073 |
| Named POIs / places / search entries | 433 / 76 / 911 | 84 / 10 / 121 |

Default Ibadan opens loaded 16 tiles, totaling 242,180 bytes, including 21,298 bytes of POI JSON. POI bytes are a subset of combined tile bytes, not additional requests. Index and manifest add 758 / 8,788 bytes. Search bytes remain zero until a search. Retained serialized map data at initial open is approximately 0.608 MB; this is a JSON-size estimate, not a JavaScript heap measurement. Whole-page heap observations are retained in the profiles and include concurrent engine/building/vehicle work, so their change is not attributed exclusively to CityMap.

Final screenshots used at most 30 of 48 NORMAL cached tiles, 15 visible POIs and four name labels. Budgets remain 48 / 32 names and 85 / 45 markers for NORMAL / LOW. Default source roads here have no eligible local names and show one nearby POI; names and clutter were not invented to fill the view. LOW cache/concurrency, density and DPR policies are covered by tests. Ogbomoso's fixture used 20 cached tiles, 21 registry records and 121 search entries.

## Bundle boundary

Consistent Node zlib gzip level 6, decimal kB. Initial JS changes from 694.125 / 182.149 kB raw/gzip to 694.566 / 182.306 kB: +441 / +157 bytes, below 0.1%. No new regional map, search or routing data is requested before opening CityMap. Vite's existing large Three/Rapier chunk warning remains.

| Deferred chunk | Raw kB | Gzip kB |
| --- | ---: | ---: |
| CityMap-BkfRGQNf.js | 28.833 | 9.317 |
| POIManager-DsRagYUJ.js | 4.528 | 1.767 |
| MapDesign-DWGodc_-.js | 1.860 | 1.080 |
| CityMap-CSEVZ1Xa.css | 6.758 | 1.840 |
| OptionalNavigation-B4u9CAhi.js | 4.598 | 1.928 |

The audit verifies unchanged SHA-256 hashes for RoadSystem, RoadGeometry, RoadSurface, RoadTerrainBlend, StreetWorldSystem/Rules, BuildingSystem, ResidentialRegistry, Physics, VehicleSystem and TerrainSystem against the pre-task snapshot. Existing canonical road/building datasets and routing format are unchanged. No full server routing graph is under public and no route calculation/API was added.

## Startup comparison

The final same-host production comparison measured first playable at 10.499 s cold / 5.265 s warm for the retained pre-map entry and 4.833 s cold / 2.434 s warm for the current entry. These are individual runs using the loader/playability observer, not medians. Neither entry requested new map or search data before opening CityMap. This confirms no observed regression in the final pair; it does not establish that CityMap caused a startup speedup. Earlier runs during the offline PBF extraction were slower for the current entry and remain in `startup-production-during-extraction.json`; the final measurements are in `startup-production.json`. External terrain, concurrent work and host serving remain variable.
## Screenshots

- [Default near player](../../data/generated/city-map-v2/default-near-player.png)
- [Full Ibadan](../../data/generated/city-map-v2/full-ibadan.png)
- [Neighborhood](../../data/generated/city-map-v2/neighborhood.png)
- [POI-heavy view](../../data/generated/city-map-v2/poi-heavy.png)
- [Selected UCH](../../data/generated/city-map-v2/selected-landmark.png)
- [Driving and live Follow](../../data/generated/city-map-v2/driving-live-position.png)
- [Minimap destination](../../data/generated/city-map-v2/minimap-destination.png)
- [Mobile details](../../data/generated/city-map-v2/mobile.png)
- [Ogbomoso overview](../../data/generated/city-map-v2/ogbomoso-overview.png)

This phase stops at destination state and straight-line feedback.

