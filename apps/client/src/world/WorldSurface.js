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

  setTerrainBlend(blend) { this.terrainBlend = blend; }

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
    // PlaneGeometry indices are [top-left, bottom-left, top-right]
    // and [bottom-left, bottom-right, top-right], after the X rotation.
    const localHeight = tx + tz <= 1
      ? a * (1 - tx - tz) + b * tx + c * tz
      : b * (1 - tz) + c * (1 - tx) + d * (tx + tz - 1);

    return this.terrainPosition.y +
      localHeight * this.terrainScale.y;
  }

  heightAt(x, z) {
    return this.floorAt(x, z).height;
  }

  floorAt(x, z) {
    const terrainHeight = this.terrainHeightAt(x, z);
    const road = this.roadSurface?.sampleRendered
      ? this.roadSurface.sampleRendered(x, z)
      : this.roadSurface?.sample(x, z);
    // Terrain is currently an uncut mesh/collider. Only select a rendered
    // road/shoulder/junction when it actually covers and sits above terrain.
    // This preserves engineered geometry; it does not raise the road profile.
    if (road && Number.isFinite(road.height) &&
        (this.roadSurface?.terrainMasked || road.height >= terrainHeight)) {
      return { height: road.height, surface: road.surface ?? (road.onRoad ? 'road' : 'shoulder'),
        roadId: road.roadId ?? null, roadType: road.roadType ?? null };
    }
    return { height: this.terrainBlend?.sample(x,z)?.height ?? terrainHeight,
      surface: 'terrain', roadId: null, roadType: null };
  }

  sample(x, z) {
    const floor = this.floorAt(x, z);
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
      ...floor,
      normal: {
        x: -dx / normalLength,
        y: 1 / normalLength,
        z: -dz / normalLength
      }
    };
  }
}
