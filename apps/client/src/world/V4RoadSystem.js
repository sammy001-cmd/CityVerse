import * as THREE from 'three';
import { RenderedRoadSurface } from './RenderedRoadSurface.js';
import { RoadTerrainBlend } from './RoadTerrainBlend.js';
import { buildV4PolygonRoadTile } from './V4PolygonRoadTile.js';

const smoothstep = value => {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

function longitudinalHeight(terrainHeightAt, x, z, ux, uz) {
  let weighted = 0;
  for (const [distance, weight] of [
    [-12, 1], [-9, 1], [-6, 2], [-3, 2], [0, 3], [3, 2], [6, 2], [9, 1], [12, 1]
  ]) {
    const height = terrainHeightAt(x + ux * distance, z + uz * distance);
    if (!Number.isFinite(height)) throw new Error(`Invalid terrain height at ${x}, ${z}`);
    weighted += height * weight;
  }
  return weighted / 15;
}

export function createV4ElevationSampler(roads, terrainHeightAt) {
  const byNode = new Map();
  const seen = new Set();
  for (const road of roads) {
    const key = `${road.wayId}:${road.seq}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const dx = road.b[0] - road.a[0], dz = road.b[1] - road.a[1];
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    const ux = dx / length, uz = dz / length;
    for (const [node, point] of [[road.nodeA, road.a], [road.nodeB, road.b]]) {
      if (node == null) continue;
      if (!byNode.has(node)) byNode.set(node, []);
      byNode.get(node).push(longitudinalHeight(terrainHeightAt, point[0], point[1], ux, uz));
    }
  }
  const nodeHeights = new Map([...byNode].map(([node, values]) =>
    [node, values.reduce((sum, value) => sum + value, 0) / values.length]));

  return (x, z, feature) => {
    const ids = new Set(feature.ids ?? []);
    let nearest = null;
    for (const road of roads) {
      if (!ids.has(road.wayId)) continue;
      const dx = road.b[0] - road.a[0], dz = road.b[1] - road.a[1];
      const lengthSquared = dx * dx + dz * dz;
      if (lengthSquared < 1e-10) continue;
      const t = THREE.MathUtils.clamp(((x-road.a[0])*dx + (z-road.a[1])*dz) / lengthSquared, 0, 1);
      const cx = road.a[0] + dx * t, cz = road.a[1] + dz * t;
      const distanceSquared = (x-cx)**2 + (z-cz)**2;
      if (!nearest || distanceSquared < nearest.distanceSquared) {
        const length = Math.sqrt(lengthSquared);
        nearest = { road, dx, dz, length, t, cx, cz, distanceSquared };
      }
    }
    if (!nearest) return terrainHeightAt(x, z);

    const { road, dx, dz, length, t, cx, cz } = nearest;
    const ux = dx / length, uz = dz / length;
    let height = longitudinalHeight(terrainHeightAt, x, z, ux, uz);
    const endpoint = t < 0.5
      ? { node: road.nodeA, point: road.a, distance: t * length }
      : { node: road.nodeB, point: road.b, distance: (1-t) * length };
    const junctionHeight = endpoint.node == null ? null : nodeHeights.get(endpoint.node);
    if (junctionHeight !== undefined && junctionHeight !== null && endpoint.distance < 6) {
      height = junctionHeight * (1 - smoothstep(endpoint.distance / 6)) +
        height * smoothstep(endpoint.distance / 6);
    }
    const rawCenter = terrainHeightAt(cx, cz), rawVertex = terrainHeightAt(x, z);
    if (!Number.isFinite(rawCenter) || !Number.isFinite(rawVertex)) {
      throw new Error(`Invalid terrain height at road profile ${x}, ${z}`);
    }
    return height + THREE.MathUtils.clamp(rawVertex - rawCenter, -0.12, 0.12);
  };
}

export class V4RoadSystem {
  constructor({ scene, loadRadius = 2, lowPerformance = false, replaceTerrain = true, colliderDebug = false }) {
    Object.assign(this, { scene, loadRadius, lowPerformance, replaceTerrain, colliderDebug });
    this.baseUrl = '/__v4_road_preview';
    this.tileSize = 250;
    this.manifest = null;
    this.available = new Set();
    this.loaded = new Map();
    this.tileData = new Map();
    this.loading = new Map();
    this.desired = new Set();
    this.lastTile = null;
    this.generation = 0;
    this.retired = false;
    this.requestsStarted = 0;
    this.unloadedCount = 0;
    this.timings = {
      workerMs: 0, terrainClippingMs: 0, uploadMs: 0, colliderMs: 0,
      decodeMs: 0, geometryMs: 0, queryIndexMs: 0, terrainReplacementMs: 0
    };
    this.surface = {
      rendered: new RenderedRoadSurface(),
      terrainMasked: false,
      sampleRendered(x, z) { return this.rendered.sample(x, z); }
    };
    this.roadMaterial = new THREE.MeshStandardMaterial({
      color: 0x34383d, roughness: 0.94, side: THREE.DoubleSide
    });
    this.colliderWireMaterial = colliderDebug
      ? new THREE.LineBasicMaterial({ color: 0xff3344, depthTest: false, transparent: true, opacity: 0.9 })
      : null;
  }

  async init() {
    const response = await fetch(`${this.baseUrl}/manifest.json`);
    if (!response.ok) throw new Error(`V4 road manifest request failed (${response.status}).`);
    const started = performance.now();
    const manifest = await response.json();
    this.timings.decodeMs += performance.now() - started;
    if (manifest?.version !== 1 || manifest.build !== 'road-world-v4-polygon-subset' ||
        !Number.isFinite(manifest.tileSize) || !Array.isArray(manifest.tiles) ||
        !Array.isArray(manifest.spawnPoints) || !manifest.spawnPoints.length) {
      throw new Error('Malformed V4 road subset manifest; rebuild the representative subset.');
    }
    this.manifest = manifest;
    this.tileSize = manifest.tileSize;
    this.available = new Set(manifest.tiles);
    return this;
  }

  tileFor(x, z) {
    return [Math.floor(x / this.tileSize), Math.floor(z / this.tileSize)];
  }

  async loadTile(tx, tz) {
    const key = `${tx}_${tz}`;
    if (this.tileData.has(key) || !this.available.has(key)) return;
    if (this.loading.has(key)) return this.loading.get(key);
    const task = (async () => {
      this.requestsStarted++;
      const response = await fetch(`${this.baseUrl}/${key}.json`);
      if (!response.ok) throw new Error(`V4 road tile ${key} request failed (${response.status}).`);
      const text = await response.text();
      const started = performance.now();
      const data = JSON.parse(text);
      this.timings.decodeMs += performance.now() - started;
      if (data.version !== 1 || data.tx !== tx || data.tz !== tz ||
          !Array.isArray(data.features) || !Array.isArray(data.roads)) {
        throw new Error(`Malformed V4 road tile ${key}.`);
      }
      this.tileData.set(key, data);
    })();
    this.loading.set(key, task);
    try {
      await task;
    } finally {
      this.loading.delete(key);
    }
  }

  async attachTerrain(terrainMesh, worldSurface, { physics = null } = {}) {
    this.worldSurface = worldSurface;
    this.terrainMesh = terrainMesh;
    this.physics = physics;
    this.surface.terrainY = (x, z) => worldSurface.terrainHeightAt(x, z);
    if (!this.replaceTerrain) {
      this.surface.terrainMasked = false;
      worldSurface.setTerrainBlend(null);
      terrainMesh.visible = true;
      return this;
    }
    const started = performance.now();
    this.terrainBlend = await RoadTerrainBlend.createAsync({
      terrainMesh, scene: this.scene, surface: this.surface, tileSize: this.tileSize
    });
    worldSurface.setTerrainBlend(this.terrainBlend);
    this.timings.terrainReplacementMs += performance.now() - started;
  }

  attachColliderManager(colliderManager, { bounds = null } = {}) {
    this.colliderManager = colliderManager;
    for (const [key, group] of this.loaded) {
      const [x, z] = key.split('_').map(Number);
      if (bounds && ((x+1)*this.tileSize < bounds.minX || x*this.tileSize > bounds.maxX ||
          (z+1)*this.tileSize < bounds.minZ || z*this.tileSize > bounds.maxZ)) continue;
      colliderManager.addTile(key, group);
    }
    if (this.replaceTerrain) {
      this.terrainBlend?.attachPhysics(colliderManager.physics, colliderManager.constructor, { bounds });
    } else {
      this.worldSurface.setTerrainCollider(colliderManager.physics.addTerrainMesh(this.terrainMesh));
    }
  }

  installTile(key, data, worldSurface) {
    const profileHeightAt = this.replaceTerrain
      ? createV4ElevationSampler(data.roads, (x, z) => worldSurface.terrainHeightAt(x, z))
      : (x, z) => worldSurface.terrainHeightAt(x, z);
    const geometryStarted = performance.now();
    const built = buildV4PolygonRoadTile(data, { terrainHeightAt: profileHeightAt, material: this.roadMaterial });
    this.timings.geometryMs += performance.now() - geometryStarted;
    built.group.userData.polygonCount = built.polygonCount;
    if (this.colliderWireMaterial) {
      const roadMesh = built.group.children.find(object => object.isMesh && object.userData.roadCollision);
      if (roadMesh) {
        const outline = new THREE.LineSegments(new THREE.WireframeGeometry(roadMesh.geometry), this.colliderWireMaterial);
        outline.name = 'RoadV4ColliderWireframe';
        outline.renderOrder = 1000;
        outline.userData.debugOnly = true;
        built.group.add(outline);
      }
    }
    built.group.userData.roadEdges = data.roads.map(road => ({
      roadId: road.wayId, sequence: road.seq, type: road.type, width: road.width,
      widthSource: road.widthSource, a: road.a, b: road.b
    }));
    const queryStarted = performance.now();
    this.surface.rendered.addTile(key, built.group);
    this.timings.queryIndexMs += performance.now() - queryStarted;
    const uploadStarted = performance.now();
    this.scene.add(built.group);
    this.timings.uploadMs += performance.now() - uploadStarted;
    const colliderStarted = performance.now();
    this.colliderManager?.addTile(key, built.group);
    this.timings.colliderMs += performance.now() - colliderStarted;
    this.terrainBlend?.markRoadTile(key);
    const replacementStarted = performance.now();
    this.terrainBlend?.flush();
    this.timings.terrainReplacementMs += performance.now() - replacementStarted;
    this.loaded.set(key, built.group);
  }

  unloadTile(key) {
    const group = this.loaded.get(key);
    if (!group) return;
    this.terrainBlend?.markRoadTile(key);
    this.colliderManager?.removeTile(key);
    this.surface.rendered.removeTile(key);
    this.scene.remove(group);
    group.traverse(object => object.geometry?.dispose());
    this.loaded.delete(key);
    this.unloadedCount++;
    const started = performance.now();
    this.terrainBlend?.flush();
    this.timings.terrainReplacementMs += performance.now() - started;
  }

  async primeSpawn(x, z) {
    await this.update(x, z, { spawnOnly: true });
    this.lastTile = null;
  }

  async update(x, z, { spawnOnly = false } = {}) {
    if (this.retired) return;
    const [tx, tz] = this.tileFor(x, z), current = `${tx}_${tz}`;
    if (current === this.lastTile) return this.pending;
    this.lastTile = current;
    const generation = ++this.generation;
    const wanted = new Set();
    for (let dx = -this.loadRadius; dx <= this.loadRadius; dx++) {
      for (let dz = -this.loadRadius; dz <= this.loadRadius; dz++) {
        const key = `${tx+dx}_${tz+dz}`;
        if (spawnOnly && ((tx+dx+1)*this.tileSize < x-20 || (tx+dx)*this.tileSize > x+20 ||
            (tz+dz+1)*this.tileSize < z-20 || (tz+dz)*this.tileSize > z+20)) continue;
        if (this.available.has(key)) wanted.add(key);
      }
    }
    this.desired = wanted;
    this.pending = Promise.all([...wanted].map(key => {
      const [tileX, tileZ] = key.split('_').map(Number);
      return this.loadTile(tileX, tileZ);
    })).then(() => {
      if (this.retired || generation !== this.generation) return;
      for (const key of [...this.loaded.keys()]) if (!wanted.has(key)) this.unloadTile(key);
      for (const key of wanted) {
        if (!this.loaded.has(key)) this.installTile(key, this.tileData.get(key), this.worldSurface);
      }
    });
    return this.pending;
  }

  getRoadEdges(bounds = null) {
    const unique = new Map();
    for (const group of this.loaded.values()) {
      for (const edge of group.userData.roadEdges ?? []) {
        const key = `${edge.roadId}:${edge.sequence}`;
        if (unique.has(key)) continue;
        if (bounds && (Math.max(edge.a[0], edge.b[0]) + edge.width/2 < bounds.minX ||
            Math.min(edge.a[0], edge.b[0]) - edge.width/2 > bounds.maxX ||
            Math.max(edge.a[1], edge.b[1]) + edge.width/2 < bounds.minZ ||
            Math.min(edge.a[1], edge.b[1]) - edge.width/2 > bounds.maxZ)) continue;
        unique.set(key, edge);
      }
    }
    return [...unique.values()];
  }

  getNearestSpawn(x = 0, z = 0) {
    let best = null, bestDistance = Infinity;
    for (const point of this.manifest?.spawnPoints ?? []) {
      const distance = Math.hypot(point[0]-x, point[1]-z);
      if (distance < bestDistance) { best = point; bestDistance = distance; }
    }
    if (!best) throw new Error('V4 road subset manifest contains no spawn points.');
    return best;
  }

  getStats() {
    let triangles = 0, drawCalls = 0, roadTriangles = 0, polygons = 0;
    const queryIndexedTriangles = [...this.surface.rendered.tiles.values()]
      .reduce((sum, entries) => sum + entries.length, 0);
    const colliders = [...(this.colliderManager?.tiles.values() ?? [])]
      .reduce((sum, entries) => sum + entries.length, 0);
    for (const group of this.loaded.values()) {
      polygons += group.userData.polygonCount ?? 0;
      group.traverse(object => {
        if (!object.isMesh) return;
        const count = object.geometry.index?.count ?? object.geometry.attributes.position.count;
        triangles += count / 3;
        roadTriangles += count / 3;
        drawCalls++;
      });
    }
    return {
      tiles: this.loaded.size, segments: this.getRoadEdges().length, cachedTiles: this.tileData.size,
      availableTiles: this.available.size, requestedTiles: this.requestsStarted, unloadedTiles: this.unloadedCount,
      desiredTiles: this.desired.size, loadingTiles: this.loading.size,
      triangles, roadTriangles, junctionTriangles: 0, markingTriangles: 0, drawCalls, polygons,
      queryIndexedTriangles, roadColliders: colliders,
      terrainReplacementEnabled: this.replaceTerrain,
      workerMs: 0, roadGeometryMs: this.timings.geometryMs, junctionGenerationMs: 0,
      terrainClippingMs: this.terrainBlend?.lastBuildMs ?? 0, junctionClipMs: 0,
      markingGenerationMs: 0, uploadMs: this.timings.uploadMs, colliderMs: this.timings.colliderMs,
      decodeMs: this.timings.decodeMs, geometryCreationMs: this.timings.geometryMs,
      terrainReplacementMs: this.timings.terrainReplacementMs, queryIndexMs: this.timings.queryIndexMs,
      terrainTriangles: [...(this.terrainBlend?.tiles.values() ?? [])].reduce(
        (sum, group) => sum + (group.children[0]?.geometry.attributes.position.count ?? 0) / 3, 0)
    };
  }

  retire() {
    this.retired = true;
    this.colliderWireMaterial?.dispose();
  }
}
