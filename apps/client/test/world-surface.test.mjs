import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { WorldSurface } from '../src/world/WorldSurface.js';
import { RealTerrain } from '../src/world/TerrainSystem.js';
import { RoadSystem } from '../src/world/RoadSystem.js';
import { RoadCollider } from '../src/world/RoadCollider.js';
import { Physics } from '../src/vehicles/VehicleSystem.js';
import { stepGroundContact } from '../src/world/PlayerGroundContact.js';

function meshWithHeights(width, depth, nx, nz, height) {
  const geometry = new THREE.PlaneGeometry(width, depth, nx, nz);
  geometry.rotateX(-Math.PI/2);
  const positions = geometry.getAttribute('position');
  for (let i=0; i<positions.count; i++) positions.setY(i,height(positions.getX(i),positions.getZ(i),i));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  mesh.updateMatrixWorld(true); return mesh;
}
function renderedHeight(mesh, x, z) {
  mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(x,10000,z),new THREE.Vector3(0,-1,0));
  const hits = ray.intersectObject(mesh,true);
  return hits[0]?.point.y ?? null;
}
function near(actual,expected,message) { assert.ok(Math.abs(actual-expected)<1e-5,`${message}: ${actual} vs ${expected}`); }

await test('non-planar terrain matches both actual indexed triangles, vertices, edges, center and diagonal', () => {
  const mesh = meshWithHeights(2,2,1,1,(x,z,i) => [0,10,20,80][i]);
  assert.deepEqual([...mesh.geometry.index.array],[0,2,1,2,3,1]);
  const world = new WorldSurface({terrain:{heightAt:() => -999},terrainMesh:mesh});
  const points = [[-1,-1],[1,-1],[-1,1],[1,1],[0,0],[-0.8,-0.6],[0.8,0.6],
    [-1,0.4],[1,-0.4],[0.3,-1],[-0.3,1],[0.1,-0.1-1e-7],[0.1,-0.1+1e-7]];
  for (const [x,z] of points) near(world.terrainHeightAt(x,z),renderedHeight(mesh,x,z),`terrain at ${x},${z}`);
  // The former a-d diagonal produced 40 here: this is a 25m regression case.
  near(world.terrainHeightAt(0,0),15,'center uses b-c diagonal');
  const inverted = meshWithHeights(2,2,1,1,(x,z,i) => [80,70,60,0][i]);
  const invertedWorld = new WorldSurface({terrainMesh:inverted});
  // The same wrong diagonal can also bury feet: old 40 versus visible 65.
  near(invertedWorld.terrainHeightAt(0,0),renderedHeight(inverted,0,0),'sinking regression');
  near(invertedWorld.terrainHeightAt(0,0),65,'feet follow the exposed triangle');
});

await test('multiple cells, negative coordinates and translated/scaled terrain match rendered mesh', () => {
  const mesh = meshWithHeights(12,8,3,4,(x,z) => x*x*0.12+z*z*0.3+x*z*0.5);
  mesh.position.set(-3,7,-2); mesh.scale.set(1.5,2,0.75); mesh.updateMatrixWorld(true);
  const world = new WorldSurface({terrainMesh:mesh});
  for (let x=-12; x<=6; x+=0.6) for (let z=-5; z<=1; z+=0.3) {
    near(world.terrainHeightAt(x,z),renderedHeight(mesh,x,z),`transformed terrain ${x},${z}`);
  }
});

await test('TerrainSystem generated mesh is the authoritative discretized surface, not raw elevation', () => {
  const terrain = new RealTerrain({center:{lat:7.3962,lon:3.8968},radius:10});
  terrain.heightAt = (x,z) => x*x+z*z;
  const mesh = terrain.createMesh(new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),{size:4,segments:2});
  const world = new WorldSurface({terrain,terrainMesh:mesh});
  near(world.terrainHeightAt(-1,-1),renderedHeight(mesh,-1,-1),'discretized height');
  assert.notEqual(world.terrainHeightAt(-1,-1),terrain.heightAt(-1,-1));
});

function roadFixture(height = () => 0) {
  const mesh = meshWithHeights(40,40,20,20,height);
  const world = new WorldSurface({terrainMesh:mesh});
  const system = new RoadSystem({scene:new THREE.Scene(),groundY:(x,z) => world.terrainHeightAt(x,z)});
  world.setRoadSurface(system.surface);
  const roads = [
    {a:[-12,0],b:[0,0],width:4,wayId:1,seq:0,type:'residential'},
    {a:[0,0],b:[12,0],width:4,wayId:1,seq:1,type:'residential'},
    {a:[0,0],b:[0,-12],width:4,wayId:2,seq:0,type:'residential'},
    {a:[0,0],b:[0,12],width:4,wayId:3,seq:0,type:'residential'}
  ];
  const junctions = [{x:0,z:0,radius:3,arms:[{dirX:1,dirZ:0,width:4},{dirX:-1,dirZ:0,width:4},
    {dirX:0,dirZ:1,width:4},{dirX:0,dirZ:-1,width:4}]}];
  system.surface.addTile('fixture',roads);
  const group=system.buildTile({tx:0,tz:0,roads,junctions});
  system.surface.addRenderedTile('fixture',group);
  const scene=new THREE.Group(); scene.add(mesh,group); scene.updateMatrixWorld(true);
  return {world,system,mesh,group,scene};
}

