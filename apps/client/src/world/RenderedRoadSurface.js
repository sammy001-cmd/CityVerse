import * as THREE from 'three';

// Spatially indexed copies of the same world triangles used by rendering and
// RoadCollider. No raycaster/scene traversal is needed during gameplay queries.
export class RenderedRoadSurface {
  constructor(cellSize = 32) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.tiles = new Map();
    this.queryRay=new THREE.Ray(new THREE.Vector3(),new THREE.Vector3(0,-1,0));
    this.queryA=new THREE.Vector3();this.queryB=new THREE.Vector3();this.queryC=new THREE.Vector3();this.queryHit=new THREE.Vector3();
  }

  addTile(key, group) {
    this.removeTile(key);
    group.updateMatrixWorld(true);
    const entries = [];
    const points = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    let triangleId = 0;
    group.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.userData.roadCollision) return;
      const geometry = mesh.geometry, position = geometry.getAttribute('position');
      const count = geometry.index?.count ?? position.count;
      for (let i = 0; i < count; i += 3) {
        for (let j = 0; j < 3; j++) points[j].fromBufferAttribute(position, geometry.index ? geometry.index.getX(i+j) : i+j).applyMatrix4(mesh.matrixWorld);
        const [a,b,c] = points;
        const denominator = (b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
        if (Math.abs(denominator) < 1e-10) continue;
        const part=mesh.userData.part;
        const surface=part==='shoulders'?'shoulder':part==='curbs'?'curb':part==='sidewalks'?'sidewalk':part==='blend'?'terrain':mesh.userData.surfaceType??'road';
        const triangle = { ax:a.x, ay:a.y, az:a.z, bx:b.x, by:b.y, bz:b.z,
          cx:c.x, cy:c.y, cz:c.z, denominator, surface,
          tileKey:key, triangleId:triangleId++,
          road:geometry.userData.surfaceRoads?.[i/3]?.road ?? geometry.userData.surfaceRoads?.[i/3] ?? null,
          onShoulder:surface==='shoulder',cells:[] };
        const minX = Math.floor(Math.min(a.x,b.x,c.x)/this.cellSize);
        const maxX = Math.floor(Math.max(a.x,b.x,c.x)/this.cellSize);
        const minZ = Math.floor(Math.min(a.z,b.z,c.z)/this.cellSize);
        const maxZ = Math.floor(Math.max(a.z,b.z,c.z)/this.cellSize);
        for (let x=minX; x<=maxX; x++) for (let z=minZ; z<=maxZ; z++) {
          const cell = `${x},${z}`;
          if (!this.cells.has(cell)) this.cells.set(cell,new Set());
          this.cells.get(cell).add(triangle); triangle.cells.push(cell);
        }
        entries.push(triangle);
      }
    });
    this.tiles.set(key,entries);
  }

  removeTile(key) {
    for (const triangle of this.tiles.get(key) ?? []) for (const cell of triangle.cells) {
      const entries = this.cells.get(cell); entries.delete(triangle);
      if (!entries.size) this.cells.delete(cell);
    }
    this.tiles.delete(key);
  }

  sample(x,z) {
    let best = null;
    const candidates = this.cells.get(`${Math.floor(x/this.cellSize)},${Math.floor(z/this.cellSize)}`);
    if (!candidates) return null;
    for (const t of candidates) {
      const a=((t.bz-t.cz)*(x-t.cx)+(t.cx-t.bx)*(z-t.cz))/t.denominator;
      const b=((t.cz-t.az)*(x-t.cx)+(t.ax-t.cx)*(z-t.cz))/t.denominator,c=1-a-b;
      if(a< -1e-9||b< -1e-9||c< -1e-9)continue;
      let height=a*t.ay+b*t.by+c*t.cy;
      // Resolve only edge samples with Three's exact ray/triangle predicate.
      // The fast barycentric path can otherwise include a float-rounded sliver
      // that the renderer and Rapier treat as outside.
      if(Math.min(a,b,c)<1e-5){
        this.queryRay.origin.set(x,1e6,z);
        this.queryA.set(t.ax,t.ay,t.az);this.queryB.set(t.bx,t.by,t.bz);this.queryC.set(t.cx,t.cy,t.cz);
        const hit=this.queryRay.intersectTriangle(this.queryA,this.queryB,this.queryC,false,this.queryHit);
        if(!hit)continue;height=hit.y;
      }
      if (!best || height > best.height + 1e-7 ||
          (Math.abs(height-best.height) <= 1e-7 && t.surface==='road' && best.onShoulder)) best = { height, onRoad:t.surface==='road',
        onShoulder:t.surface==='shoulder', surface:t.surface,
        roadId:t.road?.wayId ?? null, roadType:t.road?.type ?? null, width:t.road?.width ?? null,
        roadTile:t.tileKey ?? null, roadTriangleId:t.triangleId ?? null };
    }
    return best;
  }
}
