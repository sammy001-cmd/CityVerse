import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildV4PolygonRoadTile } from '../src/world/V4PolygonRoadTile.js';
import { createV4ElevationSampler } from '../src/world/V4RoadSystem.js';
import { Physics } from '../src/vehicles/Physics.js';
import { RoadCollider, colliderMeshData } from '../src/world/RoadCollider.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { WorldSurface } from '../src/world/WorldSurface.js';

test('V4 polygon tile triangulates a hole and shares rendered surface with queries', async () => {
  const data = JSON.parse(await fs.readFile('.world-assets/staging/road-world-v4-subset/0_0.json', 'utf8'));
  data.features = [{ ids: ['way-a', 'way-b'], types: ['residential'], width: 6, outer: [[10,10],[90,10],[90,30],[10,30]], holes: [[[40,15],[60,15],[60,25],[40,25]]] }];
  const built = buildV4PolygonRoadTile(data, { terrainHeightAt: () => 4 });
  assert.ok(built.triangleCount >= 8, 'hole is represented in triangulation');
  const road = built.query.sample(20,20);
  assert.equal(road.surface, 'road');
  assert.equal(road.roadId, 'way-a');
  assert.equal(built.query.sample(50,20), null, 'hole is not filled by asphalt');
  assert.equal(road.width, 6, 'queries use the same width-bearing rendered mesh');
  built.group.children[0].geometry.dispose();
  built.group.children[0].material.dispose();
});

test('V4 terrain profile smooths small longitudinal noise and preserves the slope', () => {
  const sampleHeight = createV4ElevationSampler([
    { wayId: 'east', seq: 0, a: [-20,0], b: [20,0], nodeA: null, nodeB: null }
  ], (x) => 0.1 * x + 0.25 * Math.sin(x * Math.PI / 3));
  const height = sampleHeight(5, 0, { ids: ['east'] });
  assert.ok(Math.abs(height - 0.5) < 0.08, `expected smoothed 0.5 m slope, got ${height}`);
});

test('V4 connected road profiles share one elevation at a junction', () => {
  const sampleHeight = createV4ElevationSampler([
    { wayId: 'east', seq: 0, a: [-10,0], b: [0,0], nodeA: 'junction', nodeB: 'junction' },
    { wayId: 'north', seq: 0, a: [0,0], b: [0,10], nodeA: 'junction', nodeB: 'junction' }
  ], (x, z) => 0.04 * x + 0.02 * z);
  const east = sampleHeight(0, 0, { ids: ['east'] });
  const north = sampleHeight(0, 0, { ids: ['north'] });
  assert.equal(east, north);
});

test('V4 render, query, and collider use identical upward-facing world triangles', () => {
  const data = { version: 1, tx: 2, tz: -1, tileSize: 250, features: [
    { ids: ['straight'], types: ['residential'], width: 6,
      outer: [[20,20],[80,20],[80,80],[20,80]], holes: [] }
  ] };
  const built = buildV4PolygonRoadTile(data, { terrainHeightAt: () => 4 });
  const mesh = built.group.children[0];
  built.group.updateMatrixWorld(true);
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const colliderData = colliderMeshData(geometry, mesh.matrixWorld);
  const queried = built.query.sample(550, -200);
  const worldSurface = new WorldSurface({ terrain: { heightAt: () => 4 }, roadSurface: {
    terrainMasked: false, sampleRendered: (x,z) => built.query.sample(x,z)
  } });
  const floor = worldSurface.floorAt(550, -200);

  assert.equal(queried.surface, 'road');
  assert.ok(Math.abs(queried.height - 4.035) < 1e-5);
  assert.equal(floor.surface, 'road');
  assert.equal(floor.height, queried.height);
  assert.equal(queried.roadTile, '2_-1');
  assert.ok(queried.roadTriangleId >= 0);
  assert.deepEqual([...colliderData.indices], [...geometry.index.array]);
  assert.equal(colliderData.vertices.length, position.count * 3);
  for (let i = 0; i < position.count; i++) {
    assert.ok(Math.abs(colliderData.vertices[i*3] - position.getX(i)) < 1e-5);
    assert.ok(Math.abs(colliderData.vertices[i*3+1] - position.getY(i)) < 1e-5);
    assert.ok(Math.abs(colliderData.vertices[i*3+2] - position.getZ(i)) < 1e-5);
    assert.ok(normals.getY(i) > 0.99, `vertex ${i} normal points upward`);
  }
  const queryTriangle = built.query.tiles.get('2_-1')[queried.roadTriangleId];
  assert.ok(queryTriangle, 'query ID references a triangle from the final render mesh');
  const faceStart = queried.roadTriangleId * 3;
  for (let j = 0; j < 3; j++) {
    const vertex = geometry.index.getX(faceStart + j);
    assert.equal(colliderData.indices[faceStart + j], vertex);
    assert.equal(colliderData.vertices[vertex*3], position.getX(vertex));
    assert.equal(colliderData.vertices[vertex*3+1], position.getY(vertex));
    assert.equal(colliderData.vertices[vertex*3+2], position.getZ(vertex));
  }
  built.group.traverse(o => o.geometry?.dispose());
});

test('Rapier vehicle body rests on the V4 top surface without terrain replacement', async () => {
  const physics = await Physics.create();
  const roads = new RoadCollider({ physics });
  const built = buildV4PolygonRoadTile({ version: 1, tx: 0, tz: 0, tileSize: 250,
    features: [{ ids: ['straight'], types: ['residential'], width: 6,
      outer: [[20,20],[80,20],[80,80],[20,80]], holes: [] }] },
    { terrainHeightAt: () => 4 });
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(100, 0.01, 100)
    .setTranslation(50, 3.99, 50));
  roads.addTile('0_0', built.group);
  physics.world.step();
  const roadHit = roads.raycastHeight(50, 50, 10, 20);
  assert.ok(roadHit, 'Rapier ray hits the V4 road surface');
  assert.ok(Math.abs(roadHit.height - 4.035) < 1e-4);
  assert.ok(roadHit.normal.y > 0.99, 'collision normal faces upward');
  assert.notEqual(roadHit.triangleId, null);
  const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(50, 8, 50).setLinearDamping(0));
  physics.world.createCollider(RAPIER.ColliderDesc.ball(0.5).setMass(1), body);
  for (let i = 0; i < 180; i++) physics.world.step();
  assert.ok(Math.abs(body.translation().y - 4.535) < 0.08,
    `dynamic body rests on asphalt top at y≈4.535, got ${body.translation().y}`);
  roads.clear();
  built.group.traverse(o => o.geometry?.dispose());
  physics.world.free();
});
