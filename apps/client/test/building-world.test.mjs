import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {FAMILIES,classify,seedFor,inferHeight,project,cleanRing,selectLOD,roadOverlap,ownerTile,encodeFootprints} from '../src/world/BuildingRules.js';
import {BuildingSystem,decodeBuilding as decodeV2} from '../src/world/BuildingSystem.js';
import {buildBuildingGeometry} from '../src/world/BuildingGeometry.js';
import {Worker} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {selectRegion,validateManifest} from '../src/world/BuildingData.js';
const manifest=JSON.parse(readFileSync(new URL('../public/data/world/ibadan/buildings/manifest.json',import.meta.url)));
const index=JSON.parse(readFileSync(new URL('../public/data/world/regions.json',import.meta.url)));
const row=(id='way:1')=>[id,0,6.2,2,0,2,seedFor(id),0,1,1,[[[[0,0],[100,0],[100,100],[0,100]]]],[]];
const decodeBuilding=(r,t,h)=>decodeV2(r,{strings:[null],...t},h,manifest);
const tile={tx:0,tz:0,strings:[null],buildings:[row()]};
const mockFetch=(tiles,stats={})=>async url=>{
  stats.calls=(stats.calls??0)+1;
  if(url.endsWith('regions.json'))return {ok:true,json:async()=>index};
  if(url.endsWith('manifest.json'))return {ok:true,json:async()=>({...manifest,tiles:Object.keys(tiles)})};
  const key=url.split('/').at(-1).replace('.json','');return {ok:!!tiles[key],status:404,json:async()=>tiles[key]};
};
const surface={heightAt:(x,z)=>x*0.02};
test('projection, decimetre conversion, negative tiles, closure and malformed input',()=>{
  assert.deepEqual(project(3.8968,7.3962),[0,-0]);assert.ok(project(3.8978,7.3972)[1]<0);
  const b=decodeBuilding(row(),{tx:-1,tz:1},surface.heightAt);assert.deepEqual(b.polygons[0][0][0],[-250,250]);assert.equal(b.maxX,-240);
  assert.equal(cleanRing([[0,0],[1,0],[2,0]]),null);assert.equal(decodeBuilding([],tile,surface.heightAt),null);
  const broken=row();broken[10]=[[[[null,0],[100,0],[0,100]]]];assert.equal(decodeBuilding(broken,tile,surface.heightAt),null);
  const badHole=row();badHole[10][0].push([[200,200],[300,200],[300,300],[200,300]]);assert.equal(decodeBuilding(badHole,tile,surface.heightAt),null);
  const crossing=[[[[-10,-5],[10,-5],[10,5],[-10,5]]]];assert.deepEqual(ownerTile(crossing),[0,0]);
  const encoded=row();encoded[10]=encodeFootprints(crossing,0,0);assert.deepEqual(decodeBuilding(encoded,tile,surface.heightAt).polygons,crossing);
  assert.deepEqual(ownerTile([[[[-251,250],[-249,250],[-249,252],[-251,252]]]]),[-1,1]);
});
test('semantic classifications and explicit versus inferred height are deterministic',()=>{
  for(const [tags,family] of [[{amenity:'school'},'school'],[{amenity:'university'},'university'],[{healthcare:'hospital'},'hospital'],[{shop:'supermarket',building:'apartments'},'mixed_use'],[{building:'mosque'},'place_of_worship'],[{building:'warehouse'},'warehouse'],[{office:'government'},'government']])assert.equal(classify(tags).family,family);
  assert.deepEqual(classify({building:'yes'}),{family:'generic',verified:false});assert.equal(FAMILIES.length,16);
  const seed=seedFor('r102');assert.equal(seed,seedFor('r102'));assert.deepEqual(inferHeight({},'generic',seed),inferHeight({},'generic',seed));
  assert.equal(inferHeight({height:'30 ft','building:levels':'4'},'office',seed).height,9.1);assert.equal(inferHeight({'building:levels':'4'},'office',seed).source,'levels');assert.ok(inferHeight({},'generic',seed).height<6);assert.equal(inferHeight({},'generic',seed).levels,1);
});
test('LOD geometry remains batched, courtyard retained and detail cost decreases',()=>{
  assert.equal(selectLOD(20),'near');assert.equal(selectLOD(200),'medium');assert.equal(selectLOD(600),'far');assert.equal(selectLOD(100,true),'medium');
  const b=decodeBuilding(row(),tile,surface.heightAt);const counts=[];
  for(const lod of ['near','medium','far']){const g=buildBuildingGeometry([b],lod);assert.ok(g.filter(Boolean).length<=4);counts.push(g.reduce((s,v)=>s+(v?.attributes.position.count??0),0));g.forEach(v=>v?.dispose());}
  assert.ok(counts[0]>counts[1]&&counts[1]>counts[2]);
  b.roof='gable';const gabled=buildBuildingGeometry([b],'near');assert.ok(gabled[0]);assert.ok(gabled[1]);gabled.forEach(g=>g?.dispose());
});
test('road overlap detects crossing, containment and respects courtyards',()=>{
  const outer=[[0,0],[10,0],[10,10],[0,10]],hole=[[2,2],[8,2],[8,8],[2,8]];
  assert.equal(roadOverlap([outer],[{a:[-5,5],b:[15,5],width:2,roadId:9}]),9);
  assert.equal(roadOverlap([outer,hole],[{a:[3,5],b:[7,5],width:1,roadId:9}]),null);
});
test('worker prepares transferable geometry matching synchronous geometry',async()=>{
  const url=new URL('../src/world/BuildingWorker.js',import.meta.url).href;
  const worker=new Worker(`const {parentPort}=require('node:worker_threads');global.self={postMessage:(data,transfers)=>parentPort.postMessage(data,transfers)};import(${JSON.stringify(url)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({ready:true});});`,{eval:true});
  try {
    await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
    const records=[decodeBuilding(row(),tile,surface.heightAt)],expected=buildBuildingGeometry(records,'near');
    const result=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.postMessage({id:7,records,lod:'near'});});
    assert.equal(result.id,7);assert.equal(result.error,undefined);
    expected.forEach((g,i)=>{if(g){assert.deepEqual(result.geometry[i].attributes.position.array,g.attributes.position.array);g.dispose();}});
  }finally{await worker.terminate();}
});
test('streaming deduplicates requests, evicts cache, removes colliders and reports conflicts',async()=>{
  await RAPIER.init();const world=new RAPIER.World({x:0,y:-9.81,z:0}),stats={};
  const tiles=Object.fromEntries(['0_0','1_0','5_0'].map(k=>{const [tx,tz]=k.split('_').map(Number);return [k,{tx,tz,strings:[null],buildings:[row()]}];}));
  const roads={loaded:new Map(),getRoadEdges:()=>[]};
  const s=await new BuildingSystem({scene:new THREE.Scene(),worldSurface:surface,roadSystem:roads,physics:{world},fetcher:mockFetch(tiles,stats),worker:false,cacheLimit:1,lowPerformance:true}).init();
  await s.activate(index.regions[0]);await Promise.all([s.tileData('0_0'),s.tileData('0_0')]);assert.equal(stats.calls,3);
  await s.update(5,5);assert.equal(s.loaded.size,2);assert.ok(s.cache.size<=1);assert.ok(s.blockedPoint(5,5));assert.equal(world.colliders.len(),2);
  await s.update(1255,5);assert.equal(s.loaded.size,1);assert.equal(world.colliders.len(),1);assert.equal(s.blockedPoint(5,5),false);
  roads.loaded.set('road',{uuid:'new'});roads.getRoadEdges=()=>[{a:[1250,5],b:[1260,5],width:4,roadId:'r1'}];
  await s.update(1255,5);assert.equal(s.getStats().conflicts,1);assert.equal(s.getStats().buildings,0);assert.equal(world.colliders.len(),0);
  s.dispose();assert.equal(s.loaded.size,0);assert.equal(world.colliders.len(),0);world.free();
});
test('rendered shell and Rapier collider preserve a courtyard and source height',async()=>{
  await RAPIER.init();const world=new RAPIER.World({x:0,y:-9.81,z:0});const courtyard=row();courtyard[5]=0;courtyard[10][0].push([[30,30],[70,30],[70,70],[30,70]]);
  const system=await new BuildingSystem({scene:new THREE.Scene(),worldSurface:{heightAt:()=>0},physics:{world},worker:false,fetcher:mockFetch({'0_0':{tx:0,tz:0,strings:[null],buildings:[courtyard]}})}).init();
  await system.update(0,0);world.step();
  const ray=(x,z)=>world.castRay(new RAPIER.Ray({x,y:20,z},{x:0,y:-1,z:0}),30,true);
  assert.equal(ray(5,5),null);assert.ok(Math.abs(ray(1,1).timeOfImpact-13.8)<0.001);assert.equal(system.blockedPoint(5,5),false);assert.equal(system.blockedPoint(1,1),true);system.dispose();world.free();
});

