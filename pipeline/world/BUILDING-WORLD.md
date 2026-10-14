# Building World V1 - Phase A.5: multi-city data architecture

The production source is the existing local `pipeline/world/source/nigeria-latest.osm.pbf`. No Overpass request is made. The PBF and verbose JSON source/report stay gitignored and outside `public/`. The browser has no building-tile loading integration in Phase A; `main.js` continues to use the legacy building renderer, footprints, and colliders.

## Rebuild and validation

Use the existing pyosmium environment (requirements are in `requirements-buildings.txt`):

```powershell
pipeline/world/.venv/Scripts/python.exe pipeline/world/extract-buildings.py --city ibadan --city ogbomoso
node pipeline/world/build-building-tiles.mjs --city ibadan
node pipeline/world/build-building-tiles.mjs --city ogbomoso
node pipeline/world/benchmark-buildings.mjs --city ibadan
node pipeline/world/benchmark-buildings.mjs --city ogbomoso
node pipeline/world/build-world-regions.mjs
pipeline/world/.venv/Scripts/python.exe pipeline/world/test-buildings.py
node --test pipeline/world/test-world-regions.mjs pipeline/world/test-building-data.mjs pipeline/world/test-city-map.mjs apps/client/test/*.mjs
npm.cmd run build:client
git diff --check
git status --short
```

`npm.cmd` runs the same npm script on Windows where PowerShell blocks `npm.ps1`. Normal unit tests use synthetic fixtures and do not read the Nigeria PBF.

## Source and coordinates

City definitions live in `pipeline/world/cities/<slug>.json` and are validated by `city-config.mjs` and `city_config.py`. They contain slug, display name, country/state, bbox, shared projection reference, tile size, enabled layers and optional build metadata. The Ibadan config preserves the authoritative road extractor's bounds exactly; regression tests compare them. No extraction or normalization implementation branches on a city name.

`projection.json` defines one fixed world origin: latitude 7.3962, longitude 3.8968. All regions reference `cityverse-metric-v1`, with the existing CityVerse convention:

```
worldX = (longitude - origin.longitude) * 111320 * cos(origin.latitude)
worldZ = -(latitude - origin.latitude) * 110540
```

The origin is not recentered per city. Ogbomoso therefore occupies its real displacement in the same X/Z frame. Appearance seeds still reuse the validated FNV-1a helper and depend only on the full OSM identity, never the requested city. Tile size comes from the config; both current regions use 250 m. The generic `extract-buildings.py --city <slug>` CLI delegates to one `building_extraction.py` implementation. Repeating `--city` shares one national PBF scan and one geometry decode between the requested regions. The old named extractor is only a compatibility entry point.

North is negative Z. The builder rejects sources or road manifests with mismatched origins; tests compare the existing pipeline constants. No road/map/POI implementation is changed.

Extraction uses pyosmium area assembly for closed ways and multipolygon relations, including split outer ways and holes. It keeps an explicit tag allowlist, `way:<id>` / `relation:<id>` identities, and relation member IDs. Whole intersecting buildings stay intact at the bbox boundary. Successful geometry validation and quantization precede deduplication: a rejected relation cannot hide a valid tagged member way. Unassembled local relations are reported as deferred, rather than replaced with invented geometry.

Build-time outputs:

- `data/generated/world/<slug>/buildings-source.json`: geographic geometry, approved original tags, members, extraction statistics and deferred identities.
- `data/generated/world/<slug>/buildings-report.json`: production metrics, rejected identities/reasons, deferred relations and heavy road-overlap candidates.

## Geometry and normalization

Cleaning removes duplicate closing/consecutive vertices, rejects nonfinite or malformed coordinates, fewer than three distinct vertices, self-intersections/self-touching rings, invalid holes and overlapping polygon parts. It calculates net area, bounds and the area-weighted centroid across all outer rings minus holes. Footprints smaller than 1 m² are rejected; valid footprints above 100,000 m² are flagged, not discarded. A single footprint above 5,000,000 m² or spanning over 10 km is treated as implausible. There is no arbitrary 512-vertex limit. Quantized geometry is validated again; buildings are rejected as a whole rather than silently dropping broken parts or holes.

Classification favors explicit amenity/healthcare/tourism/office/shop/building semantics. Unknown `building=yes` remains generic/inferred. Height priority is valid explicit height, then valid building levels, then family defaults with stable identity-seeded variation. Metres and feet are supported; invalid tags are reported. Floor heights are 3.1 m for residential/generic, 3.6 m for institutions/commercial, and 5.5 m for industrial/warehouse. Inferred buildings remain low/mid-rise. Explicit `roof:height`, minimum height and minimum levels are used where valid; original roof-level/material values remain in sparse tags. Fallback roof forms are deterministic, with flat roofs for taller/commercial buildings. Unknown explicit roof forms map to `other` while the original tag is retained. Appearance seeds use stable unsigned FNV-1a over the full source identity.

