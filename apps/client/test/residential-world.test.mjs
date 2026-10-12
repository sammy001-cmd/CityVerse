import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {seedFor} from '../src/world/BuildingRules.js';
import {createResidentialTileMetadata,prepareResidentialTileMetadata,RESIDENTIAL_ARCHETYPES,QUALITY_TIERS,NEIGHBORHOOD_PROFILES,propertyUnitId,residentialStreetInputs} from '../src/world/ResidentialMetadata.js';
import {ResidentialRegistry} from '../src/world/ResidentialRegistry.js';
import {BuildingSystem} from '../src/world/BuildingSystem.js';
import {buildBuildingData,buildCollisionPositions} from '../src/world/BuildingMeshData.js';
const b=(id=1,{x=40,z=40,width=12,depth=8,...overrides}={})=>({id:`way:${id}`,seed:seedFor(`way:${id}`),category:'generic',categorySource:'inferred',
  height:5.2,levels:1,minHeight:0,roof:'hipped',roofSource:'inferred',heightSource:'inferred',tags:{},baseY:0,foundationBottom:0,
  minX:x,maxX:x+width,minZ:z,maxZ:z+depth,polygons:[[[[x,z],[x+width,z],[x+width,z+depth],[x,z+depth]]]],...overrides});
const forced=tier=>({tierWeights:Object.fromEntries(NEIGHBORHOOD_PROFILES.map(name=>[name,QUALITY_TIERS.map((_,i)=>Number(i===tier))]))});
const derive=(records,options={})=>createResidentialTileMetadata(records,{region:'ibadan',...options}).metadata;
const attach=(records,options={})=>{const metadata=derive(records,options);return records.map(record=>({...record,housing:metadata.get(record.id)}));};
const triangles=data=>data.geometry.reduce((sum,g)=>sum+(g?.attributes.position.array.length??0)/9,0);

