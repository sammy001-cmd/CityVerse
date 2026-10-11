import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {FAMILIES,classify,seedFor,inferHeight,project,cleanRing,selectLOD,roadOverlap,ownerTile,encodeFootprints} from '../src/world/BuildingRules.js';
import {BuildingSystem,decodeBuilding} from '../src/world/BuildingSystem.js';
import {buildBuildingGeometry} from '../src/world/BuildingGeometry.js';
import {Worker} from 'node:worker_threads';
const row=(id='w1')=>[id,0,6.2,2,'hipped',seedFor(id),[[[[0,0],[100,0],[100,100],[0,100]]]],null,1,'levels',0];
const tile={tx:0,tz:0,buildings:[row()]};
const surface={heightAt:(x,z)=>x*0.02};
test('projection, decimetre conversion, negative tiles, closure and malformed input',()=>{
  assert.deepEqual(project(3.8968,7.3962),[0,-0]);assert.ok(project(3.8978,7.3972)[1]<0);
  const b=decodeBuilding(row(),{tx:-1,tz:1},surface.heightAt);assert.deepEqual(b.polygons[0][0][0],[-250,250]);assert.equal(b.maxX,-240);
  assert.equal(cleanRing([[0,0],[1,0],[2,0]]),null);assert.equal(decodeBuilding([],tile,surface.heightAt),null);
  const broken=row();broken[6]=[[[[null,0],[100,0],[0,100]]]];assert.equal(decodeBuilding(broken,tile,surface.heightAt),null);
  const badHole=row();badHole[6][0].push([[200,200],[300,200],[300,300],[200,300]]);assert.equal(decodeBuilding(badHole,tile,surface.heightAt),null);
  const crossing=[[[[-10,-5],[10,-5],[10,5],[-10,5]]]];assert.deepEqual(ownerTile(crossing),[0,0]);
  const encoded=row();encoded[6]=encodeFootprints(crossing,0,0);assert.deepEqual(decodeBuilding(encoded,tile,surface.heightAt).polygons,crossing);
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
  b.roof='gabled';const gabled=buildBuildingGeometry([b],'near');assert.ok(gabled[0]);assert.ok(gabled[1]);gabled.forEach(g=>g?.dispose());
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
test('streaming deduplicates requests, evicts cache, removes colliders, retries and reports conflicts',async()=>{
  await RAPIER.init();const world=new RAPIER.World({x:0,y:-9.81,z:0});let calls=0,fail=false;
  const fetcher=async url=>{calls++;await new Promise(r=>setTimeout(r,1));if(url.endsWith('manifest.json'))return {ok:true,json:async()=>({version:1,tileSize:250,quantization:0.1,tiles:['0_0','1_0','5_0']})};if(fail){fail=false;return {ok:false,status:500};}const [tx,tz]=url.split('/').at(-1).replace('.json','').split('_').map(Number);return {ok:true,json:async()=>({tx,tz,buildings:[row()]})};};
  const roads={loaded:new Map(),getRoadEdges:()=>[]};const s=await new BuildingSystem({scene:new THREE.Scene(),worldSurface:surface,roadSystem:roads,physics:{world},fetcher,worker:false,cacheLimit:1,lowPerformance:true}).init();
  await Promise.all([s.tileData('0_0'),s.tileData('0_0')]);assert.equal(calls,2);
  await s.update(5,5);assert.equal(s.loaded.size,2);assert.equal(s.loaded.get('0_0').lod,'near');assert.ok(s.cache.size<=1);assert.ok(s.blockedPoint(5,5));assert.equal(world.colliders.len(),2);
  await s.update(1255,5);assert.equal(s.loaded.size,1);assert.equal(world.colliders.len(),1);assert.equal(s.blockedPoint(5,5),false);
  roads.loaded.set('road',{uuid:'new'});roads.getRoadEdges=()=>[{a:[1250,1255-1250],b:[1260,5],width:2,roadId:'r1'}];
  await s.update(1255,5);assert.equal(s.getStats().overlaps,1);assert.equal(s.getStats().buildings,0);assert.equal(world.colliders.len(),0);
  fail=true;await assert.rejects(s.update(5,5));await s.update(5,5);assert.ok(s.loaded.size>0);s.dispose();assert.equal(s.loaded.size,0);assert.equal(world.colliders.len(),0);world.free();
});
test('rendered shell and Rapier collider preserve a courtyard and source height',async()=>{
  await RAPIER.init();const world=new RAPIER.World({x:0,y:-9.81,z:0});const courtyard=row();courtyard[4]='flat';courtyard[6][0].push([[30,30],[70,30],[70,70],[30,70]]);
  const system=await new BuildingSystem({scene:new THREE.Scene(),worldSurface:{heightAt:()=>0},physics:{world},worker:false,fetcher:async url=>({ok:true,json:async()=>url.endsWith('manifest.json')?{version:1,tileSize:250,quantization:0.1,tiles:['0_0']}:{tx:0,tz:0,buildings:[courtyard]}})}).init();
  await system.update(0,0);world.step();
  const ray=(x,z)=>world.castRay(new RAPIER.Ray({x,y:20,z},{x:0,y:-1,z:0}),30,true);
  assert.equal(ray(5,5),null);assert.ok(Math.abs(ray(1,1).timeOfImpact-13.8)<0.001);assert.equal(system.blockedPoint(5,5),false);assert.equal(system.blockedPoint(1,1),true);system.dispose();world.free();
});
