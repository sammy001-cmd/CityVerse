import fs from 'node:fs/promises';
import * as THREE from 'three';
import { WorldSurface } from '../src/world/WorldSurface.js';
import { RoadSystem } from '../src/world/RoadSystem.js';

const directory=new URL('../public/data/road-tiles/',import.meta.url);
const manifest=JSON.parse(await fs.readFile(new URL('manifest.json',directory),'utf8'));
const data=await Promise.all(manifest.tiles.map(async (key) => [key,JSON.parse(await fs.readFile(new URL(`${key}.json`,directory),'utf8'))]));
const densest=[...data].sort((a,b) => b[1].roads.length-a[1].roads.length)[0];
const radius=process.argv.includes('--low') ? 1 : 2;
const selection=process.argv.includes('--district') ? data.filter(([,tile]) => Math.abs(tile.tx)<=radius && Math.abs(tile.tz)<=radius) : [densest];
const scene=new THREE.Scene();
const geometry=new THREE.PlaneGeometry(1400,1400,128,128);geometry.rotateX(-Math.PI/2);
const p=geometry.attributes.position;
for(let i=0;i<p.count;i++) p.setY(i,2*Math.sin(p.getX(i)/60)+3*Math.cos(p.getZ(i)/90));
geometry.computeVertexNormals();
const terrain=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());scene.add(terrain);
const world=new WorldSurface({terrainMesh:terrain});
const roads=new RoadSystem({scene,groundY:(x,z)=>world.terrainHeightAt(x,z),lowPerformance:process.argv.includes('--low')});
world.setRoadSurface(roads.surface);
let time=performance.now();roads.attachTerrain(terrain,world);
const terrainInitializationMs=performance.now()-time;
for(const [key,tile] of selection) { roads.tileData.set(key,tile);roads.desired.add(key); }
time=performance.now();roads.commitTiles();
const commitMs=performance.now()-time;
let roadTriangles=0,roadDrawCalls=0,terrainTriangles=0,terrainDrawCalls=0,bytes=0;
for(const group of roads.loaded.values()) for(const mesh of group.children) {
  roadDrawCalls++;roadTriangles+=mesh.geometry.attributes.position.count/3;
  for(const attribute of Object.values(mesh.geometry.attributes)) bytes+=attribute.array.byteLength;
}
for(const group of roads.terrainBlend.tiles.values()) {
  terrainDrawCalls++;terrainTriangles+=group.children[0].geometry.attributes.position.count/3;
}
console.log(JSON.stringify({tiles:selection.length,segments:selection.reduce((sum,[,tile])=>sum+tile.roads.length,0),
  terrainInitializationMs:+terrainInitializationMs.toFixed(1),commitMs:+commitMs.toFixed(1),
  terrainClippingMs:+roads.terrainBlend.lastBuildMs.toFixed(1),roadTriangles,roadDrawCalls,terrainTriangles,terrainDrawCalls,
  roadGeometryBytes:bytes},null,2));
