import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CENTER,BOUNDS,TILE_SIZE,QUANTIZATION,CATEGORIES,ROOFS,HEIGHT_SOURCES,TAGS,FIELDS,FLAGS,
  normalizeBuilding,roadRectangle,roadOverlapRatio} from './building-data.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const INPUT=path.join(ROOT,'data/generated/ibadan-buildings-source.json');
const OUTPUT=path.join(ROOT,'apps/client/public/data/building-tiles');
const REPORT=path.join(ROOT,'data/generated/ibadan-buildings-report.json');
const ROAD_OUTPUT=path.join(ROOT,'apps/client/public/data/road-tiles');
const increment=(object,key)=>object[key]=(object[key]??0)+1;
const sameCoordinates=(actual,expected)=>Object.entries(expected).every(([key,value])=>actual?.[key]===value);

export async function readRoadAnalysis(directory=ROAD_OUTPUT) {
  let manifest;
  try {manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));}
  catch(error) {if(error.code==='ENOENT')return {available:false,reason:'No production road manifest',cells:new Map(),edgeCount:0,tileCount:0};throw error;}
  if(!sameCoordinates(manifest.center,CENTER))throw new Error('Road/building coordinate origins disagree');
  const cells=new Map(),seen=new Set();let edgeCount=0;
  for(const key of manifest.tiles) {
    if(!/^-?\d+_-?\d+$/.test(key))throw new Error('Invalid road tile key');
    const tile=JSON.parse(await fs.readFile(path.join(directory,`${key}.json`),'utf8'));
    for(const edge of tile.roads) {
      // Roads repeated in adjacent tiles must not inflate intersection areas.
      const id=JSON.stringify([edge.wayId,edge.seq,edge.a,edge.b]);if(seen.has(id))continue;seen.add(id);
      if(![...edge.a,...edge.b].every(Number.isFinite))continue;
      const rectangle=roadRectangle(edge);if(!rectangle)continue;
      edgeCount++;
      const xs=rectangle.map(p=>p[0]),zs=rectangle.map(p=>p[1]);
      for(let tx=Math.floor(Math.min(...xs)/TILE_SIZE);tx<=Math.floor(Math.max(...xs)/TILE_SIZE);tx++)
        for(let tz=Math.floor(Math.min(...zs)/TILE_SIZE);tz<=Math.floor(Math.max(...zs)/TILE_SIZE);tz++) {
          const key=`${tx}_${tz}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(edge);
        }
    }
  }
  return {available:true,cells,edgeCount,tileCount:manifest.tiles.length};
}
function roadCandidates(geometry,roads) {
  const {minX,maxX,minZ,maxZ}=geometry.bounds,edges=new Set();
  for(let tx=Math.floor(minX/TILE_SIZE);tx<=Math.floor(maxX/TILE_SIZE);tx++)
    for(let tz=Math.floor(minZ/TILE_SIZE);tz<=Math.floor(maxZ/TILE_SIZE);tz++)
      for(const edge of roads.cells.get(`${tx}_${tz}`)??[])edges.add(edge);
  return [...edges];
}
function makeTile(tx,tz) {return {tx,tz,strings:[null],stringIds:new Map(),buildings:[]};}
function stringId(tile,value) {
  if(typeof value!=='string'||!value.trim())return 0;
  if(!tile.stringIds.has(value)){tile.stringIds.set(value,tile.strings.length);tile.strings.push(value);}
  return tile.stringIds.get(value);
}

export function buildTiles(source,roads={available:false,cells:new Map(),edgeCount:0,tileCount:0}) {
  if(source.version!==1||!sameCoordinates(source.center,CENTER)||!sameCoordinates(source.bounds,BOUNDS))
    throw new Error('Building source must use authoritative CityVerse Ibadan coordinates');
  if(!Array.isArray(source.elements))throw new Error('Malformed building source');
  const tiles=new Map(),acceptedIds=new Set(),memberWays=new Set();
  const stats={extraction:source.stats??{},input:source.elements.length,usableBuildings:0,
    acceptedWays:0,acceptedRelations:0,deduplicatedMemberWays:0,duplicateIdentities:0,
    rejectedBuildings:source.stats?.extractionRejectedWays??0,deferredRelations:source.stats?.deferredRelations??0,
    namedBuildings:0,heightSources:Object.fromEntries(HEIGHT_SOURCES.map(k=>[k,0])),
    categories:Object.fromEntries(CATEGORIES.map(k=>[k,0])),classificationSources:{explicit:0,inferred:0},
    roofs:Object.fromEntries(ROOFS.map(k=>[k,0])),roofSources:{explicit:0,inferred:0},
    largeFootprints:0,buildingsWithHoles:0,buildingsWithMultipleOuters:0,
    rejectionReasons:{...source.rejectionReasons},tagWarnings:{},
    roadAnalysis:{available:roads.available,reason:roads.reason??null,roadTiles:roads.tileCount,
      uniqueSegments:roads.edgeCount,buildingsNearAvailableRoads:0,intersectingBuildings:0,heavyConflicts:0,
      heavyThreshold:0.25,method:'Approximate summed footprint/carriageway rectangle intersection area; holes excluded; no geometry moved'}};
  const rejections=[],deferred=[...(source.deferredRelations??[])],roadConflicts=[];
  const consume=element=>{
    if(acceptedIds.has(element.id)){stats.duplicateIdentities++;return;}
    const relation=element.id?.startsWith('relation:');
    if(!relation&&memberWays.has(element.id)){stats.deduplicatedMemberWays++;return;}
    const building=normalizeBuilding(element,source.center);
    if(building.reason) {
      stats.rejectedBuildings++;increment(stats.rejectionReasons,building.reason);
      rejections.push({id:element.id??null,reason:building.reason});
      if(relation){stats.deferredRelations++;deferred.push({id:element.id,reason:building.reason});}
      return;
    }
    acceptedIds.add(building.id);
    if(relation)for(const id of building.members)memberWays.add(`way:${id}`);
    const edges=roadCandidates(building.geometry,roads);
    if(edges.length) {
      stats.roadAnalysis.buildingsNearAvailableRoads++;
      const ratio=roadOverlapRatio(building.geometry,edges);
      if(ratio>0.001)stats.roadAnalysis.intersectingBuildings++;
      if(ratio>=stats.roadAnalysis.heavyThreshold) {
        stats.roadAnalysis.heavyConflicts++;building.flags|=FLAGS.heavyRoadOverlap;
        roadConflicts.push({id:building.id,ratio:Math.round(ratio*1000)/1000});
      }
    }
    const key=`${building.tx}_${building.tz}`;
    if(!tiles.has(key))tiles.set(key,makeTile(building.tx,building.tz));
    const tile=tiles.get(key),tags=[];
    // A sparse, indexed tag list preserves approved original values for later phases.
    for(let i=0;i<TAGS.length;i++)if(TAGS[i]!=='name'&&typeof building.tags[TAGS[i]]==='string')
      tags.push(i,stringId(tile,building.tags[TAGS[i]]));
    tile.buildings.push([building.id,CATEGORIES.indexOf(building.classification.category),
      building.height.height,building.height.levels,building.height.minHeight,
      ROOFS.indexOf(building.roof.shape),building.seed,stringId(tile,building.tags.name),
      building.flags,HEIGHT_SOURCES.indexOf(building.height.source),building.local,tags]);
    stats.usableBuildings++;stats[relation?'acceptedRelations':'acceptedWays']++;
    stats.namedBuildings+=typeof building.tags.name==='string'&&Boolean(building.tags.name.trim())?1:0;
    increment(stats.categories,building.classification.category);
    increment(stats.classificationSources,building.classification.source);
    increment(stats.heightSources,building.height.source);
    increment(stats.roofs,building.roof.shape);increment(stats.roofSources,building.roof.source);
    for(const warning of building.height.warnings)increment(stats.tagWarnings,warning);
    stats.largeFootprints+=Boolean(building.flags&FLAGS.largeFootprint);
    stats.buildingsWithHoles+=building.geometry.polygons.some(p=>p.length>1)?1:0;
    stats.buildingsWithMultipleOuters+=building.geometry.polygons.length>1?1:0;
  };
  // Relations win only after successful cleaning/quantization. Invalid relations
  // leave tagged member ways available as real independent source buildings.
  const compare=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
  for(const element of source.elements.filter(e=>e.id?.startsWith('relation:')).sort(compare))consume(element);
  for(const element of source.elements.filter(e=>!e.id?.startsWith('relation:')).sort(compare))consume(element);
  for(const tile of tiles.values())delete tile.stringIds;
  return {tiles,stats,rejections,deferred,roadConflicts};
}

export async function writeTiles(result,output=OUTPUT,reportPath=REPORT) {
  const tileDirectory=path.resolve(output,'tiles');
  if(path.dirname(tileDirectory)!==path.resolve(output))throw new Error('Unsafe generated tile directory');
  await fs.mkdir(tileDirectory,{recursive:true});
  const sizes=[];let bytes=0;
  for(const key of [...result.tiles.keys()].sort()) {
    const tile=result.tiles.get(key),data=JSON.stringify(tile),size=Buffer.byteLength(data);
    bytes+=size;sizes.push({key,buildings:tile.buildings.length,bytes:size});
    await fs.writeFile(path.join(tileDirectory,`${key}.json`),data);
  }
  for(const file of await fs.readdir(tileDirectory)) {
    if(/^-?\d+_-?\d+\.json$/.test(file)&&!result.tiles.has(file.slice(0,-5)))
      await fs.unlink(path.join(tileDirectory,file));
  }
  sizes.sort((a,b)=>b.bytes-a.bytes||a.key.localeCompare(b.key));
  const stats={...result.stats,tileCount:result.tiles.size,rawTileBytes:bytes,
    averageTileBytes:result.tiles.size?Math.round(bytes/result.tiles.size):0,
    largestTileBytes:sizes[0]?.bytes??0,maximumBuildingsInOneTile:Math.max(0,...sizes.map(t=>t.buildings)),
    largestTiles:sizes.slice(0,10)};
  const manifest={version:1,schemaVersion:2,pipelineVersion:'building-world-v1-phase-a',city:'Ibadan',
    center:CENTER,bounds:BOUNDS,tileSize:TILE_SIZE,quantization:QUANTIZATION,
    tilePath:'tiles/{tx}_{tz}.json',tiles:[...result.tiles.keys()].sort(),
    ownership:'area-weighted footprint centroid, before quantization; one record per OSM identity',
    coordinates:'worldX = tx * tileSize + localX * quantization; worldZ = tz * tileSize + localZ * quantization; north = negative Z',
    categories:CATEGORIES,roofs:ROOFS,heightSources:HEIGHT_SOURCES,fields:FIELDS,flags:FLAGS,tagKeys:TAGS,
    stringReferences:'name and sparse tag value IDs index tile.strings; 0 means absent',
    classificationSources:['inferred','explicit'],buildingCount:stats.usableBuildings,tileCount:stats.tileCount,
    attribution:'\u00a9 OpenStreetMap contributors',license:'ODbL-1.0',
    source:'Local Geofabrik Nigeria OSM PBF (build-time only)',stats};
  const manifestData=JSON.stringify(manifest);
  stats.manifestBytes=Buffer.byteLength(manifestData);stats.totalClientBytes=bytes+stats.manifestBytes;
  // Publish the manifest last; the verbose report stays outside public/.
  await fs.writeFile(path.join(output,'manifest.json'),manifestData);
  const report={...stats,rejections:result.rejections,deferred:result.deferred,roadConflicts:result.roadConflicts};
  await fs.mkdir(path.dirname(reportPath),{recursive:true});
  await fs.writeFile(reportPath,JSON.stringify(report,null,2));
  return report;
}

export async function main() {
  const source=JSON.parse(await fs.readFile(INPUT,'utf8'));
  const roads=await readRoadAnalysis();
  const report=await writeTiles(buildTiles(source,roads));
  const summary={...report};delete summary.rejections;delete summary.deferred;delete summary.roadConflicts;
  console.log('CITYVERSE - BUILDING WORLD V1 PHASE A PRODUCTION REPORT');
  console.log(JSON.stringify(summary,null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{console.error('Building data pipeline failed:',error);process.exitCode=1;});
