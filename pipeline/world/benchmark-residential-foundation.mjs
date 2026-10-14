// Reconstruct the current playable spawn's canonical tiles without fetching extra world data.
// node pipeline/world/benchmark-residential-foundation.mjs
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {decodeBuilding,roadOverlapRatio} from '../../apps/client/src/world/BuildingData.js';
import {architecturalLOD,distanceToBuilding,nearestRoadFront} from '../../apps/client/src/world/BuildingArchitecture.js';
import {createResidentialTileMetadata} from '../../apps/client/src/world/ResidentialMetadata.js';
import {ResidentialRegistry} from '../../apps/client/src/world/ResidentialRegistry.js';
import {buildBuildingData} from '../../apps/client/src/world/BuildingMeshData.js';
import {roadClass} from '../../apps/client/src/world/RoadClasses.js';
const read=async path=>JSON.parse(await fs.readFile(path,'utf8'));
const base='apps/client/public/data/world/ibadan/buildings';
const manifest=await read(`${base}/manifest.json`),roadsManifest=await read('apps/client/public/data/road-tiles/manifest.json');
const spawn=roadsManifest.spawnPoints.reduce((a,b)=>Math.hypot(a[0],a[1])<Math.hypot(b[0],b[1])?a:b);
const tx=Math.floor(spawn[0]/250),tz=Math.floor(spawn[1]/250),available=new Set(manifest.tiles);
const triangles=g=>g.geometry.reduce((sum,b)=>sum+(b?.attributes.position.array.length??0)/9,0);
const boundsFilter=(b,e,margin=0)=>Math.max(e.a[0],e.b[0])+e.width/2>=b.minX-margin&&Math.min(e.a[0],e.b[0])-e.width/2<=b.maxX+margin&&
  Math.max(e.a[1],e.b[1])+e.width/2>=b.minZ-margin&&Math.min(e.a[1],e.b[1])-e.width/2<=b.maxZ+margin;
const modes=[];
for(const low of [true,false]) {
  const radius=low?2:3,roadRadius=low?1:2,registry=new ResidentialRegistry(),sourceHash=createHash('sha256');registry.clear('ibadan');
  const roadTiles=await Promise.all(roadsManifest.tiles.filter(key=>{const [x,z]=key.split('_').map(Number);return Math.abs(x-tx)<=roadRadius&&Math.abs(z-tz)<=roadRadius;})
    .map(key=>read(`apps/client/public/data/road-tiles/${key}.json`)));
  const edges=roadTiles.flatMap(t=>t.roads.map(e=>({...e,roadId:e.wayId,width:roadClass(e).width})));
  const tiles=[],timings=[],keys=[];let bytes=0,conflicts=0,luxuryEligible=0,serializedMetadataBytes=0;
  for(let x=tx-radius;x<=tx+radius;x++)for(let z=tz-radius;z<=tz+radius;z++)if(available.has(`${x}_${z}`))keys.push(`${x}_${z}`);
  for(const key of keys) {
    const buffer=await fs.readFile(`${base}/tiles/${key}.json`);sourceHash.update(buffer);bytes+=buffer.byteLength;
    const tile=JSON.parse(buffer),before=JSON.stringify(tile),decoded=tile.buildings.map(row=>decodeBuilding(row,tile,()=>0,manifest)).filter(Boolean);
    const result=createResidentialTileMetadata(decoded,{region:'ibadan',tx:tile.tx,tz:tile.tz});timings.push(result.buildMs);
    assert.equal(JSON.stringify(tile),before,'Housing may not modify source tile bytes');
    const records=[];
    for(const b of decoded) {
      if(roadOverlapRatio(b,edges.filter(e=>boundsFilter(b,e)))>=0.25){conflicts++;continue;}
      b.frontage=nearestRoadFront(b,edges.filter(e=>boundsFilter(b,e,60)));
      b.visualLOD=architecturalLOD(distanceToBuilding(b,spawn[0],spawn[1]),low);
      b.housing=result.metadata.get(b.id);luxuryEligible+=Number(b.housing.luxuryEligible??false);
      serializedMetadataBytes+=Buffer.byteLength(JSON.stringify(b.housing));records.push(b);
    }
    registry.installTile(key,records);tiles.push(records);
  }
  const withoutHousing=tiles.map(records=>records.map(({housing,...b})=>b));
  function geometryBenchmark(records){let totalTriangles=0,batches=0;const start=performance.now();
    for(const tile of records){const g=buildBuildingData(tile,'far',{lowPerformance:low});totalTriangles+=triangles(g);batches+=g.geometry.filter(Boolean).length;}
    return {elapsedMs:performance.now()-start,triangles:totalTriangles,batches};}
  geometryBenchmark(withoutHousing);geometryBenchmark(tiles); // Warm both paths.
  const before=[],after=[];
  for(let i=0;i<3;i++){
    if(i%2){after.push(geometryBenchmark(tiles));before.push(geometryBenchmark(withoutHousing));}
    else{before.push(geometryBenchmark(withoutHousing));after.push(geometryBenchmark(tiles));}
  }
  const median=values=>values.slice().sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const baseline={...before[0],elapsedMs:median(before.map(x=>x.elapsedMs))},housing={...after[0],elapsedMs:median(after.map(x=>x.elapsedMs))};
  const result={mode:low?'LOW':'NORMAL',scope:'actual spawn footprint/road selection; flat numeric benchmark, not browser FPS',spawn:spawn.slice(0,2),
    tiles:keys.length,buildings:registry.records.size,roadConflicts:conflicts,...registry.getStats(),luxuryEligibleBuildings:luxuryEligible,
    tileBytes:bytes,additionalTileBytes:0,additionalTileRequests:0,sourceTilesSHA256:sourceHash.digest('hex'),
    metadataAverageMs:timings.reduce((s,n)=>s+n,0)/timings.length,metadataPeakMs:Math.max(...timings),metadataTotalMs:timings.reduce((s,n)=>s+n,0),
    approximateMetadataJSONBytes:serializedMetadataBytes,baselineGeometry:baseline,housingGeometry:housing,
    geometryTriangleDelta:housing.triangles-baseline.triangles,geometryTimeChangePercent:(housing.elapsedMs/baseline.elapsedMs-1)*100};
  modes.push(result);console.log(JSON.stringify(result,null,2));
}
await fs.mkdir('data/generated/residential-foundation',{recursive:true});
await fs.writeFile('data/generated/residential-foundation/benchmark.json',JSON.stringify(modes,null,2));
