import * as THREE from 'three';
import { RenderedRoadSurface } from './RenderedRoadSurface.js';
import { clipHalfPlane, subtractTriangle, polygonArea } from './SurfaceClip.js';

// The immutable elevation mesh remains the source of engineered profiles.
// Visible terrain and its collider share these exact clipped tile geometries.
export class RoadTerrainBlend {
  constructor({ terrainMesh, scene, surface, tileSize=250 }) {
    Object.assign(this,{terrainMesh,scene,surface,tileSize});
    this.base=new Map(); this.tiles=new Map(); this.dirty=new Set();
    this.query=new RenderedRoadSurface(); this.colliders=null;
    this.rebuilds=0; this.lastBuildMs=0;
    terrainMesh.updateMatrixWorld(true);
    const geometry=terrainMesh.geometry,position=geometry.getAttribute('position');
    const uv=geometry.getAttribute('uv'),normal=geometry.getAttribute('normal');
    const count=geometry.index?.count ?? position.count;
    const point=new THREE.Vector3(),direction=new THREE.Vector3();
    const normalMatrix=new THREE.Matrix3().getNormalMatrix(terrainMesh.matrixWorld);
    for (let i=0;i<count;i+=3) {
      const triangle=[];
      for (let j=0;j<3;j++) {
        const index=geometry.index ? geometry.index.getX(i+j) : i+j;
        point.fromBufferAttribute(position,index).applyMatrix4(terrainMesh.matrixWorld);
        direction.fromBufferAttribute(normal,index).applyMatrix3(normalMatrix).normalize();
        triangle.push([point.x,point.y,point.z,uv.getX(index),uv.getY(index),direction.x,direction.y,direction.z]);
      }
      const minX=Math.floor(Math.min(...triangle.map((p) => p[0]))/tileSize);
      const maxX=Math.floor(Math.max(...triangle.map((p) => p[0]))/tileSize);
      const minZ=Math.floor(Math.min(...triangle.map((p) => p[2]))/tileSize);
      const maxZ=Math.floor(Math.max(...triangle.map((p) => p[2]))/tileSize);
      for (let x=minX;x<=maxX;x++) for (let z=minZ;z<=maxZ;z++) {
        const x0=x*tileSize,z0=z*tileSize;
        let polygon=triangle;
        for (const [a,b] of [[[x0,0,z0],[x0+tileSize,0,z0]],[[x0+tileSize,0,z0],[x0+tileSize,0,z0+tileSize]],
          [[x0+tileSize,0,z0+tileSize],[x0,0,z0+tileSize]],[[x0,0,z0+tileSize],[x0,0,z0]]]) polygon=clipHalfPlane(polygon,a,b);
        if (polygon.length<3 || polygonArea(polygon)<1e-8) continue;
        const key=`${x}_${z}`;
        if (!this.base.has(key)) this.base.set(key,[]);
        this.base.get(key).push(polygon);
      }
    }
    // Do not hide the original until replacements exist.
    for (const key of this.base.keys()) this.dirty.add(key);
    this.flush(); terrainMesh.visible=false; surface.terrainMasked=true;
  }

  markRoadTile(key) {
    for (const t of this.surface.rendered.tiles.get(key) ?? []) {
      const minX=Math.floor(Math.min(t.ax,t.bx,t.cx)/this.tileSize),maxX=Math.floor(Math.max(t.ax,t.bx,t.cx)/this.tileSize);
      const minZ=Math.floor(Math.min(t.az,t.bz,t.cz)/this.tileSize),maxZ=Math.floor(Math.max(t.az,t.bz,t.cz)/this.tileSize);
      for (let x=minX;x<=maxX;x++) for (let z=minZ;z<=maxZ;z++) {
        const tile=`${x}_${z}`; if (this.base.has(tile)) this.dirty.add(tile);
      }
    }
  }

  sample(x,z) { return this.query.sample(x,z); }

  flush() {
    if (!this.dirty.size) return;
    const started=performance.now();
    for (const key of this.dirty) this.rebuild(key);
    this.dirty.clear(); this.lastBuildMs=performance.now()-started;
  }

  rebuild(key) {
    const positions=[],uvs=[],normals=[];
    const candidates=this.surface.rendered;
    for (const base of this.base.get(key)) {
      const minX=Math.min(...base.map((p) => p[0])),maxX=Math.max(...base.map((p) => p[0]));
      const minZ=Math.min(...base.map((p) => p[2])),maxZ=Math.max(...base.map((p) => p[2]));
      const nearby=new Set();
      for (let x=Math.floor(minX/candidates.cellSize);x<=Math.floor(maxX/candidates.cellSize);x++)
        for (let z=Math.floor(minZ/candidates.cellSize);z<=Math.floor(maxZ/candidates.cellSize);z++)
          for (const triangle of candidates.cells.get(`${x},${z}`) ?? []) nearby.add(triangle);
      let polygons=[base];
      for (const t of nearby) {
        if (Math.max(t.ax,t.bx,t.cx)<minX || Math.min(t.ax,t.bx,t.cx)>maxX ||
            Math.max(t.az,t.bz,t.cz)<minZ || Math.min(t.az,t.bz,t.cz)>maxZ) continue;
        const triangle=[[t.ax,t.ay,t.az],[t.bx,t.by,t.bz],[t.cx,t.cy,t.cz]];
        polygons=polygons.flatMap((polygon) => subtractTriangle(polygon,triangle)).filter((p) => polygonArea(p)>1e-8);
        if (!polygons.length) break;
      }
      for (const polygon of polygons) {
        const stitched=polygon.map((p) => {
          const road=this.surface.sampleRendered(p[0],p[2]);
          return road ? [p[0],road.height,p[2],...p.slice(3)] : p;
        });
        for (let i=1;i<stitched.length-1;i++) {
          if (polygonArea([stitched[0],stitched[i],stitched[i+1]])<1e-8) continue;
          // Terrain original winding faces upward; clipping keeps that winding.
          for (const p of [stitched[0],stitched[i],stitched[i+1]]) {
            positions.push(p[0],p[1],p[2]); uvs.push(p[3],p[4]); normals.push(p[5],p[6],p[7]);
          }
        }
      }
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
    this.installGeometry(key,geometry);
  }

  installGeometry(key,geometry) {
    const group=new THREE.Group(),mesh=new THREE.Mesh(geometry,this.terrainMesh.material);
    mesh.receiveShadow=true; mesh.userData.roadCollision=true; mesh.userData.surfaceType='terrain';
    group.name=`TerrainTile_${key}`; group.add(mesh);
    this.query.addTile(key,group);
    this.colliders?.addTile(key,group);
    const old=this.tiles.get(key);
    if (old) { this.scene.remove(old); old.children[0].geometry.dispose(); }
    this.scene.add(group); this.tiles.set(key,group); this.rebuilds++;
  }

  attachPhysics(physics,ColliderClass) {
    this.colliders?.clear();
    if (physics.terrainCollider) {
      physics.world.removeCollider(physics.terrainCollider,true); physics.terrainCollider=null;
    }
    this.colliders=new ColliderClass({physics,friction:1});
    for (const [key,group] of this.tiles) this.colliders.addTile(key,group);
  }

  destroy() {
    this.colliders?.clear();
    this.colliders?.physics.addTerrainMesh(this.terrainMesh);
    for (const group of this.tiles.values()) { this.scene.remove(group); group.children[0].geometry.dispose(); }
    this.query.cells.clear(); this.query.tiles.clear(); this.tiles.clear(); this.base.clear();
    this.terrainMesh.visible=true; this.surface.terrainMasked=false;
  }
}
