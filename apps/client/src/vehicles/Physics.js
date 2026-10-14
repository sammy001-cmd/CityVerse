import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
const STEP=1/60;
// ---------- Physics world ----------
export class Physics {
  static async create() {
    await RAPIER.init();
    return new Physics();
  }

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;
    this.vehicles = [];
    this.acc = 0;
    this.terrainCollider = null;
  }

  addTerrainMesh(mesh) {
    if (this.terrainCollider) {
      return this.terrainCollider;
    }

    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');

    if (!position) {
      throw new Error('Terrain mesh has no position attribute.');
    }

    mesh.updateMatrixWorld(true);

    const vertices = new Float32Array(position.count * 3);
    const point = new THREE.Vector3();

    for (let i = 0; i < position.count; i++) {
      point
        .fromBufferAttribute(position, i)
        .applyMatrix4(mesh.matrixWorld);

      vertices[i * 3] = point.x;
      vertices[i * 3 + 1] = point.y;
      vertices[i * 3 + 2] = point.z;
    }

    let indices;

    if (geometry.index) {
      indices = Uint32Array.from(geometry.index.array);
    } else {
      indices = new Uint32Array(position.count);

      for (let i = 0; i < position.count; i++) {
        indices[i] = i;
      }
    }

    const descriptor = RAPIER.ColliderDesc
      .trimesh(
        vertices,
        indices,
        RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES
      )
      .setFriction(1);

    this.terrainCollider = this.world.createCollider(descriptor);
    return this.terrainCollider;
  }

  // footprints: [{ pts: [[x,z],...], h, baseY }]  -> one convex collider per building
  addBuildings(footprints) {
    let n = 0;
    for (const f of footprints) {
      const v = new Float32Array(f.pts.length * 6);
      f.pts.forEach(([x, z], i) => {
        v.set([x, f.baseY, z], i * 6);
        v.set([x, f.baseY + f.h, z], i * 6 + 3);
      });
      const desc = RAPIER.ColliderDesc.convexHull(v);
      if (!desc) continue;
      this.world.createCollider(desc.setFriction(0.4));
      n++;
    }
    return n;
  }

  // fixed 60 Hz stepping, independent of frame rate
  createStreetCollider(p){
    const angle=p.angle??0,c=Math.cos(angle),s=Math.sin(angle),rotation={x:0,y:Math.sin(angle/2),z:0,w:Math.cos(angle/2)};
    const install=(shape,x,y,z)=>this.world.createCollider(shape.setTranslation(p.x+c*x+s*z,p.y+y,p.z-s*x+c*z).setRotation(rotation).setFriction(0.8));
    // An open shelter stays walkable: roof, posts and seat share the visible dimensions.
    if(p.kind==='shelter')return [install(RAPIER.ColliderDesc.cuboid(1.75,0.075,1),0,2.7,0),
      ...[-1.5,1.5].map(x=>install(RAPIER.ColliderDesc.cuboid(0.06,1.35,0.06),x,1.35,-0.7)),
      install(RAPIER.ColliderDesc.cuboid(1.25,0.075,0.3),0,0.5,0)];
    const height=p.kind==='pole'?8:p.kind==='light'?6.5:p.kind==='bollard'?0.8:p.kind==='barrier'?1.05:p.kind==='gate'?1.4:p.height;
    const shape=['pole','light','bollard'].includes(p.kind)?RAPIER.ColliderDesc.cylinder(height/2,p.kind==='bollard'?0.085:p.kind==='light'?0.1:0.16):p.kind==='wall'?RAPIER.ColliderDesc.cuboid(0.08,height/2,p.length/2):RAPIER.ColliderDesc.cuboid(p.kind==='gate'?1.2:0.75,height/2,p.kind==='gate'?0.08:0.09);
    return install(shape,0,height/2,0);
  }
  step(dt) {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 3) {
      for (const v of this.vehicles) v.ctrl.updateVehicle(STEP);
      this.world.step();
      this.acc -= STEP;
      steps++;
    }
    if (this.acc > STEP) this.acc = 0;
  }
}