test('housing identity is deterministic across order/reload, source geometry and source metadata stay unchanged',()=>{
  const records=[b(1),b(2,{x:85}),b(3,{x:120,levels:2,height:7})],before=structuredClone(records);
  const first=derive(records),second=derive(structuredClone(records).reverse());
  for(const record of records)assert.deepEqual(first.get(record.id),second.get(record.id));
  assert.deepEqual(records,before);assert.equal(first.get('way:1').source,'cityverse_procedural');
  assert.equal(first.get('way:1').version,1);
});
test('streamed roads, LOD, graphics mode and elevation do not alter housing assignments',()=>{
  const record=b(),expected=derive([record]).get(record.id);
  for(const visualLOD of ['far','medium','near'])assert.deepEqual(derive([{...record,visualLOD,baseY:8,foundationBottom:1,
    frontage:{point:[0,0],distance:3,roadType:'primary'}}],{context:{source:'streamed',roadEdges:[{a:[40,38],b:[80,38],type:'primary',width:8}]}}).get(record.id),expected);
});
test('large sparse footprints can be luxury villas or mansions; tiny/attached/dense footprints cannot become mansions',()=>{
  const villa=b(1,{width:20,depth:15}),mansion=b(2,{width:30,depth:20});
  assert.equal(RESIDENTIAL_ARCHETYPES[derive([villa],{housingProfile:forced(5)}).get(villa.id).residentialArchetype],'luxury_villa');
  assert.equal(RESIDENTIAL_ARCHETYPES[derive([mansion],{housingProfile:forced(5)}).get(mansion.id).residentialArchetype],'mansion');
  for(const record of [b(3,{width:6,depth:6}),b(4,{width:20,depth:15,x:2}),b(5,{width:30,depth:20,category:'residential_multi',categorySource:'explicit',levels:3,height:10,tags:{building:'apartments'}})]){
    const h=derive([record],{housingProfile:forced(5)}).get(record.id);assert.equal(h.luxuryEligible,false);assert.notEqual(RESIDENTIAL_ARCHETYPES[h.residentialArchetype],'mansion');
  }
  const h=derive([villa,b(6,{x:61,width:10,depth:15})],{housingProfile:forced(5)}).get(villa.id);assert.equal(h.luxuryEligible,false);
});
test('canonical road and institutional context can inform character; protected traits cannot',()=>{
  const record=b(1,{width:20,depth:15});
  const canonical={source:'canonical',roadEdges:[{a:[40,36],b:[70,36],type:'primary',width:8}],pois:[]};
  assert.equal(derive([record],{context:canonical,housingProfile:forced(5)}).get(record.id).luxuryEligible,false);
  const institutional={source:'canonical',roadEdges:[],pois:Array.from({length:3},()=>({category:'school'}))};
  assert.equal(NEIGHBORHOOD_PROFILES[derive([record],{context:institutional}).get(record.id).neighborhoodProfile],'institutional');
  const demographic={...record,tags:{ethnicity:'ignored',religion:'ignored',race:'ignored',income:'ignored',name:'ignored'}};
  assert.deepEqual(derive([record]).get(record.id),derive([demographic]).get(record.id));
});
test('neighborhood weights produce mixtures, not district-wide tiers',()=>{
  const records=Array.from({length:180},(_,i)=>b(i+1,{x:12+(i%15)*14,z:12+Math.floor(i/15)*18,width:10,depth:8}));
  const metadata=derive(records),tiers=new Set([...metadata.values()].map(h=>h.qualityTier));
  assert.ok(tiers.size>=4);assert.ok([...metadata.values()].every(h=>NEIGHBORHOOD_PROFILES[h.neighborhoodProfile]==='dense_affordable'));
  const weights=derive(records,{housingProfile:forced(2)});assert.ok([...weights.values()].every(h=>h.qualityTier===2));
});
test('multi-unit IDs are stable and bounded by usable floor area; mixed use reserves ground floor',()=>{
  const apartment=b(1,{width:24,depth:15,levels:3,height:10,heightSource:'explicit_levels',category:'residential_multi',categorySource:'explicit'});
  const [record]=attach([apartment],{housingProfile:forced(1)}),registry=new ResidentialRegistry();registry.clear('ibadan');registry.installTile('0_0',[record]);
  const units=registry.getPropertyUnits(record.id);assert.ok(units.length>2&&units.length<=record.housing.footprintArea*3*0.74/18);
  assert.equal(new Set(units.map(u=>u.id)).size,units.length);assert.equal(units[0].id,'ibadan:way:1:unit:0');
  assert.equal(registry.getRentBand(units[0].id),units[0].rentBand);assert.equal(registry.getRentBand('ogbomoso:way:1:unit:0'),null);
  assert.equal(registry.getRentBand('ibadan:way:1:unit:999'),null);assert.equal(registry.getRentBand('ibadan:way:1:unit:01'),null);
  assert.equal(units[0].state,'unassigned');assert.equal(units[0].availability,'unknown');
  const mixed=derive([{...apartment,category:'mixed_use'}],{housingProfile:forced(1)}).get(apartment.id);
  assert.ok(mixed.estimatedUnits<record.housing.estimatedUnits);
  assert.equal(derive([{...apartment,category:'mixed_use',levels:1,height:5}],{housingProfile:forced(1)}).get(apartment.id).estimatedUnits,0);
  const cluster=b(5,{width:12,depth:10});cluster.polygons.push(b(6,{x:65,width:12,depth:10}).polygons[0]);cluster.maxX=77;
  const clusterMetadata=derive([cluster]).get(cluster.id);assert.equal(clusterMetadata.residentialArchetype,6);assert.ok(clusterMetadata.estimatedUnits>=2);
  assert.throws(()=>propertyUnitId('../bad','way:1',0));assert.throws(()=>propertyUnitId('ibadan','way:1',-1));
});
test('starter pool excludes luxury, non-residential, elevated passages and undersized footprints; assignment is deferred',()=>{
  const records=attach([b(1,{width:7,depth:6}),b(2,{x:95,category:'school',categorySource:'explicit'}),
    b(3,{x:125,width:6,depth:6,minHeight:2})],{housingProfile:forced(1)});
  const luxury=attach([b(4,{width:25,depth:20})],{housingProfile:forced(5)})[0];
  const registry=new ResidentialRegistry();registry.clear('ibadan');registry.installTile('0_0',[...records,luxury]);
  const candidates=registry.getStarterHousingCandidates('ibadan');assert.ok(candidates.length>0);
  assert.ok(candidates.every(u=>u.buildingId==='way:1'&&u.qualityTier<=1&&u.state==='unassigned'));
  assert.equal(registry.getStarterHousingCandidates('ogbomoso').length,0);assert.equal(registry.getStarterHousingCandidates('ibadan',{limit:0}).length,0);
  registry.removeTile('0_0');assert.equal(registry.getStarterHousingCandidates().length,0);
});
test('query bounds/bands and lazy units expose candidates without inventing ownership or availability',()=>{
  const records=attach([b(1),b(2,{x:95})],{housingProfile:forced(2)}),registry=new ResidentialRegistry();registry.clear('ibadan');registry.installTile('0_0',records);
  assert.equal(registry.getRentalCandidates(null,{maxRentBand:0}).length,0);
  const candidates=registry.getRentalCandidates({minX:40,maxX:54,minZ:40,maxZ:50});assert.ok(candidates.every(u=>u.buildingId==='way:1'));
  assert.equal(registry.getHousingTier('way:1'),2);assert.equal(registry.getHousingTier('way:404'),null);
  const stats=registry.getStats();assert.equal(stats.estimatedResidentialUnits,records.reduce((n,b)=>n+b.housing.estimatedUnits,0));
  assert.equal(stats.tierProportions.standard,1);assert.equal(registry.getPropertyUnits('way:404').length,0);
  registry.clear('ogbomoso');assert.equal(registry.records.size,0);
});
test('regional identities and shared tuning work for Ibadan, Ogbomoso and future regions',()=>{
  const source=b(),ids=[];
  for(const region of ['ibadan','ogbomoso','future-city']){
    const h=derive([source],{region,housingProfile:forced(2)}).get(source.id);assert.equal(h.region,region);assert.equal(h.qualityTier,2);
    ids.push(propertyUnitId(region,source.id,0));assert.deepEqual(h,derive([structuredClone(source)],{region,housingProfile:forced(2)}).get(source.id));
  }
  assert.equal(new Set(ids).size,3);
});
test('cooperative preparation matches synchronous metadata and exposes CPU work separately from yield elapsed time',async()=>{
  const records=Array.from({length:381},(_,i)=>b(i+1,{x:12+i%20*10,z:12+Math.floor(i/20)*10,width:8,depth:8}));
  const options={region:'ibadan'},sync=createResidentialTileMetadata(records,options),asyncResult=await prepareResidentialTileMetadata(records,options);
  assert.deepEqual(asyncResult.metadata,sync.metadata);assert.deepEqual(asyncResult.features,sync.features);
  assert.ok(asyncResult.buildMs>=0&&asyncResult.elapsedMs>=asyncResult.buildMs);
});
test('Street World recipes omit socioeconomic labels and never fabricate a parcel, parking or gate',()=>{
  const [record]=attach([b(1,{width:25,depth:20})],{housingProfile:forced(5)}),h=record.housing;
  assert.equal(h.hasCompound,false);assert.equal(h.hasParking,false);assert.equal(h.hasGate,false);assert.equal(h.compoundPotential,true);
  const recipe=residentialStreetInputs(h);assert.equal(recipe.requiresBoundaryData,true);
  assert.equal(recipe.qualityTier,undefined);assert.equal(recipe.neighborhoodProfile,undefined);assert.equal(recipe.residentialArchetype,undefined);
  assert.equal(residentialStreetInputs({propertyUse:0}),null);
});
test('LOW/NORMAL keep two batches, source tops/collision and FAR triangle budget; debug tint is opt-in',()=>{
  const [record]=attach([b(1,{width:25,depth:20})],{housingProfile:forced(5)});
  for(const lowPerformance of [true,false])for(const lod of ['far','medium','near']){
    const normal=buildBuildingData([record],lod,{lowPerformance}),debug=buildBuildingData([record],lod,{lowPerformance,housingDebug:'tier'});
    assert.equal(normal.geometry.filter(Boolean).length,2);assert.equal(triangles(normal),triangles(debug));
    normal.geometry.forEach((g,i)=>assert.deepEqual(g.attributes.position.array,debug.geometry[i].attributes.position.array));
    const ys=normal.geometry.flatMap(g=>Array.from(g.attributes.position.array).filter((_,i)=>i%3===1));assert.ok(Math.abs(Math.max(...ys)-record.height)<1e-5);
  }
  assert.equal(triangles(buildBuildingData([record],'far')),triangles(buildBuildingData([{...record,housing:undefined}],'far')));
  assert.deepEqual(buildCollisionPositions([record]),buildCollisionPositions([{...record,housing:undefined}]));
  for(const mode of ['tier','archetype','neighborhood'])assert.ok(buildBuildingData([record],'near',{housingDebug:mode}).geometry[0]);
  const colours=new Set(RESIDENTIAL_ARCHETYPES.map((_,index)=>{
    const data=buildBuildingData([{...record,housing:{...record.housing,residentialArchetype:index}}],'near',{housingDebug:'archetype'});
    return Array.from(data.geometry[0].attributes.color.array.slice(18,21)).join(',');
  }));assert.equal(colours.size,RESIDENTIAL_ARCHETYPES.length);
});
test('runtime housing cache survives movement/road revisions, is bounded, and never adds tile payload fields',async()=>{
  const index=JSON.parse(readFileSync(new URL('../public/data/world/regions.json',import.meta.url))),manifest=JSON.parse(readFileSync(new URL('../public/data/world/ibadan/buildings/manifest.json',import.meta.url)));
  const row=['way:1',16,5.2,1,0,2,seedFor('way:1'),0,0,2,[[[[400,400],[520,400],[520,480],[400,480]]]],[]];
  const tile={tx:0,tz:0,strings:[null],buildings:[row]},before=JSON.stringify(tile),roads={loaded:new Map(),getRoadEdges:()=>[]};
  const system=await new BuildingSystem({scene:new THREE.Scene(),worldSurface:{heightAt:()=>0},roadSystem:roads,worker:false,
    fetcher:async url=>({ok:true,json:async()=>url.endsWith('regions.json')?index:url.endsWith('manifest.json')?{...manifest,tiles:['0_0']}:tile})}).init();
  await system.update(40,40);const original=structuredClone(system.housing.getHousingMetadata('way:1'));
  roads.loaded.set('0_0',{uuid:'road-revision'});await system.update(42,42);await system.update(150,150);
  assert.deepEqual(system.housing.getHousingMetadata('way:1'),original);assert.equal(system.metrics.housingJobs,1);
  assert.equal(JSON.stringify(tile),before);assert.equal(system.loaded.size,1);assert.equal(system.loaded.get('0_0').group.children.length,2);
  system.dispose();assert.equal(system.housing.records.size,0);assert.equal(system.residentialCache.size,0);
});

