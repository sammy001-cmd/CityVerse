import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export function colliderMeshData(geometry, matrixWorld = null) {
  const position = geometry.getAttribute('position');
  if (!position || position.count < 3) return null;
  const vertices = new Float32Array(position.count * 3);
  const point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i);
    if (matrixWorld) point.applyMatrix4(matrixWorld);
    vertices[i*3] = point.x;
    vertices[i*3+1] = point.y;
    vertices[i*3+2] = point.z;
  }
  const indices = geometry.index
    ? Uint32Array.from(geometry.index.array)
    : Uint32Array.from({ length: position.count }, (_, i) => i);
  return { vertices, indices };
}

export class RoadCollider {
  constructor({
    physics,
    friction = 1.15
  }) {
    this.physics = physics;
    this.world = physics.world;
    this.friction = friction;
    this.tiles = new Map();
    this.installMs=0;
  }

  geometryToCollider(
    geometry,
    matrixWorld = null
  ) {
    const data = colliderMeshData(geometry, matrixWorld);
    if (!data) return null;
    const { vertices, indices } = data;

    const descriptor =
      RAPIER.ColliderDesc
        .trimesh(
          vertices,
          indices,
          RAPIER.TriMeshFlags
            .FIX_INTERNAL_EDGES
        )
        .setFriction(
          this.friction
        );

    return this.world.createCollider(
      descriptor
    );
  }

  addTile(
    tileKey,
    group
  ) {
    const started=performance.now();
    this.removeTile(
      tileKey
    );

    group.updateMatrixWorld(
      true
    );

    const colliders = [];

    group.traverse((object) => {
      if (
        !object.isMesh ||
        !object.geometry ||
        !object.userData
          ?.roadCollision
      ) {
        return;
      }

      const collider =
        this.geometryToCollider(
          object.geometry,
          object.matrixWorld
        );

      if (collider) {
        colliders.push(collider);
      }
    });

    this.tiles.set(
      tileKey,
      colliders
    );

    this.installMs+=performance.now()-started;
    return colliders.length;
  }

  raycastHeight(x, z, fromY, maxDistance = 100) {
    const handles = new Set([...this.tiles.values()].flat().map(collider => collider.handle));
    if (!handles.size) return null;
    const hit = this.world.castRayAndGetNormal(
      new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }),
      maxDistance, true, undefined, undefined, undefined, undefined,
      collider => handles.has(collider.handle)
    );
    if (!hit) return null;
    return {
      height: fromY - hit.timeOfImpact,
      colliderHandle: hit.collider.handle,
      triangleId: hit.featureId ?? null,
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z }
    };
  }

  removeTile(
    tileKey
  ) {
    const colliders =
      this.tiles.get(
        tileKey
      );

    if (!colliders) return;

    for (const collider of colliders) {
      this.world.removeCollider(
        collider,
        true
      );
    }

    this.tiles.delete(
      tileKey
    );
  }

  clear() {
    for (const key of [...this.tiles.keys()]) {
      this.removeTile(key);
    }
  }
}
