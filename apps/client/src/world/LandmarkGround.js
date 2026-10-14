import * as THREE from 'three';
import {clipHalfPlane,cross,polygonArea} from './SurfaceClip.js';

// Clip actual terrain triangles to the source park polygon. Retriangulating a
// sparsely sampled polygon creates a different surface and exposes brown seams.
export function landmarkGround(rings,worldSurface){
  const shape=new THREE.Shape(rings[0].map(([x,z])=>new THREE.Vector2(x,-z)));
  for(const ring of rings.slice(1))shape.holes.push(new THREE.Path(ring.map(([x,z])=>new THREE.Vector2(x,-z))));
  const mask=new THREE.ShapeGeometry(shape),points=mask.attributes.position;
  const positions=[],uvs=[],mesh=worldSurface.terrainMesh,bounds=worldSurface.loadedBounds?.();
  const emit=polygon=>{for(let i=1;i<polygon.length-1;i++)for(const p of [polygon[0],polygon[i],polygon[i+1]]){positions.push(p[0],p[1]+.04,p[2]);uvs.push(p[0]/50,p[2]/50);}};
  for(let i=0;i<mask.index.count;i+=3){
    const triangle=[0,1,2].map(j=>{const k=mask.index.getX(i+j);return [points.getX(k),0,-points.getY(k)];});
    if(cross(...triangle)<0)[triangle[1],triangle[2]]=[triangle[2],triangle[1]];
    if(!mesh||!bounds){emit([triangle[0],triangle[2],triangle[1]].map(p=>[p[0],worldSurface.heightAt(p[0],p[2]),p[2]]));continue;}
    const geometry=mesh.geometry,source=geometry.attributes.position,{widthSegments:cols,heightSegments:rows}=geometry.parameters;
    const sx=(bounds.maxX-bounds.minX)/cols,sz=(bounds.maxZ-bounds.minZ)/rows;
    const x0=Math.max(0,Math.floor((Math.min(...triangle.map(p=>p[0]))-bounds.minX)/sx));
    const x1=Math.min(cols-1,Math.floor((Math.max(...triangle.map(p=>p[0]))-bounds.minX)/sx));
    const z0=Math.max(0,Math.floor((Math.min(...triangle.map(p=>p[2]))-bounds.minZ)/sz));
    const z1=Math.min(rows-1,Math.floor((Math.max(...triangle.map(p=>p[2]))-bounds.minZ)/sz));
    const v=new THREE.Vector3();
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++)for(const offset of [0,3]){
      let polygon=[0,1,2].map(j=>{v.fromBufferAttribute(source,geometry.index.getX((z*cols+x)*6+offset+j)).applyMatrix4(mesh.matrixWorld);return [v.x,v.y,v.z];});
      for(let edge=0;edge<3;edge++)polygon=clipHalfPlane(polygon,triangle[edge],triangle[(edge+1)%3]);
      if(polygon.length>=3&&polygonArea(polygon)>1e-8)emit(polygon);
    }
  }
  mask.dispose();const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.computeVertexNormals();return geometry;
}
