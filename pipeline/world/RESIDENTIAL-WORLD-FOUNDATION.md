# Residential World Foundation

Housing metadata is **Cityverse procedural interpretation**, not actual occupants, verified neighborhood income, ownership or Nigerian real-estate prices. Real OSM footprints, locations, explicit tags and height/levels remain intact. No interiors, economy transactions or player housing assignment are implemented.

## Assignment

`ResidentialMetadata.js` exports version 1, shared numeric enums for six tiers (T0 basic through T5 luxury), sixteen residential archetypes and nine neighborhood profiles. All cities use the same rules. Region + full OSM ID + version + optional seed salt establishes stable identity.

Character derives from all valid records in the canonical owning source tile: density/coverage, median area, explicit commercial/institutional/industrial uses and spatially indexed building spacing. Neighborhood profiles influence probabilities, not uniform district tiers. People, religion, ethnicity, race and income tags never influence housing tiers.

Luxury requires a detached footprint of 260–1,200 square metres, at most three source-derived floors, at least 8 m conservative clearance and sufficient margin inside the owning tile. Mansions require at least 520 square metres. Tiny, crowded, attached, apartment and multi-polygon footprints cannot become mansions. Multi-polygon residential records use multi-unit forms. Explicit non-residential uses, small generic sheds and enormous generic halls are excluded from residential speculation.

Optional `region.housingProfile` in the region index supports `seedSalt` and `tierWeights`, keyed by exported profile names with six non-negative weights. Optional `housingContextProvider({region,key,data})` can return a pinned, complete snapshot with `source:'canonical'`, `roadEdges` and institutional `pois` for accessibility/setback/context signals. The default uses source tile geometry and fetches no extra context. Live streamed roads orient Phase C facades but never change persistent housing assignments. Source/context/version changes need a future world-data migration policy.

## Metadata and queries

Separate `building.housing` metadata includes provenance/version/region, property use, building/unit archetypes, tier/profile, estimated units/unit area, abstract rent/value bands 0–5, independent finish quality, compound/parking/gate facts and potential flags, future interior template ID, procedural confidence, starter eligibility and stable visual seed. Generic assignments have limited confidence. Template IDs reserve names; no interior asset exists or is loaded.

`buildingSystem.housing` is a loaded-world `ResidentialRegistry`:

```js
catalog.getHousingMetadata('way:123');
catalog.getHousingTier('way:123');
catalog.getPropertyUnits('way:123');
catalog.getRentBand('ibadan:way:123:unit:0');
catalog.getStarterHousingCandidates('ibadan', {limit:128});
catalog.getRentalCandidates(bounds, {maxRentBand:2, limit:128});
catalog.getStreetInputs('way:123');
buildingSystem.getHousingStats();
```

Units are generated lazily, with IDs `region:way:ID:unit:N` or `region:relation:ID:unit:N`. Estimates respect usable area, reserve ground-floor capacity for mixed use, and cap at 256 units. Query results explicitly say `state:'unassigned'` and `availability:'unknown'`: candidates are not available rental offers. Future Housing/Property/Rental/Banking services can overlay authoritative rent/buy/inherit/receive/sell/lease and multiple-owner state keyed by IDs. No forced linear progression or ownership is fabricated.

Starter candidates require modest T0/T1 units, low rent band, plausible occupied envelopes and sufficient usable area; raised passages and known inaccessible sites are excluded. Streamed road conflicts are absent from the loaded catalog. Later assignment must validate a real entry/interior and authoritative availability. Queries cover loaded buildings only, with limits; unloading/region changes remove records and candidate IDs. Metadata caches remain bounded and are reused through LOD/road refreshes.

## Visuals, Street World and performance

Finishes use shared restrained vertex-colour palettes; suitable higher finishes can have slightly larger windows and existing balcony/canopy probabilities. Eligible luxury forms may prefer hipped roofs within source height. Explicit roof/material tags win. FAR, LOW detail limits, streaming radii, two shared materials and two batches per tile remain. No individual home/unit mesh or material is created.