await test('terrain, shoulder, road and junction transitions follow the top rendered triangle', () => {
  const {world,scene,group}=roadFixture();
  for (const [z,type] of [[-3,'terrain'],[-2.5,'shoulder'],[-2,'road'],[0,'road'],[2.5,'shoulder'],[3,'terrain']]) {
    near(world.sample(-8,z).height,renderedHeight(scene,-8,z),'cross road transition');
    assert.equal(world.sample(-8,z).surface,type);
  }
  for (let x=-8; x<=8; x+=0.25) near(world.sample(x,0).height,renderedHeight(scene,x,0),'road/junction/road');
  near(world.sample(0,0).height,renderedHeight(group,0,0),'junction surface covers center');
  assert.ok(world.sample(0,0).height>world.sample(-8,0).height);
  assert.equal(world.sample(-8,0).roadId,1);
});

await test('nonlinear engineered roads cannot select a buried profile beneath visible terrain', () => {
  const {world,system,group,scene}=roadFixture((x,z) => 3*Math.exp(-x*x/8)+0.1*z*z);
  let buried=0;
  for (let x=-11; x<=11; x+=0.4) for (let z=-3; z<=3; z+=0.3) {
    const road=system.surface.sampleRendered(x,z);
    const terrain=world.terrainHeightAt(x,z);
    if (road && terrain>road.height+0.01) {
      buried++; assert.equal(world.sample(x,z).surface,'terrain');
    }
    near(world.sample(x,z).height,renderedHeight(scene,x,z),'visible top surface');
    if (road) near(road.height,renderedHeight(group,x,z),'road triangle height');
  }
  assert.ok(buried>0,'fixture must reproduce uncut terrain protruding above engineered road');
});

await test('road footprint is polygonal, not endpoint circles; unload/reload removes stale triangles', () => {
  const {system}=roadFixture();
  assert.equal(system.surface.sampleRendered(13,0),null);
  assert.ok(system.surface.sampleRendered(-8,0));
  const count=system.surface.rendered.cells.size;
  system.surface.removeTile('fixture');
  assert.equal(system.surface.sampleRendered(-8,0),null);
  assert.equal(system.surface.rendered.cells.size,0); assert.ok(count>0);
});

await test('grounded uphill/downhill walking tracks floor without airborne flicker or offsets', () => {
  let state={y:0,velocity:0,grounded:true};
  for (const floor of [0.02,0.1,0.25,0.5,0.45,0.3,0.1,-0.2]) {
    state=stepGroundContact(state.y,state.velocity,state.grounded,floor,1/60);
    assert.equal(state.y,floor); assert.equal(state.velocity,0); assert.equal(state.grounded,true);
  }
});

await test('jump keeps its arc, does not snap down to falling terrain and lands on authoritative floor', () => {
  let state=stepGroundContact(0,7,false,0,1/60);
  assert.ok(state.y>0 && !state.grounded);
  const airborne=stepGroundContact(state.y,state.velocity,false,-3,1/60);
  assert.ok(airborne.y>state.y); assert.equal(airborne.grounded,false);
  let peak=0;
  for (let i=0;i<100 && !state.grounded;i++) {
    state=stepGroundContact(state.y,state.velocity,state.grounded,0,1/60); peak=Math.max(peak,state.y);
  }
  assert.ok(peak>1); assert.equal(state.y,0); assert.equal(state.grounded,true);
});

await test('terrain and road colliders match their visible triangles; protruding terrain is a separate wheel contact risk', async () => {
  await RAPIER.init();
  const {mesh,group,world:surface}=roadFixture((x,z) => 3*Math.exp(-x*x/8)+0.1*z*z);
  const physics=new Physics();
  const terrain=physics.addTerrainMesh(mesh);
  const roads=new RoadCollider({physics}); roads.addTile('fixture',group);
  const ray = (collider,x,z) => {
    const hit=collider.castRay(new RAPIER.Ray({x,y:100,z},{x:0,y:-1,z:0}),200,true);
    return hit===null || hit<0 ? null : 100-hit;
  };
  near(ray(terrain,0,1),renderedHeight(mesh,0,1),'terrain collider');
  let overlap=null;
  for (let x=-11; x<=11 && !overlap; x+=0.4) for (let z=-3; z<=3; z+=0.3) {
    const roadY=renderedHeight(group,x,z);
    if (roadY!==null && renderedHeight(mesh,x,z)>roadY+0.01) { overlap={x,z,roadY}; break; }
  }
  assert.ok(overlap,'uncut terrain must protrude above road in fixture');
  const {x,z,roadY}=overlap;
  const roadHeights=roads.tiles.get('fixture').map((c) => ray(c,x,z)).filter((y) => y!==null);
  near(Math.max(...roadHeights),roadY,'road collider');
  assert.ok(ray(terrain,x,z)>Math.max(...roadHeights));
  near(surface.sample(x,z).height,ray(terrain,x,z),'walking selects visible terrain');
  roads.removeTile('fixture'); assert.equal(roads.tiles.size,0);
  physics.world.free();
});
