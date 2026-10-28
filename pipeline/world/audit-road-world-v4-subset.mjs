import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildV4PolygonRoadTile } from '../../apps/client/src/world/V4PolygonRoadTile.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mapManifest = JSON.parse(await fs.readFile(path.join(root,'apps/client/public/data/city-map-roads/manifest.json'),'utf8'));
const mapDir = path.join(root,'apps/client/public/data/city-map-roads/tiles');
const mapIds = new Set();
for (const key of mapManifest.detailTileKeys) {
  const tile = JSON.parse(await fs.readFile(path.join(mapDir,`${key}.json`),'utf8'));
  for (const row of tile.roads) mapIds.add(String(row[6]));
}
const dir = path.join(root,'.world-assets/staging/road-world-v4-subset');
const manifest = JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8'));
const worldIds = new Set(), classWayCounts = new Map();
let rawBytes=0, triangles=0, decodeMs=0, queryTriangles=0;
for (const key of manifest.tiles) {
  const bytes = await fs.readFile(path.join(dir,`${key}.json`)); rawBytes += bytes.length;
  const data = JSON.parse(bytes);
  for (const feature of data.features) {
    for (const id of feature.ids) worldIds.add(String(id));
    for (const type of feature.types) classWayCounts.set(type,(classWayCounts.get(type)??0)+1);
  }
  const started=performance.now();
  const built=buildV4PolygonRoadTile(data,{terrainHeightAt:()=>0});
  decodeMs+=performance.now()-started; triangles+=built.triangleCount;
  queryTriangles += [...built.query.tiles.values()].reduce((n,entries)=>n+entries.length,0);
  built.group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
}
const excluded=[...mapIds].filter(id=>!worldIds.has(id));
const unexpected=[...worldIds].filter(id=>!mapIds.has(id));
const explained = new Set(Object.values(manifest.excludedSourceWayIdsByReason??{}).flat().map(String));
const report={generatedAt:new Date().toISOString(),sourceWays:manifest.sourceWays,mapWays:mapIds.size,worldWays:worldIds.size,matchingWays:worldIds.size-unexpected.length,excludedWays:excluded.length,missingWays:excluded.length,unexpectedWays:unexpected.length,unexplainedMissingWays:excluded.filter(id=>!explained.has(id)).length,excludedByReason:manifest.excludedByReason,tiles:manifest.tiles.length,polygons:manifest.polygons,unionComponents:manifest.unionComponents,validSourceBounds:manifest.bounds,processingSeconds:manifest.processingSeconds,roadTileBytes:rawBytes,runtimeDecodeAndIndexMs:Number(decodeMs.toFixed(2)),roadTriangles:triangles,queryIndexedTriangles:queryTriangles,classCounts:manifest.acceptedWaysByClass,scope:manifest.scope};
await fs.writeFile(path.join(root,'docs/road-world-v4-subset-audit.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
