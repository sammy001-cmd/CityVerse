# Building World V1 — Phase A (data only)

The production source is the existing local `pipeline/world/source/nigeria-latest.osm.pbf`. No Overpass request is made. The PBF and verbose JSON source/report stay gitignored and outside `public/`. The browser has no building-tile loading integration in Phase A; `main.js` continues to use the legacy building renderer, footprints, and colliders.

## Rebuild and validation

Use the existing pyosmium environment (requirements are in `requirements-buildings.txt`):

```powershell
pipeline/world/.venv/Scripts/python.exe pipeline/world/extract-ibadan-buildings.py
node pipeline/world/build-building-tiles.mjs
node pipeline/world/benchmark-buildings.mjs
pipeline/world/.venv/Scripts/python.exe pipeline/world/test-buildings.py
node --test pipeline/world/test-building-data.mjs pipeline/world/test-city-map.mjs apps/client/test/*.mjs
npm.cmd run build:client
git diff --check
git status --short
```

`npm.cmd` runs the same npm script on Windows where PowerShell blocks `npm.ps1`. Normal unit tests use synthetic fixtures and do not read the Nigeria PBF.

## Source and coordinates

`extract-ibadan-buildings.py` reads `CENTER` and the Ibadan bounds directly from the authoritative `extract-ibadan-roads.py` constants through Python AST parsing, without executing that road extractor. Origin: latitude 7.3962, longitude 3.8968. Bounds: south 7.26050, west 3.76092, north 7.53190, east 4.03267.

The build-time `building-data.mjs` reuses the existing `BuildingRules.project` and stable seed helper. That projection matches the road, city-map and POI builders:

```
worldX = (longitude - origin.longitude) * 111320 * cos(origin.latitude)
worldZ = -(latitude - origin.latitude) * 110540
```

North is negative Z. The builder rejects sources or road manifests with mismatched origins; tests compare the existing pipeline constants. No road/map/POI implementation is changed.

Extraction uses pyosmium area assembly for closed ways and multipolygon relations, including split outer ways and holes. It keeps an explicit tag allowlist, `way:<id>` / `relation:<id>` identities, and relation member IDs. Whole intersecting buildings stay intact at the bbox boundary. Successful geometry validation and quantization precede deduplication: a rejected relation cannot hide a valid tagged member way. Unassembled local relations are reported as deferred, rather than replaced with invented geometry.

Build-time outputs:

- `data/generated/ibadan-buildings-source.json`: geographic geometry, approved original tags, members, extraction statistics and deferred identities.
- `data/generated/ibadan-buildings-report.json`: production metrics, rejected identities/reasons, deferred relations and heavy road-overlap candidates.

## Geometry and normalization

Cleaning removes duplicate closing/consecutive vertices, rejects nonfinite or malformed coordinates, fewer than three distinct vertices, self-intersections/self-touching rings, invalid holes and overlapping polygon parts. It calculates net area, bounds and the area-weighted centroid across all outer rings minus holes. Footprints smaller than 1 m² are rejected; valid footprints above 100,000 m² are flagged, not discarded. A single footprint above 5,000,000 m² or spanning over 10 km is treated as implausible. There is no arbitrary 512-vertex limit. Quantized geometry is validated again; buildings are rejected as a whole rather than silently dropping broken parts or holes.

Classification favors explicit amenity/healthcare/tourism/office/shop/building semantics. Unknown `building=yes` remains generic/inferred. Height priority is valid explicit height, then valid building levels, then family defaults with stable identity-seeded variation. Metres and feet are supported; invalid tags are reported. Floor heights are 3.1 m for residential/generic, 3.6 m for institutions/commercial, and 5.5 m for industrial/warehouse. Inferred buildings remain low/mid-rise. Explicit `roof:height`, minimum height and minimum levels are used where valid; original roof-level/material values remain in sparse tags. Fallback roof forms are deterministic, with flat roofs for taller/commercial buildings. Unknown explicit roof forms map to `other` while the original tag is retained. Appearance seeds use stable unsigned FNV-1a over the full source identity.

## Client schema

Only compact `manifest.json` and `tiles/<tx>_<tz>.json` are public. `version: 1`, `schemaVersion: 2`, and `pipelineVersion: building-world-v1-phase-a` identify this data contract. This is intentionally **not** the disabled scaffold renderer's original tuple layout. Future integration must explicitly adapt the decoder and check the schema version; do not enable BuildingSystem merely because tiles now exist.

Manifest tables document categories, roofs, height sources, approved tag keys, tuple fields and flag bits. Each tile has `tx`, `tz`, a shared `strings` table (`0 = absent`), and `buildings` tuples:

```
[id, categoryId, heightMetres, levels, minHeightMetres, roofId, appearanceSeed,
 nameStringId, flags, heightSourceId, polygons, sparseTags]
```

`sparseTags` is a flat list of `[tagKeyId, valueStringId, ...]`, preserving only approved source tags. Classification provenance is bit 1 (explicit; unset means inferred), roof provenance is bit 2, large footprint is bit 4, and heavy road overlap is bit 8. These annotations do not change rendering or geometry.

Each building belongs to the 250 m tile containing its area-weighted unquantized footprint centroid. Signed integer footprint coordinates use 0.1 m units relative to that owner tile:

```
worldX = tx * 250 + localX * 0.1
worldZ = tz * 250 + localZ * 0.1
```

Floor division handles negative tiles. Geometry may extend beyond its owner tile; it is neither clipped nor duplicated. Relations retain multiple outer rings and practical valid holes. Stable source IDs provide the lookup key for a future landmark registry; no models or landmarks are built in Phase A.

## Road analysis and limitations

The builder reads existing production road tiles without altering them. It deduplicates repeated road segments, spatially indexes carriageway rectangles, subtracts footprint holes, and flags approximate summed overlap of at least 25% of footprint area. Adjacent/junction rectangles can overlap, so this is a review candidate statistic rather than exact union area. Available production roads cover the current central district, not the entire Ibadan building extent; buildings without nearby road records are unassessed. Shoulders/junction aprons, vertical bridge separation and building entrances are not analyzed. No footprint is moved, omitted or distorted because of a road conflict.

OSM coverage, names, semantic tags, heights and roof tags are incomplete. Generic classification and inferred heights are not surveys. Missing relation members, unsupported relation types and unsafe geometry are counted/reported. Relations entirely missing all locatable members cannot be assigned to Ibadan and therefore are not included in local deferred counts; national scanned relation counts remain available. No runtime tile streamer, procedural facade, landmark, terrain change or physics change belongs to this phase.

Attribution: © OpenStreetMap contributors. Dataset license: ODbL-1.0.

## Production result - 11 October 2026

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
