import * as THREE from 'three';

const MARKED_ROADS = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary'
]);

function createGeometry(positions, uvs) {
  if (!positions.length) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

function pushQuad(positions, uvs, a, b, c, d, length = 1) {
  positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  uvs.push(0, 0, 1, 0, 1, length, 0, 0, 1, length, 0, length);
}

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

  roadHeight(x, z, ux, uz) {
    let sum = 0;
    for (const offset of [-8, -4, 0, 4, 8]) {
      sum += this.groundY(x + ux * offset, z + uz * offset);
    }
    return sum / 5;
  }

  buildStrip(segments, extraWidth, yOffset) {
    const positions = [];
    const uvs = [];

    for (const road of segments) {
      const [[ax, az], [bx, bz]] = [road.a, road.b];
      const dx = bx - ax;
      const dz = bz - az;
      const length = Math.hypot(dx, dz);
      if (length < 0.05) continue;

      const ux = dx / length;
      const uz = dz / length;
      const nx = -uz;
      const nz = ux;
      const half = (road.width + extraWidth) / 2;
      const yA = this.roadHeight(ax, az, ux, uz) + yOffset;
      const yB = this.roadHeight(bx, bz, ux, uz) + yOffset;

      pushQuad(
        positions,
        uvs,
        [ax + nx * half, yA, az + nz * half],
        [ax - nx * half, yA, az - nz * half],
        [bx - nx * half, yB, bz - nz * half],
        [bx + nx * half, yB, bz + nz * half],
        length / 4
      );
    }

    return createGeometry(positions, uvs);
  }

  buildMarkings(segments) {
    const positions = [];
    const uvs = [];

    for (const road of segments) {
      if (!MARKED_ROADS.has(road.type) || road.seq % 2 !== 0) continue;

      const [[ax, az], [bx, bz]] = [road.a, road.b];
      const dx = bx - ax;
      const dz = bz - az;
      const length = Math.hypot(dx, dz);
      if (length < 1) continue;

      const ux = dx / length;
      const uz = dz / length;
      const nx = -uz;
      const nz = ux;
      const dashLength = Math.min(3.2, length * 0.7);
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      const sx = mx - ux * dashLength / 2;
      const sz = mz - uz * dashLength / 2;
      const ex = mx + ux * dashLength / 2;
      const ez = mz + uz * dashLength / 2;
      const half = 0.075;
      const y0 = this.roadHeight(sx, sz, ux, uz) + 0.075;
      const y1 = this.roadHeight(ex, ez, ux, uz) + 0.075;

      pushQuad(
        positions,
        uvs,
        [sx + nx * half, y0, sz + nz * half],
        [sx - nx * half, y0, sz - nz * half],
        [ex - nx * half, y1, ez - nz * half],
        [ex + nx * half, y1, ez + nz * half],
        dashLength
      );
    }

    return createGeometry(positions, uvs);
  }

  buildTile(data) {
    if (!Array.isArray(data.roads) || !Array.isArray(data.junctions)) {
      throw new Error(`Road tile ${data.tx}_${data.tz} is malformed.`);
    }

    const group = new THREE.Group();
    group.name = `RoadTile_${data.tx}_${data.tz}`;

    const shoulderGeometry = this.buildStrip(data.roads, 1.4, 0.025);
    if (shoulderGeometry) {
      const shoulders = new THREE.Mesh(shoulderGeometry, this.shoulderMaterial);
      shoulders.receiveShadow = true;
      group.add(shoulders);
    }

    const roadGeometry = this.buildStrip(data.roads, 0, 0.055);
    if (roadGeometry) {
      const road = new THREE.Mesh(roadGeometry, this.roadMaterial);
      road.receiveShadow = true;
      group.add(road);
    }

    const markingGeometry = this.buildMarkings(data.roads);
    if (markingGeometry) group.add(new THREE.Mesh(markingGeometry, this.markingMaterial));

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

    const wanted = new Set();
    const jobs = [];
    for (let dx = -this.loadRadius; dx <= this.loadRadius; dx++) {
      for (let dz = -this.loadRadius; dz <= this.loadRadius; dz++) {
        const key = `${tx + dx}_${tz + dz}`;
        if (!this.available.has(key)) continue;
        wanted.add(key);
        jobs.push(this.loadTile(tx + dx, tz + dz));
      }
    }
    this.desired = wanted;

    for (const key of this.loaded.keys()) {
      if (!wanted.has(key)) this.unloadTile(key);
    }

    return Promise.all(jobs);
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
