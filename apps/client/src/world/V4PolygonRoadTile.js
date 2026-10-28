import * as THREE from 'three';
import { RenderedRoadSurface } from './RenderedRoadSurface.js';

// Runtime work is limited to ear clipping and terrain draping of an already
// unioned tile. City scale buffering and union are build-time operations.
export function buildV4PolygonRoadTile(data, { terrainHeightAt, material = null } = {}) {
  if (data?.version !== 1 || !Array.isArray(data.features) || typeof terrainHeightAt !== 'function') {
    throw new Error('Malformed V4 road tile or missing terrain sampler.');
  }
  const group = new THREE.Group();
  group.name = `RoadV4Tile_${data.tx}_${data.tz}`;
  const positions = [], indices = [], metadata = [];
  for (const feature of data.features) {
    if (!Array.isArray(feature.outer) || feature.outer.length < 3) continue;
    const outer = feature.outer.map(([x, z]) => new THREE.Vector2(x, z));
    const holes = (feature.holes ?? []).map(ring => ring.map(([x, z]) => new THREE.Vector2(x, z)));
    const localIndices = THREE.ShapeUtils.triangulateShape(outer, holes);
    const points = [...outer, ...holes.flat()];
    const base = positions.length / 3;
    for (const p of points) {
      const x = p.x + data.tx * data.tileSize, z = p.y + data.tz * data.tileSize;
      const y = terrainHeightAt(x, z, feature);
      if (!Number.isFinite(y)) throw new Error(`Invalid terrain height at V4 road vertex ${x}, ${z}`);
      positions.push(x, y + 0.035, z);
    }
    for (const tri of localIndices) {
      // ShapeUtils triangulates in X/Z as a 2D plane. Mapping that plane to
      // Three's X/Y/Z world axes reverses orientation, so swap the last two
      // vertices to keep the road's 3D normal pointing up (+Y). This same
      // indexed geometry is consumed by rendering, queries, and Rapier.
      indices.push(base + tri[0], base + tri[2], base + tri[1]);
      metadata.push({ road: { wayId: feature.ids[0] ?? null, wayIds: feature.ids,
        type: feature.types[0] ?? null, width: feature.width ?? null } });
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.userData.surfaceRoads = metadata;
  const mesh = new THREE.Mesh(geometry, material ?? new THREE.MeshStandardMaterial({ color: 0x34383d, roughness: 0.94, side: THREE.DoubleSide }));
  mesh.name = 'RoadV4UnifiedSurface';
  mesh.receiveShadow = true;
  mesh.userData.roadCollision = true;
  mesh.userData.part = 'asphalt';
  group.add(mesh);
  const query = new RenderedRoadSurface();
  query.addTile(`${data.tx}_${data.tz}`, group);
  return { group, query, triangleCount: indices.length / 3, polygonCount: data.features.length };
}
