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
    if(polygonArea(t)>1e-8) cutters.push({points:t,minX:Math.min(...t.map(p=>p[0])),maxX:Math.max(...t.map(p=>p[0])),
      minZ:Math.min(...t.map(p=>p[2])),maxZ:Math.max(...t.map(p=>p[2]))});
  }
  // Aprons are spatially local. Index their triangles so road triangles only
  // test nearby cutters instead of scanning every junction in the tile.
  const cellSize=8,cells=new Map(),cellKey=(x,z)=>`${x}_${z}`;
  for(let id=0;id<cutters.length;id++){
    const t=cutters[id],minX=Math.floor(t.minX/cellSize),maxX=Math.floor(t.maxX/cellSize),
      minZ=Math.floor(t.minZ/cellSize),maxZ=Math.floor(t.maxZ/cellSize);
    for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){
      const key=cellKey(x,z);if(!cells.has(key))cells.set(key,[]);cells.get(key).push(id);
    }
  }
  for(let i=0;i<position.count;i+=3) {
    const x0=position.getX(i),x1=position.getX(i+1),x2=position.getX(i+2),
      z0=position.getZ(i),z1=position.getZ(i+1),z2=position.getZ(i+2),
      minX=Math.min(x0,x1,x2),maxX=Math.max(x0,x1,x2),minZ=Math.min(z0,z1,z2),maxZ=Math.max(z0,z1,z2);
    const candidates=new Set();
    for(let x=Math.floor(minX/cellSize);x<=Math.floor(maxX/cellSize);x++)for(let z=Math.floor(minZ/cellSize);z<=Math.floor(maxZ/cellSize);z++)
      for(const id of cells.get(cellKey(x,z))??[])candidates.add(id);
    const intersecting=[...candidates].filter(id=>{const c=cutters[id];return c.maxX>=minX&&c.minX<=maxX&&c.maxZ>=minZ&&c.minZ<=maxZ;}).sort((a,b)=>a-b);
    if(!intersecting.length){
      for(const [name,attribute] of attributes)for(let j=0;j<3*attribute.itemSize;j++)outputs[name].push(attribute.array[i*attribute.itemSize+j]);
      metadata.push(geometry.userData.surfaceRoads?.[i/3]??null);continue;
    }
    let polygons=[[0,1,2].map(j=>attributes.flatMap(([,a])=>Array.from({length:a.itemSize},(_,k)=>a.array[(i+j)*a.itemSize+k])))];
    const source=polygons[0],degenerate=polygonArea(source)<1e-8;
    for(const id of intersecting) {
      const cutter=cutters[id];
      polygons=polygons.flatMap((p) => subtractTriangle(p,cutter.points,degenerate));
      if(!polygons.length) break;
    }
    // Stitch newly clipped boundary vertices to the apron, not to the former
    // independently smoothed strip. This removes vertical cracks at joins.
    for(const p of polygons) for(const point of p) {
      const nearby=cells.get(cellKey(Math.floor(point[0]/cellSize),Math.floor(point[2]/cellSize)))??[];
      for(const id of nearby) {
        const t=cutters[id].points;
        const [a,b,c]=t;
        const denominator=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
        const u=((b[2]-c[2])*(point[0]-c[0])+(c[0]-b[0])*(point[2]-c[2]))/denominator;
        const v=((c[2]-a[2])*(point[0]-c[0])+(a[0]-c[0])*(point[2]-c[2]))/denominator;
        if(u>=-1e-8 && v>=-1e-8 && u+v<=1+1e-8) {point[1]=a[1]*u+b[1]*v+c[1]*(1-u-v);break;}
      }
    }
    for(const p of polygons) for(let j=1;j<p.length-1;j++) {
      const a=p[0],b=p[j],c=p[j+1],ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
      const cx=uy*vz-uz*vy,cy=uz*vx-ux*vz,cz=ux*vy-uy*vx;if(cx*cx+cy*cy+cz*cz<1e-16)continue;
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
