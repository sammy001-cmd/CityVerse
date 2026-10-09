import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export class RoadCollider {
  constructor({
    physics,
    friction = 1.15
  }) {
    this.physics = physics;
    this.world = physics.world;
    this.friction = friction;
    this.tiles = new Map();
  }

  geometryToCollider(
    geometry,
    matrixWorld = null
  ) {
    const position =
      geometry.getAttribute(
        'position'
      );

    if (
      !position ||
      position.count < 3
    ) {
      return null;
    }

    const vertices =
      new Float32Array(
        position.count * 3
      );

    const point =
      new THREE.Vector3();

    for (
      let i = 0;
      i < position.count;
      i++
    ) {
      point.fromBufferAttribute(
        position,
        i
      );

      if (matrixWorld) {
        point.applyMatrix4(
          matrixWorld
        );
      }

      vertices[i * 3] =
        point.x;

      vertices[i * 3 + 1] =
        point.y;

      vertices[i * 3 + 2] =
        point.z;
    }

    let indices;

    if (geometry.index) {
      indices =
        Uint32Array.from(
          geometry.index.array
        );
    } else {
      indices =
        new Uint32Array(
          position.count
        );

      for (
        let i = 0;
        i < position.count;
        i++
      ) {
        indices[i] = i;
      }
    }

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

    return colliders.length;
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
