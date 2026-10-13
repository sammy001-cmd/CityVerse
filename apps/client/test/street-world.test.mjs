import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {generateStreetCell,generateStreetCellAsync,StreetOccupancy,roadStreetStyle,wireLinks} from '../src/world/StreetWorldRules.js';
import {StreetWorldSystem} from '../src/world/StreetWorldSystem.js';
import {runStartup} from '../src/world/StartupScheduler.js';
import {RoadSystem} from '../src/world/RoadSystem.js';
import {Physics} from '../src/vehicles/Physics.js';
import RAPIER from '@dimforge/rapier3d-compat';
import {sourceTransitStops} from '../src/world/StreetSourceTransit.js';
const surface={heightAt:(x,z)=>x*0.001+z*0.001};
const edges=Array.from({length:25},(_,i)=>({roadId:1,sequence:i,type:'secondary',width:8,shoulderWidth:0.8,sidewalkWidth:0,a:[10+i*8,100],b:[18+i*8,100],name:'Source Road'}));
const building={id:'way:2',minX:30,maxX:60,minZ:110,maxZ:135,polygons:[[[[30,110],[60,110],[60,135],[30,135]]]]};
const cell=opts=>generateStreetCell({region:'ibadan',key:'0_0',edges,buildings:[building],worldSurface:surface,...opts});

test('source transit excludes rail and invented stops and keeps city identity',()=>{
  const source={provider:'OpenStreetMap'},base={category:'transport',source,x:20,z:30};
  assert.deepEqual(sourceTransitStops([{...base,id:'osm:node:1',name:'Named Bus Stop'},
    {...base,id:'osm:node:2',name:'Train Station'}, {...base,id:'fake',name:'Taxi Stop',source:{provider:'procedural'}}],'ogbomoso'),
    [{id:'osm:node:1',x:20,z:30,source:'osm',region:'ogbomoso'}]);
  assert.equal(cell({stops:[{id:'osm:node:1',x:230,z:180,source:'osm',region:'ogbomoso'}]}).items.filter(i=>i.kind==='shelter').length,0);
});

test('shelter colliders match open posts and roof; small street decoration has no collision',async()=>{
  const physics=await Physics.create(),p={kind:'shelter',x:0,y:0,z:0,angle:Math.PI/2};
  const colliders=physics.createStreetCollider(p);assert.equal(colliders.length,4);physics.world.step();
  const ray=(x,z)=>physics.world.castRay(new RAPIER.Ray({x,y:1.3,z},{x:0,y:0,z:1}),0.2,true);
  assert.equal(ray(0,0),null);assert.ok(ray(-0.7,1.45));
  for(const c of colliders)physics.world.removeCollider(c,true);assert.equal(physics.world.colliders.len(),0);physics.world.free();
});
test('placements are stable across order and reload, region identity is isolated',()=>{
  assert.deepEqual(cell(),cell({edges:edges.slice().reverse()}));assert.deepEqual(cell(),cell());
  assert.notDeepEqual(cell().items,cell({region:'ogbomoso'}).items);
  const housing={propertyUse:1,visualSeed:5,finishQuality:3,parkingPotential:true},frontage={point:[40,100]};
  const buildings=[{...building,housing,frontage},{...building,id:'way:3',housing:{...housing,finishQuality:2},frontage}];
  const tiedEdges=edges.map(e=>({...e,sequence:0}));
  assert.deepEqual(cell({buildings,edges:tiedEdges}),cell({buildings:buildings.slice().reverse(),edges:tiedEdges.slice().reverse()}));
});