test('schema v2 validation, integer vertices, flags, category and height semantics',()=>{
  assert.equal(validateManifest(manifest,'ibadan',index.projection),manifest);
  assert.throws(()=>validateManifest({...manifest,schemaVersion:1},'ibadan',index.projection));
  for(const [at,value] of [[0,'w1'],[1,99],[5,99],[8,16],[9,99]]){const r=row();r[at]=value;assert.equal(decodeBuilding(r,tile,()=>0),null);}
  const r=row();r[10][0][0][0]=[0.5,0];assert.equal(decodeBuilding(r,tile,()=>0),null);
  const b=decodeBuilding(row(),tile,()=>0);assert.equal(b.id,'way:1');assert.equal(b.categorySource,'explicit');assert.equal(b.heightSource,'explicit_levels');assert.equal(b.verified,undefined);
});
test('one region is selected and only its manifest/tiles are requested; switch unloads all',async()=>{
  const calls=[];const fetcher=async url=>{calls.push(url);if(url.endsWith('regions.json'))return {ok:true,json:async()=>index};const region=url.includes('/ogbomoso/')?'ogbomoso':'ibadan';if(url.endsWith('manifest.json'))return {ok:true,json:async()=>({...manifest,region,tiles:['0_0','156_-327']})};const [tx,tz]=url.split('/').at(-1).replace('.json','').split('_').map(Number);return {ok:true,json:async()=>({tx,tz,strings:[null],buildings:[row()]})};};
  const s=await new BuildingSystem({scene:new THREE.Scene(),worldSurface:{heightAt:()=>0},fetcher,worker:false}).init();await s.update(5,5);assert.equal(s.region,'ibadan');assert.ok(calls.every(c=>!c.includes('ogbomoso')));await s.update(39100,-81700);assert.equal(s.region,'ogbomoso');assert.ok([...s.cache.keys()].every(k=>k.startsWith('ogbomoso:')));assert.ok([...s.loaded.keys()].every(k=>k==='156_-327'));assert.equal(selectRegion(index,999999,0),null);s.dispose();
});
test('bounded prefetch, missing tiles tolerated, unavailable tiles never requested',async()=>{
  let active=0,peak=0;const keys=Array.from({length:25},(_,i)=>`${i%5-2}_${Math.floor(i/5)-2}`),tiles=Object.fromEntries(keys.map(k=>{const [tx,tz]=k.split('_').map(Number);return [k,{tx,tz,strings:[null],buildings:[row(),[]]}];}));const base=mockFetch(tiles);const s=await new BuildingSystem({scene:new THREE.Scene(),worldSurface:{heightAt:()=>0},worker:false,lowPerformance:true,fetcher:async url=>{if(url.includes('/tiles/')){active++;peak=Math.max(active,peak);await new Promise(r=>setTimeout(r,2));active--;if(url.endsWith('/0_0.json'))return {ok:false,status:404};}return base(url);}}).init();await s.update(0,0);assert.ok(peak<=3);assert.equal(s.loaded.size,24);assert.equal(s.getStats().malformed,24);assert.equal(s.getStats().failures,1);await assert.rejects(s.tileData('9_9'));s.dispose();
});

