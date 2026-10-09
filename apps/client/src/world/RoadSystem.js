import * as THREE from 'three';
import {
  RoadSurface
} from './RoadSurface.js';
import { RoadGeometry } from './RoadGeometry.js';

export class RoadSystem {
  constructor({
    scene,
    groundY,
    roadMaterial,
    shoulderMaterial,
    markingMaterial,
    baseUrl = '/data/road-tiles',
    loadRadius = 2
  }) {
    this.scene = scene;
    this.groundY = groundY;

    this.surface = new RoadSurface({
      terrainY: groundY,
      shoulderWidth: 0.7,
      roadOffset: 0.055
    });
    this.roadGeometry = new RoadGeometry({
      surface: this.surface,
      shoulderWidth: 0.7,
      roadOffset: 0.055
    });
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.loadRadius = loadRadius;
    this.manifest = null;
    this.tileSize = 250;
    this.available = new Set();
    this.loaded = new Map();
    this.loading = new Map();
    this.desired = new Set();
    this.lastTile = null;
    this.roadMaterial = roadMaterial ?? new THREE.MeshStandardMaterial({
      color: 0x34383d,
      roughness: 0.92,
      side: THREE.DoubleSide
    });
    this.shoulderMaterial = shoulderMaterial ?? new THREE.MeshStandardMaterial({
      color: 0x8c8172,
      roughness: 0.95,
      side: THREE.DoubleSide
    });
    this.markingMaterial = markingMaterial ?? new THREE.MeshStandardMaterial({
      color: 0xe7dfbd,
      roughness: 0.85,
      side: THREE.DoubleSide
    });
  }

  async init() {
    const response = await fetch(`${this.baseUrl}/manifest.json`);
    if (!response.ok) {
      throw new Error(`Road manifest request failed (${response.status}). Run: node pipeline/world/build-road-tiles.mjs`);
    }

    const manifest = await response.json();
    if (!Array.isArray(manifest.tiles) || !Number.isFinite(manifest.tileSize)) {
      throw new Error('Road manifest is malformed; rebuild the road tiles.');
    }

    this.manifest = manifest;
    this.tileSize = manifest.tileSize;
    this.available = new Set(manifest.tiles);
    console.log('Production road system:', manifest.stats);
    return this;
  }

  tileFor(x, z) {
    return [Math.floor(x / this.tileSize), Math.floor(z / this.tileSize)];
  }

  buildTile(data) {
    if (!Array.isArray(data.roads) || !Array.isArray(data.junctions)) {
      throw new Error(`Road tile ${data.tx}_${data.tz} is malformed.`);
    }

    const group = new THREE.Group();
    group.name = `RoadTile_${data.tx}_${data.tz}`;

    const roadMeshes =
      this.roadGeometry.build(
        data.roads
      );

    if (roadMeshes.shoulders) {
      const shoulders = new THREE.Mesh(roadMeshes.shoulders, this.shoulderMaterial);
      shoulders.receiveShadow = true;
      group.add(shoulders);
    }

    if (roadMeshes.asphalt) {
      const road = new THREE.Mesh(roadMeshes.asphalt, this.roadMaterial);
      road.receiveShadow = true;
      group.add(road);
    }

    if (roadMeshes.markings) {
      group.add(
        new THREE.Mesh(
          roadMeshes.markings,
          this.markingMaterial
        )
      );
    }

    if (data.junctions.length) {
      const geometry = new THREE.CircleGeometry(1, 20);
      geometry.rotateX(-Math.PI / 2);
      const mesh = new THREE.InstancedMesh(geometry, this.roadMaterial, data.junctions.length);
      const dummy = new THREE.Object3D();

      data.junctions.forEach((junction, index) => {
        dummy.position.set(
          junction.x,
          this.groundY(junction.x, junction.z) + 0.06,
          junction.z
        );
        dummy.scale.setScalar(junction.radius);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });

      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    return group;
  }

  async loadTile(tx, tz) {
    const key = `${tx}_${tz}`;
    if (this.loaded.has(key) || !this.available.has(key)) return;
    if (this.loading.has(key)) return this.loading.get(key);

    const task = (async () => {
      const response = await fetch(`${this.baseUrl}/${key}.json`);
      if (!response.ok) throw new Error(`Road tile ${key} request failed (${response.status}).`);
      const data = await response.json();



      if (!this.desired.has(key)) return;
      this.surface.addTile(
  key,
  data.roads
);
      const group = this.buildTile(data);
      this.scene.add(group);
      this.loaded.set(key, group);
    })();

    this.loading.set(key, task);
    try {
      await task;
    } finally {
      this.loading.delete(key);
    }
  }

  unloadTile(key) {
    const group = this.loaded.get(key);
    if (!group) return;

    this.surface.removeTile(
      key
    );

    group.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
    });
    this.scene.remove(group);
    this.loaded.delete(key);
  }

  update(x, z) {
    const [tx, tz] = this.tileFor(x, z);
    const currentKey = `${tx}_${tz}`;
    if (currentKey === this.lastTile) return;
    this.lastTile = currentKey;

    const wanted =
      new Set();

    for (
      let dx =
        -this.loadRadius;

      dx <=
        this.loadRadius;

      dx++
    ) {
      for (
        let dz =
          -this.loadRadius;

        dz <=
          this.loadRadius;

        dz++
      ) {
        const key = `${tx + dx}_${tz + dz}`;

        if (
          this.available.has(
            key
          )
        ) {
          wanted.add(
            key
          );
        }
      }
    }

    this.desired =
      wanted;

    const jobs =
      [];

    for (
      const key
      of wanted
    ) {
      const [
        tileX,
        tileZ
      ] =
        key
          .split('_')
          .map(Number);

      jobs.push(
        this.loadTile(
          tileX,
          tileZ
        )
      );
    }

    for (const key of this.loaded.keys()) {
      if (!wanted.has(key)) this.unloadTile(key);
    }

    return Promise.all(
      jobs
    );
  }

  sampleSurface(
    x,
    z
  ) {
    return this.surface.sample(
      x,
      z
    );
  }

  getNearestSpawn(x = 0, z = 0) {
    const points = this.manifest?.spawnPoints ?? [];
    if (!points.length) throw new Error('Road manifest contains no spawn points.');

    let best = points[0];
    let bestDistance = Infinity;
    for (const point of points) {
      const distance = Math.hypot(point[0] - x, point[1] - z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = point;
      }
    }
    return best;
  }
}