Street recipes expose finish/palette, canopy probability and landscaping/parking/boundary/gate potential without socioeconomic labels. Potential is not an installed amenity: `hasCompound` requires explicit local boundary data; `hasParking` and `hasGate` remain false pending future sourced treatments. No parcels, perimeter walls, drives or gates are fabricated.

DEV-only `?housingDebug=1`/`tier`, `archetype` or `neighborhood` tints by that selection and shows starter/tier/multi-unit/unit counts explicitly labelled Cityverse procedural. Normal gameplay and production create no housing debug DOM, exported handle or tint.

Source tile size and request growth are **zero**. No extraction rules, generated tiles/manifests, roads, CityMap or navigation changed. Cooperative metadata preparation yields around 4 ms; CPU metrics exclude yields. Worker geometry receives just seven visual/debug fields from housing, not the full catalog. No units are eagerly allocated.

## Validation and limitations

Tests cover deterministic ordering/reload/elevation/road independence, mixed probabilities, luxury geometry suitability, multi-unit allocation, starter rules, stable regional IDs, lazy queries, missing availability, protected-trait exclusion, canonical context hooks, source/collision/batch preservation, cooperative preparation, raw tile immutability, caching and active-region switching.

Tile-scale statistics have seams and unknown adjacent-tile neighbors, so compound confidence is conservative near edges. Sparse detached sites are rare in the playable area; premium/luxury counts are deliberately small. There is no citywide property search or surveyed occupancy/ownership/parcel dataset. Candidate validation, interiors and authority/state remain later gameplay work. Existing terrain/plinth limitations and the large-main-chunk build warning remain.

Reproduction:

```text
node --test pipeline/world/test-world-regions.mjs pipeline/world/test-building-data.mjs pipeline/world/test-city-map.mjs apps/client/test/*.mjs
npm.cmd run build:client
node pipeline/world/benchmark-residential-foundation.mjs
node pipeline/world/validate-building-architecture.mjs --housing
git diff --check
```

The benchmark saves source hashes, a spawn-area census and paired geometry timings under ignored `data/generated/residential-foundation/benchmark.json`. Its flat numeric surface is not a browser/mobile FPS benchmark. Browser validation writes six screenshots, stats and error/world-request traces in the same directory. `--resume` continues a NORMAL page already loading.

## Current playable Ibadan report

Actual spawn `(33.77,-12.01)`, current loaded-world scope. Counts are **procedural residential building assignments**, not verified households. Percentages use 2,511 residential records LOW / 5,857 NORMAL as denominator. No mixed-use source records are present in this sample.

| Tier group | LOW count / proportion | NORMAL count / proportion |
|---|---:|---:|
| Basic + affordable | 1,486 / 59.18% | 3,586 / 61.23% |
| Standard | 747 / 29.75% | 1,707 / 29.14% |
| Upper-mid | 275 / 10.95% | 556 / 9.49% |
| Premium | 2 / 0.080% | 7 / 0.120% |
| Luxury | 1 / 0.040% | 1 / 0.017% |

Basic and affordable separately: LOW 491/995; NORMAL 1,231/2,355. Starter-eligible buildings are a subset: **1,134 LOW / 2,689 NORMAL**, containing **1,837 / 4,416 candidate units**. No player is assigned to them. Only 6/7 buildings meet conservative luxury eligibility; one is selected by the neighborhood/seed probabilities in each streaming scope. Scarcity reflects current footprint suitability, not a claim about real residents' income.

| Building residential archetype | LOW | NORMAL |
|---|---:|---:|
| Starter room | 167 | 383 |
| Self-contained | 577 | 1,320 |
| Small flat | 278 | 664 |
| One-bed flat | 225 | 510 |
| Bungalow | 1,255 | 2,958 |
| Detached house | 8 | 20 |
| Apartment block | 0 | 1 |
| Mansion | 1 | 1 |

