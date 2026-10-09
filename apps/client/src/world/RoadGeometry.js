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

  const geometry =
    new THREE.BufferGeometry();

  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      positions,
      3
    )
  );

  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(
      uvs,
      2
    )
  );

  geometry.computeVertexNormals();
  return geometry;
}

function pushTriangle(positions, uvs, a, b, c) {
  positions.push(...a.position, ...b.position, ...c.position);
  uvs.push(...a.uv, ...b.uv, ...c.uv);
}

function pushQuad(positions, uvs, a, b, c, d) {
  pushTriangle(positions, uvs, a, b, c);
  pushTriangle(positions, uvs, a, c, d);
}

function directionOf(road) {
  const dx = road.b[0] - road.a[0];
  const dz = road.b[1] - road.a[1];
  const length = Math.hypot(dx, dz);

  if (length < 0.05) return null;
  return [dx / length, dz / length];
}

function pointsMatch(a, b) {
  return Math.hypot(
    a[0] - b[0],
    a[1] - b[1]
  ) < 0.05;
}

function endpointOffset(road, atStart, roadsByWay) {
  const direction = directionOf(road);
  if (!direction) return [0, 1];

  const point = atStart ? road.a : road.b;
  const connectedDirections = [direction];

  for (const other of roadsByWay.get(road.wayId) ?? []) {
    if (other === road) continue;

    const otherDirection = directionOf(other);
    if (!otherDirection) continue;

    const connected =
      (atStart && pointsMatch(other.b, point)) ||
      (!atStart && pointsMatch(other.a, point));

    if (connected) {
      connectedDirections.push(otherDirection);
      break;
    }
  }

  let tangentX = 0;
  let tangentZ = 0;

  for (const [x, z] of connectedDirections) {
    tangentX += x;
    tangentZ += z;
  }

  const tangentLength =
    Math.hypot(tangentX, tangentZ);

  if (tangentLength < 1e-6) {
    tangentX = direction[0];
    tangentZ = direction[1];
  } else {
    tangentX /= tangentLength;
    tangentZ /= tangentLength;
  }

  const normalX = -tangentZ;
  const normalZ = tangentX;
  const segmentNormalX = -direction[1];
  const segmentNormalZ = direction[0];
  const denominator =
    normalX * segmentNormalX +
    normalZ * segmentNormalZ;

  if (Math.abs(denominator) < 0.25) {
    return [segmentNormalX, segmentNormalZ];
  }

  const miterScale =
    THREE.MathUtils.clamp(
      1 / denominator,
      -2.5,
      2.5
    );

  return [
    normalX * miterScale,
    normalZ * miterScale
  ];
}

export class RoadGeometry {
  constructor({
    surface,
    shoulderWidth = 0.7,
    roadOffset = 0.055,
    crownHeight = 0.015,
    maxProfileSegmentLength = 2
  }) {
    this.surface = surface;
    this.shoulderWidth = shoulderWidth;
    this.roadOffset = roadOffset;
    this.crownHeight = crownHeight;
    this.maxProfileSegmentLength =
      maxProfileSegmentLength;
  }

