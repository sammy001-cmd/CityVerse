import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {roadClass,ROAD_CLASSES} from '../src/world/RoadClasses.js';
import {RoadSystem} from '../src/world/RoadSystem.js';
import {RoadCollider} from '../src/world/RoadCollider.js';
import {WorldSurface} from '../src/world/WorldSurface.js';
import {Physics} from '../src/vehicles/VehicleSystem.js';
import {subtractTriangle,polygonArea} from '../src/world/SurfaceClip.js';
import {Worker as NodeWorker} from 'node:worker_threads';

const near=(a,b,message='heights agree') => assert.ok(a!==null && b!==null && Math.abs(a-b)<2e-5,`${message}: ${a}, ${b}`);
function ray(mesh,x,z) {
  mesh.updateMatrixWorld(true);
  return new THREE.Raycaster(new THREE.Vector3(x,100,z),new THREE.Vector3(0,-1,0)).intersectObject(mesh,true)[0]?.point.y ?? null;
}
function fixture({height=(x,z)=>4*Math.exp(-x*x/8)+0.02*z*z,tileSize=10,roads=null,junctions=[]}={}) {
  const scene=new THREE.Scene();
  const geometry=new THREE.PlaneGeometry(40,40,10,10); geometry.rotateX(-Math.PI/2);
  const p=geometry.attributes.position;
  for(let i=0;i<p.count;i++) p.setY(i,height(p.getX(i),p.getZ(i)));
  geometry.computeVertexNormals();
  const terrain=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));scene.add(terrain);
  const world=new WorldSurface({terrainMesh:terrain});
  const system=new RoadSystem({scene,groundY:(x,z)=>world.terrainHeightAt(x,z),loadRadius:0});
  system.tileSize=tileSize; world.setRoadSurface(system.surface); system.attachTerrain(terrain,world);
  const data={tx:0,tz:0,roads:roads ?? [{wayId:1,seq:0,type:'residential',width:4,a:[-15,0],b:[15,0]}],junctions};
  system.tileData.set('0_0',data);system.desired.add('0_0');system.commitTiles();
  const visible=new THREE.Group(); for(const group of system.loaded.values()) visible.add(group.clone());
  for(const group of system.terrainBlend.tiles.values()) visible.add(group.clone());
  return {scene,terrain,world,system,data,visible};
}

await test('convex subtraction conserves outside area without cell-sized gaps',()=>{
  const square=[[0,0,0],[2,0,0],[2,0,2],[0,0,2]],triangle=[[0,0,0],[2,0,0],[0,0,2]];
  near(subtractTriangle(square,triangle).reduce((sum,p)=>sum+polygonArea(p),0),2,'remaining half square');
  assert.deepEqual(subtractTriangle(square,[[3,0,3],[4,0,3],[3,0,4]]),[square]);
});

await test('all road classes have width/shoulder/marking hierarchy; sidewalk remains opt-in',()=>{
  for(const type of Object.keys(ROAD_CLASSES)) {
    const style=roadClass({type});assert.ok(style.width>0 && style.shoulder>0 && style.laneWidth>=2.5);
    assert.equal(style.sidewalk,false);
  }
  assert.equal(roadClass({type:'service'}).center,null);
  assert.equal(roadClass({type:'residential'}).center,null);
  assert.equal(roadClass({type:'primary',width:3}).center,null);
  assert.equal(roadClass({type:'motorway',sidewalk:true}).sidewalk,false);
  assert.equal(roadClass({type:'secondary',sidewalk:'both'}).sidewalk,true);
  assert.equal(roadClass({type:'primary',width:8,lanes:2}).width,8);
  assert.equal(roadClass({type:'trunk_link'}).type,'trunk');
});

await test('exact terrain exclusion removes spikes and stitches cut/fill to engineered ribbons',()=>{
  const {terrain,world,system,visible}=fixture();
  assert.equal(terrain.visible,false);
  const road=system.surface.sampleRendered(0,0);
  assert.ok(world.terrainHeightAt(0,0)>road.height,'must reproduce terrain above road');
  near(world.sample(0,0).height,road.height);
  assert.equal(system.terrainBlend.sample(0,0),null,'terrain is removed beneath road');
  for(let x=-14;x<=14;x+=0.6) for(let z=-6;z<=6;z+=0.3) near(world.sample(x,z).height,ray(visible,x,z));
  const rebuilds=system.terrainBlend.rebuilds;
  system.terrainBlend.flush();assert.equal(system.terrainBlend.rebuilds,rebuilds,'idle needs no rebuild');
});

