import * as THREE from 'three';
import {WorldSurface} from './WorldSurface.js';
import {RoadSurface} from './RoadSurface.js';
import {RoadGeometry} from './RoadGeometry.js';
import {JunctionBuilder} from './JunctionBuilder.js';
import {RoadTerrainBlend} from './RoadTerrainBlend.js';
import {buildRoadTile} from './RoadTileBuilder.js';
import {packGeometry,packGroup} from './RoadWorldTransfer.js';

// No Rapier, textures, DOM or game loop in this worker. Only geometry preparation.
let context=null,blend=null,groups=new Map(),previousJunctions=[],signature=null;
export function prepareRoadWorld(message) {
  const transfers=[];
  if(!context) {
    const source=message.terrain;
    const p=source.parameters;
    const geometry=new THREE.PlaneGeometry(p.width,p.height,p.widthSegments,p.heightSegments);
    for(const [name,value] of Object.entries(source.attributes)) geometry.setAttribute(name,new THREE.BufferAttribute(value.array,value.itemSize));
    const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());
    mesh.matrix.fromArray(source.matrix);mesh.matrix.decompose(mesh.position,mesh.quaternion,mesh.scale);
    const world=new WorldSurface({terrainMesh:mesh});
    const surface=new RoadSurface({terrainY:(x,z)=>world.terrainHeightAt(x,z)});
    const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
    context={surface,roadGeometry:new RoadGeometry({surface,lowPerformance:message.lowPerformance}),
      junctionBuilder:new JunctionBuilder({surface}),roadMaterial:material,shoulderMaterial:material,
      groundMaterial:material,concreteMaterial:material,markingMaterial:material};
    blend=new RoadTerrainBlend({terrainMesh:mesh,scene:new THREE.Scene(),surface,tileSize:message.tileSize});
  }
  const tiles=new Map(message.tiles),junctions=[...tiles.values()].flatMap((data)=>data.junctions);
  const nextSignature=JSON.stringify(junctions),junctionChanged=nextSignature!==signature;
  const changedRoads=[],changedTerrain=new Set(),removed=[];
  const changedWays=new Set();
  for(const [key,data] of tiles) if(!groups.has(key)) for(const road of data.roads) changedWays.add(road.wayId);
  // Initial terrain output includes all base tiles; later jobs touch only dirty tiles.
  if(message.first) for(const key of blend.tiles.keys()) changedTerrain.add(key);
  for(const key of groups.keys()) if(!tiles.has(key)) {
    for(const edge of groups.get(key).userData.roadEdges) changedWays.add(edge.roadId);
    blend.markRoadTile(key);context.surface.removeTile(key);groups.delete(key);removed.push(key);
  }
  context.surface.setJunctions(junctions);
  context.roadGeometry.connectedRoads=[...tiles.values()].flatMap((data)=>data.roads);
  context.surface.setConnections(context.roadGeometry.connectedRoads);
  const points=[...previousJunctions,...junctions];
  for(const [key,data] of tiles) {
    const near=junctionChanged && points.some((j)=>data.roads.some((r)=>
      Math.min(Math.hypot(r.a[0]-j.x,r.a[1]-j.z),Math.hypot(r.b[0]-j.x,r.b[1]-j.z))<(j.radius ?? 3)+20));
    if(groups.has(key) && !near && !data.roads.some((road)=>changedWays.has(road.wayId))) continue;
    blend.markRoadTile(key);context.surface.addTile(key,data.roads);
    const group=buildRoadTile.call(context,data);
    context.surface.addRenderedTile(key,group);blend.markRoadTile(key);
    const old=groups.get(key);old?.traverse((mesh)=>mesh.geometry?.dispose());
    groups.set(key,group);changedRoads.push([key,packGroup(group,transfers)]);
  }
  for(const key of blend.dirty) changedTerrain.add(key);
  blend.flush();signature=nextSignature;previousJunctions=junctions;
  const terrain=[...changedTerrain].map((key)=>[key,packGeometry(blend.tiles.get(key).children[0].geometry,transfers)]);
  return {result:{id:message.id,roads:changedRoads,terrain,removed,junctions,terrainBuildMs:blend.lastBuildMs},transfers};
}

if(typeof self!=='undefined') self.onmessage=(event)=>{
  try { const {result,transfers}=prepareRoadWorld(event.data);self.postMessage(result,transfers); }
  catch(error) { self.postMessage({id:event.data.id,error:error.message}); }
};
