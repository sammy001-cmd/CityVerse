import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = JSON.parse(await fs.readFile(path.join(root, 'apps/client/public/data/city-road-source.json'), 'utf8'));
const cityMapManifest = JSON.parse(await fs.readFile(path.join(root, 'apps/client/public/data/city-map-roads/manifest.json'), 'utf8'));
const cityMapDir = path.join(root, 'apps/client/public/data/city-map-roads/tiles');
const worldManifestPath = path.join(root, 'apps/client/public/data/road-tiles/manifest.json');
const worldManifest = JSON.parse(await fs.readFile(worldManifestPath, 'utf8'));
const worldDir = path.dirname(worldManifestPath);
const sourceWays = new Map(source.elements.map(way => [String(way.id), way]));
const mapWays = new Set();
const mapClasses = new Map();
for (const key of cityMapManifest.detailTileKeys) {
  const tile = JSON.parse(await fs.readFile(path.join(cityMapDir, `${key}.json`), 'utf8'));
  for (const row of tile.roads) {
    if (row[6] == null) throw new Error(`CityMap identity missing in tile ${key}`);
    mapWays.add(String(row[6]));
    const type = cityMapManifest.roadClasses[row[4]]?.type ?? 'unknown';
    mapClasses.set(type, (mapClasses.get(type) ?? 0) + 1);
  }
}
const worldWays = new Set();
const worldClasses = new Map();
let worldSegments = 0;
let worldBytes = 0;
for (const key of worldManifest.tiles) {
  const bytes = await fs.readFile(path.join(worldDir, `${key}.json`));
  worldBytes += bytes.length;
  const tile = JSON.parse(bytes);
  for (const row of tile.roads) {
    worldSegments++;
    worldWays.add(String(row.wayId));
    worldClasses.set(row.type, (worldClasses.get(row.type) ?? 0) + 1);
  }
}
const omittedFromWorld = [...mapWays].filter(id => !worldWays.has(id));
const worldNotInMap = [...worldWays].filter(id => !mapWays.has(id));
const omittedByClass = Object.create(null);
for (const id of omittedFromWorld) {
  const type = sourceWays.get(id)?.tags?.highway ?? 'unknown';
  omittedByClass[type] = (omittedByClass[type] ?? 0) + 1;
}
const sourceTypes = Object.create(null);
for (const way of source.elements) sourceTypes[way.tags?.highway] = (sourceTypes[way.tags?.highway] ?? 0) + 1;
const report = {
  generatedAt: new Date().toISOString(),
  sharedSource: 'apps/client/public/data/city-road-source.json',
  sourceWays: source.elements.length,
  sourceWaysByClass: sourceTypes,
  cityMap: { detailTiles: cityMapManifest.detailTileKeys.length, segments: cityMapManifest.statistics.detailSegments, uniqueWays: mapWays.size, segmentsByClass: Object.fromEntries(mapClasses) },
  worldManifest: { tiles: worldManifest.tiles.length, segments: worldSegments, uniqueWays: worldWays.size, roadBytes: worldBytes, segmentsByClass: Object.fromEntries(worldClasses) },
  mapWaysMissingFromWorld: omittedFromWorld.length,
  worldWaysMissingFromMap: worldNotInMap.length,
  mapWaysMissingFromWorldByClass: omittedByClass,
  worldWaysMissingFromMapSample: worldNotInMap.slice(0, 30),
  sourceWaysMissingFromCityMapSample: [...sourceWays.keys()].filter(id => !mapWays.has(id)).slice(0, 30),
  bounds: source.bounds
};
await fs.writeFile(path.join(root, 'docs/road-source-audit-v4.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
