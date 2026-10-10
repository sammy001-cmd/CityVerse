import * as THREE from 'three';
import { subtractTriangle, polygonArea } from './SurfaceClip.js';

// Replace overlapping strips with a single apron, preserving material attributes.
export function clipRoadGeometry(geometry, junctionGeometry) {
  const position=geometry.getAttribute('position');
  const attributes=Object.entries(geometry.attributes);
  const outputs=Object.fromEntries(attributes.map(([name]) => [name,[]]));
  const metadata=[];
  const junctions=junctionGeometry.getAttribute('position');
  const cutters=[];
  for(let i=0;i<junctions.count;i+=3) {
    const t=[0,1,2].map((j) => [junctions.getX(i+j),junctions.getY(i+j),junctions.getZ(i+j)]);
    if(polygonArea(t)>1e-8) cutters.push(t);
  }
  for(let i=0;i<position.count;i+=3) {
    let polygons=[[0,1,2].map((j) => attributes.flatMap(([,a]) =>
      Array.from({length:a.itemSize},(_,k) => a.array[(i+j)*a.itemSize+k])))];
    const source=polygons[0];
    const minX=Math.min(...source.map((p) => p[0])),maxX=Math.max(...source.map((p) => p[0]));
    const minZ=Math.min(...source.map((p) => p[2])),maxZ=Math.max(...source.map((p) => p[2]));
    for(const t of cutters) {
      if(Math.max(...t.map((p) => p[0]))<minX || Math.min(...t.map((p) => p[0]))>maxX ||
          Math.max(...t.map((p) => p[2]))<minZ || Math.min(...t.map((p) => p[2]))>maxZ) continue;
      polygons=polygons.flatMap((p) => subtractTriangle(p,t,polygonArea(source)<1e-8));
      if(!polygons.length) break;
    }
    // Stitch newly clipped boundary vertices to the apron, not to the former
    // independently smoothed strip. This removes vertical cracks at joins.
    for(const p of polygons) for(const point of p) {
      for(const t of cutters) {
        const [a,b,c]=t;
        const denominator=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
        const u=((b[2]-c[2])*(point[0]-c[0])+(c[0]-b[0])*(point[2]-c[2]))/denominator;
        const v=((c[2]-a[2])*(point[0]-c[0])+(a[0]-c[0])*(point[2]-c[2]))/denominator;
        if(u>=-1e-8 && v>=-1e-8 && u+v<=1+1e-8) {point[1]=a[1]*u+b[1]*v+c[1]*(1-u-v);break;}
      }
    }
    for(const p of polygons) for(let j=1;j<p.length-1;j++) {
      const a=new THREE.Vector3(...p[0].slice(0,3)),b=new THREE.Vector3(...p[j].slice(0,3)),c=new THREE.Vector3(...p[j+1].slice(0,3));
      if(b.sub(a).cross(c.sub(a)).length()<1e-8) continue;
      metadata.push(geometry.userData.surfaceRoads?.[i/3] ?? null);
      for(const point of [p[0],p[j],p[j+1]]) {
        let offset=0;
        for(const [name,a] of attributes) { outputs[name].push(...point.slice(offset,offset+a.itemSize)); offset+=a.itemSize; }
      }
    }
  }
  const result=new THREE.BufferGeometry();
  for(const [name,a] of attributes) result.setAttribute(name,new THREE.Float32BufferAttribute(outputs[name],a.itemSize));
  result.userData.surfaceRoads=metadata;
  return result;
}