await test('Rapier terrain rays cannot contact through an engineered road; uncovered terrain remains driveable',async()=>{
  await RAPIER.init(); const {terrain,world,system,visible}=fixture();
  const physics=new Physics();physics.addTerrainMesh(terrain);
  const roads=new RoadCollider({physics});system.attachColliderManager(roads);
  assert.equal(physics.terrainCollider,null,'old whole terrain collider removed');
  const sample=(collider,x,z)=>{
    const t=collider.castRay(new RAPIER.Ray({x,y:100,z},{x:0,y:-1,z:0}),200,true);
    return t===null || t<0 ? null : 100-t;
  };
  const top=(manager,x,z)=>{
    const values=[...manager.tiles.values()].flat().map((c)=>sample(c,x,z)).filter((v)=>v!==null);
    return values.length ? Math.max(...values) : null;
  };
  for(const [x,z] of [[0,0],[-5,1],[5,-1],[0,2.4],[0,3.5],[5,6]]) {
    const terrainY=top(system.terrainBlend.colliders,x,z),roadY=top(roads,x,z);
    if(system.surface.sampleRendered(x,z)) assert.equal(terrainY,null,`no terrain under ${x},${z}`);
    const physical=Math.max(terrainY ?? -Infinity,roadY ?? -Infinity);
    near(physical,ray(visible,x,z),'render/physics');near(physical,world.sample(x,z).height,'walking/physics');
  }
  roads.clear();system.terrainBlend.colliders.clear();physics.world.free();
});

await test('tile unload restores original terrain rendering and collider and rebuilds only affected chunks',async()=>{
  await RAPIER.init();const {system,terrain,world}=fixture();
  const physics=new Physics();const roads=new RoadCollider({physics});system.attachColliderManager(roads);
  const before=system.terrainBlend.rebuilds,total=system.terrainBlend.base.size;
  system.desired.clear();system.unloadTile('0_0');system.commitTiles();
  near(system.terrainBlend.sample(0,0).height,world.terrainHeightAt(0,0),'restored terrain');
  assert.equal(system.surface.sampleRendered(0,0),null);
  assert.ok(system.terrainBlend.rebuilds-before<total,'unrelated chunks retained');
  assert.equal(roads.tiles.size,0);
  const ground=new THREE.Group();for(const group of system.terrainBlend.tiles.values()) ground.add(group.clone());
  near(ray(ground,0,0),ray(terrain,0,0));
  system.terrainBlend.colliders.clear();physics.world.free();
});

await test('optional sidewalk/curb geometry is batched and exposed in building edge metadata',()=>{
  const {system}=fixture({height:()=>0,roads:[{wayId:2,seq:0,type:'secondary',width:6,sidewalk:'both',a:[-12,0],b:[12,0]}]});
  const group=system.loaded.get('0_0');
  assert.equal(group.children.filter((mesh)=>mesh.userData.surfaceType==='curb').length,1);
  assert.equal(group.children.filter((mesh)=>mesh.userData.surfaceType==='sidewalk').length,1);
  const edge=system.getRoadEdges()[0]; assert.equal(edge.sidewalkWidth,1.4);assert.equal(edge.curbHeight,0.12);
  assert.ok(edge.sections.length>2);assert.equal(edge.sections[0].left.length,3);
  assert.equal(system.getRoadEdges({minX:100,maxX:110,minZ:100,maxZ:110}).length,0);
  assert.equal(system.surface.sampleRendered(0,4.5).surface,'sidewalk');
});

await test('major markings are batched, residential roads remain unmarked and low mode removes edge-line geometry',()=>{
  const {system}=fixture({height:()=>0});
  const road={wayId:4,seq:0,type:'primary',width:7,a:[-12,0],b:[12,0]};
  system.surface.addTile('paint',[road]);
  const full=system.roadGeometry.build([road]);
  assert.ok(full.markings.attributes.position.count>12);
  assert.equal(system.roadGeometry.build([{...road,type:'residential'}]).markings,null);
  system.roadGeometry.lowPerformance=true;
  const low=system.roadGeometry.build([road]);
  assert.ok(low.markings.attributes.position.count<full.markings.attributes.position.count);
  assert.equal(low.asphalt.attributes.position.count,full.asphalt.attributes.position.count,'physics geometry unaffected by marking LOD');
});