  build(roads) {
    const asphaltPositions = [];
    const asphaltUvs = [];
    const shoulderPositions = [];
    const shoulderUvs = [];
    const markingPositions = [];
    const markingUvs = [];

    const roadsByWay = new Map();

    for (const road of roads) {
      if (!roadsByWay.has(road.wayId)) {
        roadsByWay.set(road.wayId, []);
      }

      roadsByWay.get(road.wayId).push(road);
    }

    for (const road of roads) {
      const direction = directionOf(road);
      if (!direction) continue;

      const [ux, uz] = direction;
      const length = Math.hypot(
        road.b[0] - road.a[0],
        road.b[1] - road.a[1]
      );
      const halfRoad = road.width / 2;

      const startOffset =
        endpointOffset(
          road,
          true,
          roadsByWay
        );
      const endOffset =
        endpointOffset(
          road,
          false,
          roadsByWay
        );

      const profile =
        this.surface.profileFor(road);

      const baseHeightAt = (t, x, z) => {
        if (profile) {
          return this.surface.profileHeight(
            profile,
            t
          );
        }

        return this.surface.terrainY(x, z);
      };

      const makePoint = (t, lateral, offset) => {
        const centerX =
          road.a[0] +
          (road.b[0] - road.a[0]) * t;
        const centerZ =
          road.a[1] +
          (road.b[1] - road.a[1]) * t;
        const x =
          centerX +
          offset[0] * lateral;
        const z =
          centerZ +
          offset[1] * lateral;
        const baseHeight =
          baseHeightAt(t, x, z);
        const roadEdgeHeight =
          baseHeight +
          this.roadOffset;

        let y;

        if (Math.abs(lateral) <= halfRoad) {
          const crownFactor =
            1 -
            Math.abs(lateral) / halfRoad;

          y =
            roadEdgeHeight +
            this.crownHeight * crownFactor;
        } else {
          const shoulderT =
            THREE.MathUtils.clamp(
              (
                Math.abs(lateral) -
                halfRoad
              ) /
              this.shoulderWidth,
              0,
              1
            );
          const terrainHeight =
            this.surface.terrainY(x, z);

          y =
            roadEdgeHeight +
            (terrainHeight - roadEdgeHeight) *
              shoulderT;
        }

        return {
          position: [x, y, z],
          uv: [t * length / 4, lateral / Math.max(road.width, 1)]
        };
      };

      const lateralOffsets = [
        -halfRoad - this.shoulderWidth,
        -halfRoad,
        0,
        halfRoad,
        halfRoad + this.shoulderWidth
      ];
      const sectionCount = Math.max(
        1,
        Math.ceil(length / this.maxProfileSegmentLength)
      );
      const sections = [];

      for (let i = 0; i <= sectionCount; i++) {
        const t = i / sectionCount;
        const offset = i === 0
          ? startOffset
          : i === sectionCount
            ? endOffset
            : [-uz, ux];

        sections.push(
          lateralOffsets.map(
            (lateral) =>
              makePoint(t, lateral, offset)
          )
        );
      }

      for (let i = 0; i < sectionCount; i++) {
        const startSection = sections[i];
        const endSection = sections[i + 1];

        pushQuad(
          asphaltPositions,
          asphaltUvs,
          startSection[1],
          startSection[2],
          endSection[2],
          endSection[1]
        );
        pushQuad(
          asphaltPositions,
          asphaltUvs,
          startSection[2],
          startSection[3],
          endSection[3],
          endSection[2]
        );
        pushQuad(
          shoulderPositions,
          shoulderUvs,
          startSection[0],
          startSection[1],
          endSection[1],
          endSection[0]
        );
        pushQuad(
          shoulderPositions,
          shoulderUvs,
          startSection[3],
          startSection[4],
          endSection[4],
          endSection[3]
        );
      }

      if (
        MARKED_ROADS.has(road.type) &&
        road.seq % 2 === 0 &&
        length >= 1
      ) {
        const dashLength =
          Math.min(3.2, length * 0.7);
        const middleT = 0.5;
        const startT =
          middleT - dashLength / (2 * length);
        const endT =
          middleT + dashLength / (2 * length);
        const dashHalfWidth = 0.075;
        const normal = [-uz, ux];
        const dashStartOffset =
          normal;
        const dashEndOffset =
          normal;

        const dashStartLeft =
          makePoint(startT, -dashHalfWidth, dashStartOffset);
        const dashStartRight =
          makePoint(startT, dashHalfWidth, dashStartOffset);
        const dashEndRight =
          makePoint(endT, dashHalfWidth, dashEndOffset);
        const dashEndLeft =
          makePoint(endT, -dashHalfWidth, dashEndOffset);

        for (const point of [
          dashStartLeft,
          dashStartRight,
          dashEndRight,
          dashEndLeft
        ]) {
          point.position[1] += 0.02;
        }

        pushQuad(
          markingPositions,
          markingUvs,
          dashStartLeft,
          dashStartRight,
          dashEndRight,
          dashEndLeft
        );
      }
    }

    return {
      asphalt: createGeometry(
        asphaltPositions,
        asphaltUvs
      ),
      shoulders: createGeometry(
        shoulderPositions,
        shoulderUvs
      ),
      markings: createGeometry(
        markingPositions,
        markingUvs
      )
    };
  }
}
