import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LANDMARK_MODELS } from '../navigation/LandmarkIdentity.js';
import {landmarkGround} from './LandmarkGround.js';

// Source footprint, base height and collision shell remain BuildingSystem-owned.
// Tier C preserves the source massing; Tier B adds a tiered tower silhouette.
export function createLandmarkModel(record, { lod = 'near', lowPerformance = false, identity, definition, worldSurface }) {
  const group = new THREE.Group();
  group.name = identity.id;
  group.userData.landmark = { ...identity, lod, overrideType: definition.tier, colliderOwnership: 'building-footprint' };
  const material = new THREE.MeshStandardMaterial({ color: definition.architecture === 'tower' ? 0xc5b99a : 0xd7c8aa, roughness: 0.85 });
  const detail = new THREE.MeshStandardMaterial({ color: 0x38545c, roughness: 0.65 });
  if(definition.architecture==='park'){
    material.color.setHex(0x446c38);detail.color.setHex(0x665143);
    const ring=identity.siteRings?.[0]??[];
    const lawn=landmarkGround(identity.siteRings,worldSurface);
    group.add(new THREE.Mesh(lawn,material));
    const count=lod==='far'?3:lowPerformance?6:12;
    for(let i=0;i<Math.min(count,ring.length*2);i++){
      const a=ring[Math.floor(i/2)%ring.length],b=ring[(Math.floor(i/2)+1)%ring.length];
      const x=i%2?(a[0]+b[0])/2:a[0],z=i%2?(a[1]+b[1])/2:a[1];
      const y=worldSurface.heightAt(x,z);
      const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(3,lod==='near'&&!lowPerformance?1:0),material);crown.position.set(x,y+5,z);
      const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.25,.4,4,5),detail);trunk.position.set(x,y+2,z);group.add(crown,trunk);
    }
    group.userData.landmark.colliderOwnership='decorative-no-collision';
    group.userData.landmark.triangles=0;
    group.traverse(o=>{if(o.isMesh)group.userData.landmark.triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;});
    group.userData.landmark.drawCalls=group.children.length;return batchLandmarkModels([group])[0];
  }
  const w = record.maxX-record.minX, d = record.maxZ-record.minZ, h = record.height;
  if (![w,d,h,record.baseY].every(Number.isFinite) || Math.min(w,d,h)<=0) { material.dispose();detail.dispose();return null; }
  // Keep geometry within the existing collision footprint by extruding its rings.
  for(const polygon of record.polygons){
    const shape=new THREE.Shape(polygon[0].map(([x,z])=>new THREE.Vector2(x,-z)));
    for(const ring of polygon.slice(1))shape.holes.push(new THREE.Path(ring.map(([x,z])=>new THREE.Vector2(x,-z))));
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:h-(record.minHeight??0),bevelEnabled:false,steps:1});
    geometry.rotateX(-Math.PI/2);geometry.translate(0,record.baseY+(record.minHeight??0),0);
    const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  }
  if(lod!=='far'){
    const budget=definition.architecture==='tower' ? (lowPerformance?6:lod==='near'?20:10) : (lowPerformance?2:4);
    const levels=Math.max(1,Math.min(record.levels??budget,budget));
    for(let i=1;i<=levels;i++)for(const polygon of record.polygons)for(const ring of polygon)for(let j=0;j<ring.length;j++){
      const a=ring[j],b=ring[(j+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<1)continue;
      const height=Math.min(.8,h/(levels+1)*.45),mesh=new THREE.Mesh(new THREE.BoxGeometry(length*.82,height,.06),detail);
      mesh.position.set((a[0]+b[0])/2,record.baseY+h*i/(levels+1),(a[1]+b[1])/2);mesh.rotation.y=-Math.atan2(dz,dx);group.add(mesh);
    }
  }
  group.userData.landmark.triangles=0;
  group.traverse(o=>{if(o.isMesh)group.userData.landmark.triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;});
  group.userData.landmark.drawCalls=group.children.length;
  if(!group.children.some(o=>o.material===detail))detail.dispose();
  return group;
}

// A campus may contain hundreds of source buildings. Merge the active tile's
// components by landmark/LOD/material instead of adding a draw call per facade.
export function batchLandmarkModels(objects){
  const batches=new Map();
  for(const object of objects){
    const l=object.userData.landmark;
    if(!l){batches.set(Symbol(),{passthrough:object});continue;}
    const key=`${l.id}:${l.lod}`;
    if(!batches.has(key))batches.set(key,{identity:l,materials:new Map()});
    const batch=batches.get(key);object.updateMatrixWorld(true);
    object.traverse(mesh=>{
      if(!mesh.isMesh)return;
      const key=`${mesh.material.color.getHex()}:${mesh.material.roughness}`;
      let material=batch.materials.get(key);
      if(!material){material={material:mesh.material,geometries:[]};batch.materials.set(key,material);}
      const geometry=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();
      material.geometries.push(geometry.applyMatrix4(mesh.matrixWorld));
      mesh.geometry.dispose();if(material.material!==mesh.material)mesh.material.dispose();
    });
  }
  return [...batches.values()].map(batch=>{
    if(batch.passthrough)return batch.passthrough;
    const group=new THREE.Group();group.name=batch.identity.id;
    let triangles=0;
    for(const {material,geometries} of batch.materials.values()){
      const geometry=mergeGeometries(geometries);for(const g of geometries)g.dispose();
      if(!geometry){material.dispose();continue;}
      const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
      triangles+=(geometry.index?.count??geometry.attributes.position.count)/3;
    }
    group.userData.landmark={...batch.identity,triangles,drawCalls:group.children.length};return group;
  });
}

export function installLandmarkOverrides(overrides, registry, lowPerformance=false) {
  const dispose=[];
  for(const identity of registry.all()){
    const definition=LANDMARK_MODELS[identity.id];
    if(!definition||definition.regionId!==identity.region)continue;
    for(const sourceId of new Set([identity.source.identity,...(identity.componentSourceIds??[])]))
      dispose.push(overrides.register(sourceId,(record,context)=>context.region===identity.region?createLandmarkModel(record,{...context,lowPerformance,identity,definition}):null));
  }
  return ()=>dispose.forEach(fn=>fn());
}