await test('shared-way endpoints across tile boundaries have matching miter and profile heights',()=>{
  const roads=[{wayId:7,seq:0,type:'residential',width:4,a:[-12,-2],b:[0,0]},
    {wayId:7,seq:1,type:'residential',width:4,a:[0,0],b:[10,7]}];
  const {system}=fixture({roads:[roads[0]],height:(x,z)=>Math.sin(x/3)+z*z*0.04});
  system.tileData.set('1_0',{tx:1,tz:0,roads:[roads[1]],junctions:[]});system.desired.add('1_0');system.commitTiles();
  const edges=system.getRoadEdges();
  const left=edges.find((e)=>e.sequence===0).sections.at(-1).left;
  const right=edges.find((e)=>e.sequence===1).sections[0].left;
  for(let i=0;i<3;i++) near(left[i],right[i],'shared endpoint position');
});

await test('junction apron replaces overlaps and matches road/shoulder/collider boundaries',async()=>{
  await RAPIER.init();
  const roads=[{wayId:1,seq:0,type:'residential',width:4,a:[-15,0],b:[0,0]},
    {wayId:2,seq:0,type:'residential',width:4,a:[0,0],b:[15,0]},
    {wayId:3,seq:0,type:'residential',width:4,a:[0,0],b:[0,15]}];
  const junctions=[{junctionId:'j',x:0,z:0,radius:3,arms:[{dirX:-1,dirZ:0,width:4},{dirX:1,dirZ:0,width:4},{dirX:0,dirZ:1,width:4}]}];
  const {system,world,visible}=fixture({height:(x,z)=>0.08*x+0.05*z,roads,junctions});
  const group=system.loaded.get('0_0'),junction=group.getObjectByName('RoadJunctions');
  assert.ok(junction);near(ray(junction,0,0),world.sample(0,0).height);
  const other=new THREE.Group();for(const mesh of group.children) if(mesh!==junction) other.add(mesh.clone());
  assert.equal(ray(other,0,0),null,'center strips were actually removed');
  for(let x=-8;x<=8;x+=0.2) near(world.sample(x,0).height,ray(visible,x,0));
  const physics=new Physics(),colliders=new RoadCollider({physics});system.attachColliderManager(colliders);
  const hits=colliders.tiles.get('0_0').map((c)=>c.castRay(new RAPIER.Ray({x:0,y:100,z:0},{x:0,y:-1,z:0}),200,true)).filter((t)=>t!==null && t>=0);
  near(100-Math.min(...hits),ray(junction,0,0));
  colliders.clear();system.terrainBlend.colliders.clear();physics.world.free();
});

await test('worker transactions match rendered/query heights, retain old geometry while preparing, and restore unloaded terrain',async()=>{
  class WorkerBridge {
    constructor(url) {
      this.worker=new NodeWorker(`const {parentPort,workerData}=require('node:worker_threads');
        import(workerData.url).then(({prepareRoadWorld})=>parentPort.on('message',(message)=>{
          try {const {result,transfers}=prepareRoadWorld(message);parentPort.postMessage(result,transfers);}
          catch(error){parentPort.postMessage({id:message.id,error:error.message});}
        }));`,{eval:true,workerData:{url:url.href}});
      this.worker.on('message',(data)=>this.onmessage?.({data}));
      this.worker.on('error',(error)=>this.onerror?.(error));
    }
    postMessage(value) { this.worker.postMessage(value); }
    terminate() { return this.worker.terminate(); }
  }
  globalThis.Worker=WorkerBridge;
  let system;
  try {
    const value=fixture();system=value.system;
    const before=system.loaded.get('0_0');
    const pending=system.commitTilesInWorker();
    assert.equal(system.loaded.get('0_0'),before,'existing road kept while worker runs');
    await pending;assert.ok(system.worker,'worker did not fall back');
    const visible=new THREE.Group();
    for(const group of [...system.loaded.values(),...system.terrainBlend.tiles.values()]) visible.add(group.clone());
    for(const [x,z] of [[0,0],[0,2.5],[0,4],[5,6]]) near(value.world.sample(x,z).height,ray(visible,x,z),'worker geometry equality');
    const installed=system.loaded.get('0_0');
    await system.commitTilesInWorker();assert.equal(system.loaded.get('0_0'),installed,'unchanged tile not rebuilt');
    system.tileData.clear();system.desired.clear();
    await system.commitTilesInWorker();
    assert.equal(system.loaded.size,0);
    near(system.terrainBlend.sample(0,0).height,value.world.terrainHeightAt(0,0),'worker unload restoration');
  } finally {
    await system?.worker?.terminate();delete globalThis.Worker;
  }
});