## Client schema

Each city owns `apps/client/public/data/world/<slug>/buildings/manifest.json` and `tiles/<tx>_<tz>.json`. Tile keys are scoped by the region URL, not a global filename namespace. `version: 1`, `schemaVersion: 2`, and `pipelineVersion: building-world-v1-phase-a5` identify this data contract. This is intentionally **not** the disabled scaffold renderer's original tuple layout. Future integration must explicitly adapt the decoder and check the schema version; do not enable BuildingSystem merely because tiles now exist.

Manifest tables document categories, roofs, height sources, approved tag keys, tuple fields and flag bits. Each tile has `tx`, `tz`, a shared `strings` table (`0 = absent`), and `buildings` tuples:

```
[id, categoryId, heightMetres, levels, minHeightMetres, roofId, appearanceSeed,
 nameStringId, flags, heightSourceId, polygons, sparseTags]
```

`sparseTags` is a flat list of `[tagKeyId, valueStringId, ...]`, preserving only approved source tags. Classification provenance is bit 1 (explicit; unset means inferred), roof provenance is bit 2, large footprint is bit 4, and heavy road overlap is bit 8. These annotations do not change rendering or geometry.

Each building belongs to its configured-size tile containing its area-weighted unquantized footprint centroid. Signed integer footprint coordinates use 0.1 m units relative to that owner tile:

```
worldX = tx * tileSize + localX * 0.1
worldZ = tz * tileSize + localZ * 0.1
```

Floor division handles negative tiles. Geometry may extend beyond its owner tile; it is neither clipped nor duplicated. Relations retain multiple outer rings and practical valid holes. Stable source IDs provide the lookup key for a future landmark registry; no models or landmarks are built in Phase A.

## Road analysis and limitations

The builder reads existing production road tiles without altering them. It deduplicates repeated road segments, spatially indexes carriageway rectangles, subtracts footprint holes, and flags approximate summed overlap of at least 25% of footprint area. Adjacent/junction rectangles can overlap, so this is a review candidate statistic rather than exact union area. Available production roads cover the current central district, not the entire Ibadan building extent; buildings without nearby road records are unassessed. Shoulders/junction aprons, vertical bridge separation and building entrances are not analyzed. No footprint is moved, omitted or distorted because of a road conflict.

OSM coverage, names, semantic tags, heights and roof tags are incomplete. Generic classification and inferred heights are not surveys. Missing relation members, unsupported relation types and unsafe geometry are counted/reported. Relations entirely missing all locatable members cannot be assigned to a region and therefore are not included in local deferred counts; national scanned relation counts remain available. No runtime tile streamer, procedural facade, landmark, terrain change or physics change belongs to this phase.

Attribution: © OpenStreetMap contributors. Dataset license: ODbL-1.0.

## Ogbomoso extent and provenance

The Ogbomoso config is derived from the full bounding-box union of Ogbomosho North and South in GRID3's 2022 administrative dataset, distributed by [geoBoundaries NGA ADM2](https://www.geoboundaries.org/api/current/gbOpen/NGA/ADM2/). The [geometry release is pinned to 9469f09](https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/NGA/ADM2/geoBoundaries-NGA-ADM2.geojson). Shape IDs and the original union bbox are retained in the city config, with GRID3/CC BY 4.0 provenance. Oyo State also identifies these two LGAs in its [official local-government list](https://oyostate.gov.ng/local-governments/).

The original union spans longitude 4.1756586462 to 4.3271948256 and latitude 8.0553353173 to 8.2144367322. Add at least a 2 km fringe and expand each dimension to at least 30 km using the shared projection scale, matching the existing Ibadan build convention. Round outward to six decimals. The resulting build bbox is south 7.999188, west 4.115549, north 8.270584, east 4.387304. This is a deliberately broader project build extent, not a claim that the rectangular bbox is an official municipal boundary. Buildings intersecting the bbox are preserved whole.

## Region index and inactive-region cost

`apps/client/public/data/world/regions.json` is a lightweight descriptor index generated by `build-world-regions.mjs`. It contains projection metadata, each region's geographic/world bounds, enabled layers, and layer-manifest URLs. It never embeds building records, tile-key lists, or another city's manifest. `world-region-index.mjs` defines a pure future selection contract: match the player's shared world position, retain a preferred matching region when boxes overlap, then return only that region's building-manifest URL.