test('spawn shell and collider install before a held outer building tile resolves',async()=>{
  const tiles={'0_0':{tx:0,tz:0,strings:[null],buildings:[row()]},'2_2':{tx:2,tz:2,strings:[null],buildings:[row('way:2')]}};
  let release;const held=new Promise(r=>{release=r;}),base=mockFetch(tiles);
  await RAPIER.init();const world=new RAPIER.World({x:0,y:-9.81,z:0});
  const system=await new BuildingSystem({scene:new THREE.Scene(),worldSurface:surface,worker:false,physics:{world},lowPerformance:true,
    fetcher:async url=>{if(url.endsWith('/2_2.json'))await held;return base(url);}}).init();
  const update=system.update(0,0);
  try{for(let i=0;i<100&&!system.loaded.has('0_0');i++)await new Promise(r=>setTimeout(r,5));
    assert.ok(system.loaded.has('0_0'));assert.equal(system.loaded.has('2_2'),false);assert.ok(world.colliders.len()>0);
  }finally{release();await update;system.dispose();world.free();}
});
test('worker error falls back safely and materials are deterministic across LODs',async()=>{
  const s=new BuildingSystem({scene:new THREE.Scene(),worldSurface:surface,worker:false});
  s.worker={postMessage(){queueMicrotask(()=>s.failWorker(new Error('test worker failure')));},terminate(){}};
  const b=decodeBuilding(row(),tile,surface.heightAt);
  const a=await s.prepare([b],'near'),c=buildBuildingGeometry([b],'near');
  assert.equal(s.worker,null);
  assert.deepEqual(a[0].attributes.color.array,c[0].attributes.color.array);
  assert.equal(a.filter(Boolean).length,2);
  a.concat(c).forEach(g=>g?.dispose());s.dispose();
});
test('missing region manifest never rejects streaming or allocates geometry',async()=>{
  const s=await new BuildingSystem({scene:new THREE.Scene(),worldSurface:surface,worker:false,fetcher:async url=>url.endsWith('regions.json')?{ok:true,json:async()=>index}:{ok:false,status:404}}).init();
  await s.update(0,0);assert.equal(s.loaded.size,0);assert.equal(s.getStats().failures,1);s.dispose();
});
test('startup real/legacy rendering and colliders are mutually exclusive',()=>{
  const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  assert.match(main,/get\('buildings'\) !== 'legacy'/);
  assert.match(main,/const nB = realBuildings \? 0 :\s*buildBuildings/);
  assert.match(main,/if \(realBuildings\) \{[\s\S]*new BuildingSystem[\s\S]*\} else \{[\s\S]*nCol = physics.addBuildings\(footprints\)/);
  assert.match(main,/import\.meta\.env\.DEV && .*get\('buildingDebug'\)/);
});
