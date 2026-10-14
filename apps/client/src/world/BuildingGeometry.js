import * as THREE from 'three';
import {buildBuildingData} from './BuildingMeshData.js';
import {unpackGeometry} from './RoadWorldTransfer.js';

// Windows and details share the wall material: architecture adds no tile draw calls.
export function buildingMaterials() {
  return [new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.9,side:THREE.DoubleSide}),
    new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.68,metalness:0.18,side:THREE.DoubleSide})];
}
export function geometriesFromData(data) {
  const geometry=data.geometry.map(g=>g?unpackGeometry(g):null);
  geometry.forEach(g=>g?.computeBoundingSphere());
  geometry.buildStats=data.stats;
  geometry.workerMs=data.workerMs??0;
  return geometry;
}
export function buildBuildingGeometry(records,lod,options={}) {
  return geometriesFromData(buildBuildingData(records,lod,options));
}