Future client integration must unload the old region before activating the new region and request only nearby active-region tiles. Inactive regions must allocate zero geometry, zero draw calls and zero tile requests. This phase does not install that client integration: BuildingSystem, main.js, CityMap, Minimap, navigation, roads and vehicle physics remain unchanged. The browser currently makes no building-data requests for either region.

## Generated-data Git policy and future deployment

Commit code, tests, city configs, projection metadata and versioned schema specifications. The ignore policy allows reviewed `world/regions.json` and per-city `buildings/manifest.json` metadata to be committed. It excludes every generated tile and all other mass assets beneath `public/data/world/`, the previous unscoped building-tile outputs, raw PBF/boundary downloads and `data/generated/world/` sources/reports. A normal `git add .` cannot add tens of thousands of generated world tiles. A fresh checkout has metadata only and must build or obtain the matching asset package.

Future world-data publishing is a separate release step, not a source-repository commit:

1. Pin the input PBF, boundary provenance, city configs and pipeline/schema/projection versions for a release. Build the required regions and audit every generated tuple, identity and file count.
2. Package only `data/world/<slug>/buildings/manifest.json` and its matching `tiles/`. Keep PBFs, verbose geographic sources and diagnostic reports out of the package. Produce file hashes and an immutable release identifier outside the main source repository.
3. Upload complete region packages to asset/object storage or a dedicated world-data deployment. Serve them through the documented region-scoped paths. Use immutable caching for release asset paths; keep the small region index revalidated/versioned.
4. Verify all referenced tiles are deployed before publishing the matching city manifests and lightweight region index last. Reviewed source manifests must never advertise incomplete remote releases. Deploy new assets atomically or under a versioned prefix so clients cannot mix old manifests with new tiles.
5. Only a later rendering phase may connect the client to those assets. Do not enable BuildingSystem as part of publishing data.

The current build creates local assets and reviewed metadata; it does not upload or publish them. Existing unscoped Phase A outputs were moved intact into the ignored build archive at data/generated/world/archive/phase-a-building-tiles.

## Data-quality contract and remaining architecture limits

Inferred category/family, height and roof are procedural rendering inputs only. The tuple keeps explicit-vs-inferred classification flags and the height-source enum independently. `explicit_levels` identifies a computed height from tagged floor counts, not a measured height. Even `explicit_height` and explicit OSM semantics are source-tagged values, not independently verified surveys. Every city manifest includes this inference policy. Unknown generic buildings must never be presented as verified residential, commercial or other real-world metadata.

Current region ownership is bbox-based, not exact administrative-polygon clipping; overlap between future boxes can include the same stable OSM ID in two regional packages. The selector chooses one active region at a time; future streaming must deduplicate by identity during transitions. One fixed origin preserves compatibility and inter-city displacement, but this local metric approximation is not a nationwide geodesic CRS. A future projection change must use a new projection version and migrate all dependent world layers together. Floating-origin rendering may later keep precision without changing authoritative coordinates. No such client or physics work belongs to this phase.

Ogbomoso has no configured production road data, so its road-overlap analysis is explicitly unavailable. Ibadan uses only its current central-district road tiles; do not treat unassessed buildings as conflict-free. PBF extraction is still a substantial national scan. Repeat `--city` to batch regions, or use a deliberately prepared local PBF input via `--input`; normal tests remain small synthetic fixtures.

## Historical Phase A baseline - 11 October 2026

The real local Nigeria PBF was scanned: 19,350,325 building ways and 37,201 building relations nationwide. Ibadan candidates: 835,720 building ways and 2,085 assembled multipolygons. One additional local relation type could not be assembled under this scope.

| Metric | Result |
| --- | ---: |
| Usable unique buildings | 837,577 |
| Accepted ways | 835,493 |
| Accepted multipolygon relations | 2,084 |
| Duplicate member ways removed | 8 |
| Rejected buildings | 220 |
| Deferred relations | 2 |
| Named buildings | 264 |
| Client tiles | 12,477 |
| Raw tile bytes | 94,818,053 |
| Manifest bytes | 111,363 |
| Total client bytes | 94,929,416 (90.53 MiB) |
| Average tile bytes | 7,599 |
| Largest tile bytes | 46,052 |
| Maximum buildings in one tile | 381 |
| Explicit height | 6 |
| Height from explicit levels | 435 |
| Real height or levels | 441 (0.05265%) |
| Inferred height | 837,136 (99.94735%) |
| Explicit roof shape | 1 |
| Inferred roof shape | 837,576 |
| Buildings with holes | 2,055 |
| Buildings with multiple outer rings | 17 |