test('yielded street generation preserves synchronous placements and records CPU slices',async()=>{
  const result=await generateStreetCellAsync({region:'ibadan',key:'0_0',edges,buildings:[building],worldSurface:surface},async()=>{});
  const {generationWorkMs,generationSlicePeakMs,...data}=result;
  assert.deepEqual(data,cell());assert.ok(generationWorkMs>=0);assert.ok(generationSlicePeakMs>=0);
});
test('spatial exclusions include carriageway, footprint corners, courtyard edges and junction sight zones',()=>{
  const occupancy=new StreetOccupancy({edges,buildings:[building],junctions:[{x:200,z:100,radius:10}]});
  assert.equal(occupancy.clear(50,100),false);assert.equal(occupancy.clear(40,120),false);
  assert.equal(occupancy.clear(60.2,135.2,0.4),false);assert.equal(occupancy.clear(205,110),false);assert.equal(occupancy.clear(20,180),true);
  const data=cell({junctions:[{x:200,z:100,radius:10}]});for(const item of data.items)assert.equal(occupancy.clear(item.x,item.z,item.radius,{furniture:false}),true);
  for(const strip of data.strips)for(const p of [strip.a,strip.b])assert.equal(occupancy.clear(p[0],p[2],strip.width/2,{furniture:false}),true);
});
test('pole spacing, compatible wire runs and impossible gap cuts remain bounded',()=>{
  const poles=cell({buildings:[]}).poles;assert.ok(poles.length>1);
  for(let i=1;i<poles.length;i++)assert.ok(Math.hypot(poles[i].x-poles[i-1].x,poles[i].z-poles[i-1].z)>=24);
  assert.ok(wireLinks(poles).length>0);assert.ok(wireLinks(poles,true).length<wireLinks(poles).length);
  assert.equal(wireLinks([{...poles[0]},{...poles[1],x:poles[0].x+150}]).length,0);
  assert.equal(wireLinks([{...poles[0]},{...poles[1],roadId:99}]).length,0);
});
test('drains split before junctions and walkways preserve opt-in cross-sections',()=>{
  const data=cell({buildings:[],junctions:[{x:100,z:100,radius:8}]});
  assert.ok(data.strips.length>0);assert.ok(data.strips.every(s=>Math.hypot(s.a[0]-s.b[0],s.a[2]-s.b[2])<=3.01));
  const style=roadStreetStyle({...edges[0],sidewalkWidth:1.4},50,1);assert.equal(style.walkway,'existing_sidewalk');
  assert.equal(roadStreetStyle({...edges[0],type:'service'},0,5).drain,'none');
});
test('light eligibility is selective; LOW vegetation, wires and clutter are cheaper',()=>{
  assert.equal(roadStreetStyle({...edges[0],type:'service'},0,1).lights,false);
  assert.equal(roadStreetStyle(edges[0],50,1).lights,true);
  const normal=cell({buildings:[]}),low=cell({buildings:[],low:true});
  assert.ok(low.items.filter(i=>['tree','palm'].includes(i.kind)).length<=normal.items.filter(i=>['tree','palm'].includes(i.kind)).length);
  assert.equal(low.items.filter(i=>['bench','bin','sign'].includes(i.kind)).length,0);
  assert.equal(cell({lod:'far'}).wirePositions.length,0);
});
test('housing provides label-free frontage recipes; real named signs and source-only transit stops',()=>{
  const housing={propertyUse:1,visualSeed:5,finishQuality:3,parkingPotential:true};
  const data=cell({buildings:[{...building,housing,frontage:{point:[40,100]},streetContext:{finish:3,parkingPotential:true}}],stops:[{id:'node:1',source:'osm',x:230,z:180},{id:'fake',source:'procedural',x:100,z:180}]});
  assert.ok(data.items.filter(i=>i.label).every(i=>i.label==='Source Road'));
  assert.equal(data.items.filter(i=>i.kind==='shelter').length,1);assert.equal(data.items.filter(i=>i.kind==='gate').length,0);
  assert.ok(data.items.some(i=>i.frontage));assert.ok(data.items.some(i=>i.form==='public_transport_holder'));
});
test('cells and caches are bounded; shared batches, colliders and region unload are cleaned up',async()=>{
  const removed=[],physics={createStreetCollider:p=>p,world:{removeCollider:p=>removed.push(p)}};
  const buildingSystem={region:'ibadan',available:new Set(),loaded:new Map(),getBuildings:()=>[],housing:{getStreetInputs:()=>null}};
  const roadSystem={tileData:new Map([['0_0',{roads:edges.map(e=>({...e,wayId:e.roadId})),junctions:[]}]]),loaded:new Map([['0_0',{uuid:'roads'}]]),getRoadEdges:()=>edges};
  const system=new StreetWorldSystem({scene:new THREE.Scene(),roadSystem,buildingSystem,worldSurface:surface,physics});
  await system.update(100,100);assert.equal(system.loaded.size,25);assert.ok(system.getStats().drawCalls<=15);assert.ok(system.cache.size<=32);
  // Crowns at their largest supported scale remain inside placement clearance.
  for(const kind of ['tree','palm']){const pos=system.assets[kind].attributes.position;for(let i=0;i<pos.count;i++)assert.ok(Math.hypot(pos.getX(i),pos.getZ(i))*1.2<=2.1+1e-6);}
  const old=system.colliders.size;assert.ok(old>0);
  await system.update(1000,1000);assert.ok(removed.length>=old);assert.ok(system.cache.size<=32);
  buildingSystem.region='ogbomoso';await system.update(100,100);assert.ok([...system.loaded.values()].every(c=>c.region==='ogbomoso'));assert.ok([...system.cache.keys()].every(k=>k.startsWith('ogbomoso:')));
  system.dispose();assert.equal(system.colliders.size,0);assert.equal(system.loaded.size,0);
});
test('first playable waits for required collision but never for unresolved optional world work',async()=>{
  const order=[];let release;const held=new Promise(r=>{release=r;});
  const result=await runStartup({critical:async()=>order.push('collision'),activate:()=>order.push('controls'),firstFrame:async()=>order.push('frame'),optional:[async()=>{order.push('optional');await held;}]});
  assert.deepEqual(order,['collision','controls','frame','optional']);release();await result.completion;
  const errors=[];let played=false;const second=await runStartup({critical:async()=>{},activate:()=>{played=true;},firstFrame:async()=>{},optional:[()=>{throw Error('optional failure');}],onFailure:e=>errors.push(e.message)});
  await second.completion;assert.equal(played,true);assert.deepEqual(errors,['optional failure']);
});
test('spawn road priority preserves final radius and legacy/new street modes are exclusive',async()=>{
  const scene=new THREE.Scene(),road=new RoadSystem({scene,groundY:()=>0,loadRadius:2}),calls=[];
  road.tileSize=250;road.available=new Set(['0_-1','0_0','1_-1','2_-1']);
  road.loadTile=async(x,z)=>{calls.push(`${x}_${z}`);};road.commitTiles=()=>{};
  await road.primeSpawn(33,-12);assert.deepEqual(calls,['0_-1','0_0']);assert.equal(road.loadRadius,2);
  calls.length=0;await road.update(33,-12);assert.ok(calls.includes('2_-1'));
  const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  assert.match(main,/realStreets=P.get\('streets'\)!=='legacy'/);assert.match(main,/if\(realStreets\)\{[\s\S]*new StreetWorldSystem[\s\S]*\}else\{[\s\S]*buildStreetFurniture/);
  assert.doesNotMatch(main,/import.*from ['"]\.\/vehicles\/VehicleSystem/);assert.match(main,/firstFrame:\(\)=>firstPlayableFrame/);
});