The remaining supported archetypes have zero building assignments here. Source levels are predominantly one storey; no floors or towers are invented to populate higher forms. Units can have a different template/archetype from their host building.

| Catalog/world metric | LOW | NORMAL |
|---|---:|---:|
| Loaded source building records | 2,744 | 6,420 |
| Residential building records | 2,511 | 5,857 |
| Estimated residential units | 3,210 | 7,577 |
| Multi-unit buildings | 302 | 728 |
| Largest unit count in one building | 8 | 15 |
| Largest residential footprint | 1,144 m² | 1,198 m² |
| Loaded building triangles | 37,710 | 92,070 |
| Loaded tile batches | 50 | 98 |
| Street / neighborhood / dense visible building calls | 24 / 24 / 36 | 40 / 40 / 54 |
| Shared material families | 2 | 2 |
| Source tile body bytes | 318,503 | 748,319 |
| Added tile bytes / tile requests | 0 / 0 | 0 / 0 |
| Metadata CPU avg / peak per tile, live | 2.40 / 14.0 ms | 3.65 / 33.4 ms |
| Worker avg / peak, live | 5.38 / 24.9 ms | 6.52 / 32.4 ms |
| Geometry preparation avg / peak, live | 7.56 / 27.3 ms | 14.08 / 237.2 ms |

NORMAL largest footprint is `relation:17650015` (one estimated dwelling); largest unit count is `way:843744482` (15). LOW largest footprint is `way:843737468`; the deterministic smallest-ID tie winner for eight units is `way:1287943084`.

Neighborhood profile counts across all loaded buildings: LOW dense-affordable 2,173, mixed 231, middle-income 260, premium-estate 80. NORMAL dense-affordable 5,445, mixed 395, middle-income 423, premium-estate 80, upper-middle 77. These tile profiles **do not force one tier**: there are lower-tier homes in the sparse premium-profile tiles and standard/upper-mid homes in dense tiles.

Geometry and draw calls match Phase C exactly in the live views. The flat paired numerical benchmark likewise adds **zero triangles and zero batches**, with median whole-window geometry times of 154.6→180.0 ms LOW and 315.8→310.4 ms NORMAL in the saved run (+16.4%/-1.7%). Timings varied across repeats, so these numbers do not establish a general speedup or mobile guarantee. Housing metadata is additional one-time/cache-miss CPU work. Its full serialized JSON is approximately 1.50 MB LOW / 3.50 MB NORMAL as a size proxy, **not fetched tile bytes or a heap measurement**; actual worker messages include just seven small housing fields and property units are lazy.

The latest NORMAL preparation peak of 237.2 ms is a remaining cold-start/transfer/main-thread elapsed outlier, despite a 32.4 ms worker peak and unchanged geometry. An earlier settled NORMAL run measured 9.15/29.3 ms geometry average/peak and 6.18/24.0 ms worker average/peak, with identical counts. Do not claim startup peaks are uniformly improved. Local file serving/build copying was also unusually slow during this session. Steady-state metadata is cached; device-specific cold-start and mobile profiling remain necessary.

All **97 JavaScript tests pass**, including 14 residential tests. The full production build passes; a final source rebuild reused already-copied public data and also passes. BuildingSystem is 51.80 kB / 18.75 kB gzip; BuildingWorker 19.84 kB. The existing main-chunk warning remains. Protected-file hash audit found zero changes and `git diff --check` passes.

Six actual-game DEV tier screenshots and stats are under `data/generated/residential-foundation/`: `normal-street.png`, `normal-neighborhood.png`, `normal-dense.png`, `low-street.png`, `low-neighborhood.png`, `low-dense.png`. Browser trace records zero uncaught/console errors and zero inactive Ogbomoso building requests. Tints/labels are development-only; no economic labels are added to normal gameplay.

Confirmed: OSM geometry/height/location remain unchanged; all property values and classifications are procedural; no interiors, prices, economy, ownership transactions, permanent starter assignment or new Street World roadmap features were introduced.