Category distribution:

| Category | Buildings |
| --- | ---: |
| residential_low | 776 |
| residential_multi | 9 |
| commercial | 78 |
| mixed_use | 0 |
| office | 1 |
| school | 22 |
| university | 3 |
| hospital | 20 |
| clinic | 2 |
| hotel | 7 |
| industrial | 9 |
| warehouse | 0 |
| government | 1 |
| place_of_worship | 34 |
| market | 1 |
| parking_structure | 7 |
| generic | 836,607 |

Roof distribution: flat: 131; gable: 418,713; hipped: 418,733; pyramidal: 0; shed: 0; other: 0.

The ten largest tiles by raw bytes:

| Tile | Buildings | Bytes |
| --- | ---: | ---: |
| -5_-3 | 365 | 46,052 |
| -4_6 | 352 | 44,235 |
| -3_7 | 363 | 42,922 |
| -2_5 | 353 | 42,866 |
| 5_1 | 361 | 42,484 |
| -2_13 | 346 | 41,736 |
| -4_7 | 353 | 41,655 |
| -3_6 | 339 | 41,546 |
| 3_10 | 357 | 41,387 |
| 10_20 | 381 | 40,876 |

Rejection reasons: invalid_hole: 1; tiny_footprint: 206; quantization_self_intersection: 4; quantization_tiny_footprint: 9. Deferred: relation:17223083 (unsupported_relation_type); relation:17738729 (invalid_hole). The invalid-hole relation is counted in both rejection and deferral totals; do not add these as disjoint groups.

Road analysis used 30 existing tiles / 1,900 unique carriageway segments. 3,409 buildings were near those records, 153 intersected, and 19 crossed the 25% approximate-area threshold. Every overlap candidate remains in the dataset at its original footprint.

Data-quality warnings: 688 invalid levels tags and 1 invalid height tag; safe fallbacks were used. The 836,607 generic buildings have inferred classification, not verified use. Roof tags are especially sparse. Distinct source identities with overlapping geometry are preserved; the pipeline only suppresses member-way duplicates of validated relations.

Validation passed: 54 JavaScript tests, nine Python fixture tests, full audit of all 837,577 generated records in 12,477 tiles, client production build, and git diff --check. All 53 protected file hashes were unchanged. The compiled client entry bundle hash stayed the same. No PBF, verbose building source or build report was found in public/ or dist/, and compiled JavaScript contains no building-tile loading path. The pre-existing large-bundle warning remains. No browser rendering integration was performed.

## Phase A.5 production comparison - 12 October 2026

Both regions were extracted together from the same local Nigeria PBF using one generic implementation and one scan. Nationwide: 19,350,325 tagged building ways and 37,201 tagged building relations. Both full generated-record audits passed.

| Metric | Ibadan | Ogbomoso |
| --- | ---: | ---: |
| Usable buildings | 837,577 | 124,774 |
| Tiles | 12,477 | 3,319 |
| Raw tile bytes | 94,818,053 | 13,940,690 |
| Manifest bytes | 111,938 | 40,884 |
| Total bytes (tiles + manifest) | 94,929,991 (90.53 MiB) | 13,981,574 (13.33 MiB) |
| Largest tile | -5_-3: 46,052 bytes | 154_-324: 22,880 bytes |
| Densest tile | 10_20: 381 buildings | 152_-322: 203 buildings |
| Average tile bytes | 7,599 | 4,200 |
| Named buildings | 264 | 12 |
| Explicit height | 6 | 1 |
| From explicit levels | 435 | 0 |
| Inferred height | 837,136 (99.94735%) | 124,773 (99.99920%) |
| Accepted multipolygons | 2,084 | 1,006 |
| Buildings with holes | 2,055 | 992 |
| Multiple outer rings | 17 | 19 |
| Deduplicated member ways | 8 | 9 |
| Rejected buildings | 220 | 3 |
| Deferred relations | 2 | 0 |

Classification distribution (these are tag-derived or procedural inputs, not verified real-world descriptions):

| Category | Ibadan | Ogbomoso |
| --- | ---: | ---: |
| residential_low | 776 | 11 |
| residential_multi | 9 | 0 |
| commercial | 78 | 0 |
| mixed_use | 0 | 0 |
| office | 1 | 0 |
| school | 22 | 0 |
| university | 3 | 1 |
| hospital | 20 | 2 |
| clinic | 2 | 0 |
| hotel | 7 | 3 |
| industrial | 9 | 0 |
| warehouse | 0 | 0 |
| government | 1 | 0 |
| place_of_worship | 34 | 8 |
| market | 1 | 0 |
| parking_structure | 7 | 0 |
| generic | 836,607 | 124,749 |