test('runtime region switch clears starter IDs and housing caches; no inactive region fetch is added',async()=>{
  const index=JSON.parse(readFileSync(new URL('../public/data/world/regions.json',import.meta.url)));
  const manifests=Object.fromEntries(['ibadan','ogbomoso'].map(region=>[region,JSON.parse(readFileSync(new URL(`../public/data/world/${region}/buildings/manifest.json`,import.meta.url)))]));
  const positions={ibadan:[40,40],ogbomoso:[30040,-80040]},calls=[];
  const system=await new BuildingSystem({scene:new THREE.Scene(),worldSurface:{heightAt:()=>0},worker:false,fetcher:async url=>{
    calls.push(url);if(url.endsWith('regions.json'))return {ok:true,json:async()=>index};
    const region=url.includes('/ogbomoso/')?'ogbomoso':'ibadan',p=positions[region],tx=Math.floor(p[0]/250),tz=Math.floor(p[1]/250);
    if(url.endsWith('manifest.json'))return {ok:true,json:async()=>({...manifests[region],tiles:[`${tx}_${tz}`]})};
    const x=Math.round((p[0]-tx*250)*10),z=Math.round((p[1]-tz*250)*10);
    return {ok:true,json:async()=>({tx,tz,strings:[null],buildings:[['way:1',16,5.2,1,0,2,seedFor('way:1'),0,0,2,[[[[x,z],[x+100,z],[x+100,z+100],[x,z+100]]]],[]]]})};
  }}).init();
  await system.update(...positions.ibadan);assert.equal(system.housing.getHousingMetadata('way:1').region,'ibadan');
  assert.equal(calls.some(url=>url.includes('/ogbomoso/')),false);
  await system.update(...positions.ogbomoso);assert.equal(system.housing.getHousingMetadata('way:1').region,'ogbomoso');
  assert.equal(system.housing.getStarterHousingCandidates('ibadan').length,0);
  assert.ok([...system.residentialCache.keys()].every(key=>key.startsWith('ogbomoso:')));
  assert.equal(system.housing.records.size,1);system.dispose();
});
