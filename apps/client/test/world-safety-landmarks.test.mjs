import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {WorldSurface} from '../src/world/WorldSurface.js';
import {WorldSafety} from '../src/world/WorldSafety.js';
import {LandmarkRegistry} from '../src/navigation/LandmarkRegistry.js';
import {BuildingOverrideRegistry} from '../src/world/BuildingOverrideRegistry.js';
import {installLandmarkOverrides,createLandmarkModel,batchLandmarkModels} from '../src/world/LandmarkModels.js';
import {LandmarkSites} from '../src/world/LandmarkSites.js';
import {loadLandmarkAsset} from '../src/world/LandmarkAssetLoader.js';
import {RoadSystem} from '../src/world/RoadSystem.js';
import {landmarkGround} from '../src/world/LandmarkGround.js';
import {pointInRing} from '../src/world/BuildingRules.js';
import {validateAsset} from '../../../pipeline/world/validate-landmark-asset.mjs';

const valid={height:10,valid:true,collider:true,inBounds:true};
const tick=(s,extra={})=>s.step({position:{x:0,y:10,z:0},grounded:true,surface:valid,dt:.05,region:'ibadan',...extra});
test('finite terrain coverage rejects the clamped phantom floor outside the mesh',()=>{
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(100,100,2,2).rotateX(-Math.PI/2));
  const world=new WorldSurface({terrainMesh:mesh});
  assert.equal(world.heightAt(1000,0),0); // Historical phantom floor reproduced.
  assert.equal(world.coverageAt(1000,0).valid,false);
  assert.equal(world.coverageAt(49,0,{margin:3}).valid,false);
  assert.equal(world.coverageAt(0,0).valid,true);
  assert.equal(world.coverageAt(0,0).collider,false);
});
test('retired road owner discards late tile data and settles queued worker jobs',async()=>{
  const road=new RoadSystem({scene:new THREE.Scene(),groundY:()=>0});road.available.add('0_0');road.desired.add('0_0');
  const original=globalThis.fetch;let release,rejected=false,terminated=false;
  globalThis.fetch=()=>new Promise(resolve=>release=resolve);
  try{
    const pending=road.loadTile(0,0);road.workerJobs=new Map([[1,{reject:()=>rejected=true}]]);road.worker={terminate:()=>terminated=true};road.retire();
    release({ok:true,json:async()=>({roads:[],junctions:[]})});await pending;await road.update(0,0);
    assert.equal(road.tileData.size,0);assert.equal(road.loaded.size,0);assert.ok(rejected&&terminated);
  }finally{globalThis.fetch=original;road.roadMaterial.dispose();road.concreteMaterial.dispose();}
});
test('safe history excludes jumps, missing colliders, invalid world and below-surface states',()=>{
  const s=new WorldSafety();tick(s);const safe=s.lastSafe;
  tick(s,{position:{x:20,y:15,z:0},grounded:false});
  tick(s,{position:{x:20,y:10,z:0},surface:{...valid,collider:false}});
  assert.equal(s.lastSafe,safe);assert.equal(s.history.length,1);
  assert.equal(tick(s,{position:{x:30,y:-3,z:0}}).x,0);
  assert.equal(s.reason,'below-surface');
});
test('normal jump duration never recovers; missing coverage gets grace and boundary recovers immediately',()=>{
  const s=new WorldSafety();tick(s);
  for(let i=0;i<60;i++)assert.equal(tick(s,{position:{x:0,y:10+Math.sin(i/60*Math.PI)*3,z:0},grounded:false}),null);
  for(let i=0;i<29;i++)assert.equal(tick(s,{surface:{...valid,valid:false}}),null);
  assert.ok(tick(s,{surface:{...valid,valid:false}}));
  assert.ok(tick(s,{surface:{...valid,inBounds:false,valid:false}}));
});
test('vehicle recovery uses its own safe position and cannot reuse a different region',()=>{
  const s=new WorldSafety(),vehicle={};tick(s);tick(s,{position:{x:20,y:11,z:0},vehicle});
  const restored=tick(s,{position:{x:25,y:-20,z:0},vehicle});
  assert.equal(restored.x,20);assert.equal(restored.vehicle,vehicle);
  assert.equal(tick(s,{region:'ogbomoso',position:{x:25,y:-20,z:0},vehicle}),null);
});
test('recovery skips a previously safe position whose surface has unloaded',()=>{
  const s=new WorldSafety();tick(s);tick(s,{position:{x:20,y:10,z:0}});
  const result=tick(s,{position:{x:25,y:-20,z:0},validateSafe:p=>p.x===0});
  assert.equal(result.x,0);
});
test('complete surface loss holds the safe pose until valid collision returns',()=>{
  const s=new WorldSafety();tick(s);
  const input={surface:{...valid,valid:false,collider:false},validateSafe:()=>false};
  let result;for(let i=0;i<31;i++)result=tick(s,input);
  assert.equal(result.awaitingSurface,true);assert.equal(s.recoveries,1);
  assert.equal(tick(s,input).awaitingSurface,true);assert.equal(s.history.length,1);
  tick(s);assert.equal(s.holding,null);
});
test('map and world share exact source identity/coordinates; generated registry stays derived and region isolated',async()=>{
  for(const region of ['ibadan','ogbomoso']){
    const base=new URL(`../public/data/world/${region}/`,import.meta.url);
    const source=JSON.parse(await fs.readFile(new URL('map/landmarks.json',base),'utf8'));
    const generated=JSON.parse(await fs.readFile(new URL('landmarks.json',base),'utf8'));
    const r=new LandmarkRegistry();r.install(region,generated.landmarks);
    for(const p of r.all()){
      const original=source.landmarks.find(o=>o.id===p.id);assert.ok(original);
      assert.deepEqual(p.mapCoordinates,p.worldCoordinates);assert.equal(p.x,original.x);assert.equal(p.z,original.z);
      assert.equal(p.source.identity,original.source.identity);assert.ok(p.modelOverrideId);
    }
    const other=region==='ibadan'?'ogbomoso':'ibadan';r.install(other,generated.landmarks);assert.equal(r.all().length,0);
  }
});
const building={id:'way:1283222827',minX:0,maxX:20,minZ:0,maxZ:15,height:105,baseY:10,polygons:[[[[0,0],[20,0],[20,15],[0,15]]]]};
test('overrides follow source footprints, quality/LOD budgets and source collision ownership',()=>{
  const definition={architecture:'tower',tier:'B'},identity={id:'osm:way:1283222827',region:'ibadan'};
  const stats=[];
  for(const lod of ['far','medium','near']){
    const model=createLandmarkModel(building,{lod,identity,definition});stats.push(model.userData.landmark);
    assert.equal(model.userData.landmark.colliderOwnership,'building-footprint');
    assert.ok(model.userData.landmark.triangles<3000);
    model.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
  }
  assert.ok(stats[0].triangles<stats[1].triangles);assert.ok(stats[1].triangles<stats[2].triangles);
  const low=createLandmarkModel(building,{lod:'near',identity,definition,lowPerformance:true});
  assert.ok(low.userData.landmark.triangles<stats[2].triangles);
});
test('override registry selects by source and falls back across regions or unknown buildings',()=>{
  const r=new LandmarkRegistry();r.install('ibadan',[{id:'osm:way:1283222827',name:'Cocoa House',region:'ibadan',x:-1976,z:904,source:{provider:'OpenStreetMap',identity:building.id}}]);
  const overrides=new BuildingOverrideRegistry(),remove=installLandmarkOverrides(overrides,r);
  assert.ok(overrides.create(building,{lod:'far',region:'ibadan'}));
  assert.equal(overrides.create(building,{lod:'near',region:'ogbomoso'}),null);
  assert.equal(overrides.create({...building,id:'way:1'},{region:'ibadan'}),null);remove();assert.equal(overrides.has(building.id),false);
});
test('campus components batch by source landmark and LOD with bounded draw calls',()=>{
  const identity={id:'osm:way:82467201',region:'ibadan'},definition={architecture:'institution',tier:'C'};
  const objects=Array.from({length:20},(_,i)=>createLandmarkModel({...building,minX:i*30,maxX:i*30+20},{lod:'near',identity,definition}));
  const before=objects.reduce((sum,o)=>sum+o.userData.landmark.triangles,0),batches=batchLandmarkModels(objects);
  assert.equal(batches.length,1);assert.equal(batches[0].userData.landmark.triangles,before);assert.equal(batches[0].userData.landmark.drawCalls,2);
});
test('area landmark lifecycle loads once, changes LOD, unloads and respects missing terrain',()=>{
  const identity={id:'osm:way:373337181',name:'Agodi Gardens',region:'ibadan',x:0,z:0,source:{provider:'OpenStreetMap',identity:'way:373337181'},siteRings:[[[0,0],[50,0],[50,50],[0,50]]]};
  const registry=new LandmarkRegistry();registry.install('ibadan',[identity]);const overrides=new BuildingOverrideRegistry();installLandmarkOverrides(overrides,registry);
  const scene=new THREE.Scene();let valid=true;
  const sites=new LandmarkSites({scene,registry,overrides,worldSurface:{coverageAt:()=>({valid}),heightAt:()=>10}});
  sites.update(0,0);assert.equal(sites.loaded.size,1);const near=sites.loaded.get(identity.id);sites.update(0,0);assert.equal(sites.loaded.get(identity.id),near);
  sites.update(500,0);assert.equal(sites.loaded.get(identity.id).userData.landmark.lod,'medium');
  sites.update(2000,0);assert.equal(sites.loaded.size,0);assert.equal(scene.children.length,0);
  valid=false;sites.update(0,0);assert.equal(sites.loaded.size,0);sites.dispose();
});
test('park ground matches actual non-planar terrain triangles and preserves source holes',()=>{
  const terrain=new THREE.PlaneGeometry(100,100,4,4).rotateX(-Math.PI/2),p=terrain.attributes.position;
  for(let i=0;i<p.count;i++)p.setY(i,Math.sin(i*2)*12);
  const world=new WorldSurface({terrainMesh:new THREE.Mesh(terrain)});
  const rings=[[[-43,-41],[39,-41],[39,37],[-43,37]],[[-8,-7],[-8,14],[13,14],[13,-7]]];
  const grass=landmarkGround(rings,world),v=grass.attributes.position;assert.ok(v.count>30);
  for(let i=0;i<v.count;i+=3){
    const x=(v.getX(i)+v.getX(i+1)+v.getX(i+2))/3,z=(v.getZ(i)+v.getZ(i+1)+v.getZ(i+2))/3,y=(v.getY(i)+v.getY(i+1)+v.getY(i+2))/3;
    assert.ok(Math.abs(y-world.heightAt(x,z)-.04)<2e-4);
    const a=new THREE.Vector3().fromBufferAttribute(v,i),b=new THREE.Vector3().fromBufferAttribute(v,i+1),c=new THREE.Vector3().fromBufferAttribute(v,i+2);
    if(b.sub(a).cross(c.sub(a)).length()<1e-5)continue;
    assert.ok(pointInRing(x,z,rings[0]));assert.equal(pointInRing(x,z,rings[1]),false);
  }
  grass.dispose();terrain.dispose();
});
test('unvalidated and oversized imported GLBs are rejected before decoder work',async()=>{
  let calls=0;await assert.rejects(loadLandmarkAsset('/assets/models/landmarks/test.glb',null,{fetcher:()=>{calls++;}}));assert.equal(calls,0);
  const report={valid:true,sha256:'0'.repeat(64),bytes:3,limits:{bytes:3}};
  await assert.rejects(loadLandmarkAsset('/assets/models/landmarks/test.glb',report,{fetcher:async()=>({ok:true,headers:{get:()=>null},body:new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4));controller.close();}})})}),/exceeds validated size/);
});
test('asset admission rejects excessive geometry/textures, missing scale/LOD/collision and external resources',()=>{
  const doc={asset:{version:'2.0'},meshes:[{primitives:[{attributes:{POSITION:0}}]}],accessors:[{count:300}],buffers:[{byteLength:3600}]};
  const contract={metresPerUnit:1,upAxis:'+Y',forwardAxis:'+Z',pivot:'ground-center',lods:['near','medium','far'],collision:'box'};
  assert.equal(validateAsset(doc,4000,contract).valid,true);
  assert.equal(validateAsset(doc,4000).valid,false);
  assert.equal(validateAsset({...doc,accessors:[{count:300003}]},4000,contract).valid,false);
  assert.equal(validateAsset({...doc,accessors:[{count:-3}]},4000,contract).valid,false);
  assert.equal(validateAsset({...doc,images:[{uri:'external.png'}]},4000,{...contract,textures:[{width:8192,height:8192}]}).valid,false);
});