### ibadan largest tiles

| Tile | Buildings | Bytes |
| --- | ---: | ---: |
| -5_-3 | 365 | 46,052 |
| -4_6 | 352 | 44,235 |
| -3_7 | 363 | 42,922 |
| -2_5 | 353 | 42,866 |
| 5_1 | 361 | 42,484 |
| -2_13 | 346 | 41,736 |
| -4_7 | 353 | 41,655 |
| -3_6 | 339 | 41,546 |
| 3_10 | 357 | 41,387 |
| 10_20 | 381 | 40,876 |

Rejection reasons: invalid_hole: 1; tiny_footprint: 206; quantization_self_intersection: 4; quantization_tiny_footprint: 9. Road analysis available: true.

### ogbomoso largest tiles

| Tile | Buildings | Bytes |
| --- | ---: | ---: |
| 154_-324 | 198 | 22,880 |
| 152_-322 | 203 | 22,417 |
| 153_-325 | 170 | 21,392 |
| 153_-324 | 180 | 21,322 |
| 157_-316 | 196 | 21,283 |
| 153_-322 | 194 | 21,272 |
| 151_-322 | 189 | 21,062 |
| 111_-290 | 191 | 21,050 |
| 156_-323 | 183 | 20,796 |
| 151_-324 | 184 | 20,779 |

Rejection reasons: tiny_footprint: 3. Road analysis available: false.

Ibadan usable count, tile count and raw tile bytes are exactly unchanged from Phase A; the region/projection manifest adds 575 bytes. Ogbomoso has only one usable explicit height and zero heights derived from levels; 124,773 heights and all 124,774 roof forms are inferred procedural inputs. Only 25 Ogbomoso classifications are tag-derived; 124,749 remain generic/inferred. Road analysis is unavailable there. These are data-quality limits, not assertions that the city lacks real tall, named or institutional buildings.

The final shared region index is 1,319 bytes and marks both complete local packages available. It contains no building records or tile-key lists. Both cities use schema v2, the same projection origin and 250 m tiles. Files in the old unscoped public building-tiles directory were moved intact to data/generated/world/archive/phase-a-building-tiles (ignored), keeping the prior output without duplicating it in public/. The live legacy building path in main.js remains intact.

Validation: 67 JavaScript tests and 12 Python tests passed, including multi-city routing, scoped paths, deterministic inference, bbox provenance, missing-asset availability, configuration validation and generated-data Git policy. Full audits validated 837,577 + 124,774 records in 12,477 + 3,319 tiles. npm.cmd run build:client passed with the existing large-bundle warning and unchanged client entry bundle hash. All 69 protected file hashes remained unchanged. Git eligibility lists only two city manifests and regions.json under public/data/world; all 15,796 tile files remain ignored. No upload, runtime activation or building rendering was performed.

## Phase A.5 files changed

- `.gitignore`
- `apps/client/public/data/world/ibadan/buildings/manifest.json`
- `apps/client/public/data/world/ogbomoso/buildings/manifest.json`
- `apps/client/public/data/world/regions.json`
- `pipeline/world/BUILDING-WORLD.md`
- `pipeline/world/benchmark-buildings.mjs`
- `pipeline/world/build-building-tiles.mjs`
- `pipeline/world/build-world-regions.mjs`
- `pipeline/world/building-data.mjs`
- `pipeline/world/building_extraction.py`
- `pipeline/world/cities/ibadan.json`
- `pipeline/world/cities/ogbomoso.json`
- `pipeline/world/city-config.mjs`
- `pipeline/world/city_config.py`
- `pipeline/world/extract-buildings.py`
- `pipeline/world/extract-ibadan-buildings.py`
- `pipeline/world/projection.json`
- `pipeline/world/specs/building-manifest.schema.json`
- `pipeline/world/specs/city-config.schema.json`
- `pipeline/world/specs/world-regions.schema.json`
- `pipeline/world/test-building-data.mjs`
- `pipeline/world/test-buildings.py`
- `pipeline/world/test-world-regions.mjs`
- `pipeline/world/world-region-index.mjs`

Generated sources/reports and 15,796 tile files are excluded from this list by the documented Git policy. They are local build outputs; the prior unscoped tile set was preserved in the ignored archive.
