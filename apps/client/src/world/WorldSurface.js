import * as THREE from 'three';

const NORMAL_SAMPLE_DISTANCE = 0.5;

export class WorldSurface {
  constructor({
    terrain,
    terrainMesh = null,
    roadSurface = null
  }) {
    this.terrain = terrain;
    this.terrainMesh = terrainMesh;
    this.roadSurface = roadSurface;
    this.terrainPosition = new THREE.Vector3();
    this.terrainScale = new THREE.Vector3();
  }

  setTerrainMesh(terrainMesh) {
    this.terrainMesh = terrainMesh;
    terrainMesh.updateMatrixWorld(true);
  }

  setRoadSurface(roadSurface) {
    this.roadSurface = roadSurface;
  }

  terrainHeightAt(x, z) {
    const mesh = this.terrainMesh;

    if (!mesh) {
      return this.terrain?.heightAt(x, z) ?? 0;
    }

    mesh.updateMatrixWorld(true);
    mesh.getWorldPosition(this.terrainPosition);
    mesh.getWorldScale(this.terrainScale);

    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const { width, height, widthSegments, heightSegments } =
      geometry.parameters;

    if (
      !position ||
      !widthSegments ||
      !heightSegments ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      throw new Error(
        'Terrain mesh must use a regular segmented plane geometry.'
      );
    }

    const localX =
      (x - this.terrainPosition.x) /
      this.terrainScale.x;
    const localZ =
      (z - this.terrainPosition.z) /
      this.terrainScale.z;
    const stepX =
      width / widthSegments;
    const stepZ =
      height / heightSegments;
    const gridX = THREE.MathUtils.clamp(
      (localX + width / 2) / stepX,
      0,
      widthSegments
    );
    const gridZ = THREE.MathUtils.clamp(
      (localZ + height / 2) / stepZ,
      0,
      heightSegments
    );
    const x0 = Math.min(
      Math.floor(gridX),
      widthSegments - 1
    );
    const z0 = Math.min(
      Math.floor(gridZ),
      heightSegments - 1
    );
    const tx = gridX - x0;
    const tz = gridZ - z0;
    const rowLength = widthSegments + 1;
    const a = position.getY(z0 * rowLength + x0);
    const b = position.getY(z0 * rowLength + x0 + 1);
    const c = position.getY((z0 + 1) * rowLength + x0);
    const d = position.getY((z0 + 1) * rowLength + x0 + 1);
    const localHeight = tx >= tz
      ? a * (1 - tx) + b * (tx - tz) + d * tz
      : a * (1 - tz) + d * tx + c * (tz - tx);

    return this.terrainPosition.y +
      localHeight * this.terrainScale.y;
  }

  heightAt(x, z) {
    const road = this.roadSurface?.sample(x, z);

    if (
      (road?.onRoad || road?.onShoulder) &&
      Number.isFinite(road.height)
    ) {
      return road.height;
    }

    return this.terrainHeightAt(x, z);
  }

  sample(x, z) {
    const road = this.roadSurface?.sample(x, z);
    const onRoad = road?.onRoad && Number.isFinite(road.height);
    const onShoulder = road?.onShoulder && Number.isFinite(road.height);
    const height = onRoad || onShoulder
      ? road.height
      : this.terrainHeightAt(x, z);
    const distance = NORMAL_SAMPLE_DISTANCE;
    const dx = (
      this.heightAt(x + distance, z) -
      this.heightAt(x - distance, z)
    ) / (2 * distance);
    const dz = (
      this.heightAt(x, z + distance) -
      this.heightAt(x, z - distance)
    ) / (2 * distance);
    const normalLength = Math.hypot(dx, 1, dz);

    return {
      height,
      normal: {
        x: -dx / normalLength,
        y: 1 / normalLength,
        z: -dz / normalLength
      },
      surface: onRoad
        ? 'road'
        : onShoulder
          ? 'shoulder'
          : 'terrain',
      roadId: onRoad || onShoulder
        ? road.roadId
        : null,
      roadType: onRoad || onShoulder
        ? road.roadType
        : null
    };
  }
}
