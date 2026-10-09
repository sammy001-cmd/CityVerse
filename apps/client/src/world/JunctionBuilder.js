import * as THREE from 'three';

export class JunctionBuilder {
  constructor({
    surface,
    roadOffset = 0.055,
    overlap = 1.2,
    maxSlopeSegmentLength = 2
  }) {
    this.surface = surface;
    this.roadOffset = roadOffset;
    this.overlap = overlap;
    this.maxSlopeSegmentLength =
      maxSlopeSegmentLength;
  }

  build(junctions) {
    const positions = [];
    const uvs = [];

    for (const junction of junctions) {
      const arms = junction.arms ?? [];
      if (arms.length < 3) continue;

      const boundary = [];
      const centerSamples = [];

      for (const arm of arms) {
        const length = Math.hypot(
          arm.dirX,
          arm.dirZ
        );

        if (length < 0.001) continue;

        const ux = arm.dirX / length;
        const uz = arm.dirZ / length;
        const nx = -uz;
        const nz = ux;
        const halfWidth = arm.width / 2;
        const mouthDistance =
          Math.max(
            junction.radius ?? 3,
            arm.width * 0.6
          ) +
          this.overlap;

        const sample =
          this.surface.sample(
            junction.x + ux * 0.5,
            junction.z + uz * 0.5
          );

        centerSamples.push(
          sample?.height ??
          (
            this.surface.terrainY(
              junction.x,
              junction.z
            ) +
            this.roadOffset
          )
        );

        for (const side of [-1, 1]) {
          const x =
            junction.x +
            ux * mouthDistance +
            nx * halfWidth * side;

          const z =
            junction.z +
            uz * mouthDistance +
            nz * halfWidth * side;

          const road =
            this.surface.sample(
              x,
              z
            );

          const y =
            (
              road?.height ??
              (
                this.surface.terrainY(
                  x,
                  z
                ) +
                this.roadOffset
              )
            ) +
            0.008;

          boundary.push({
            x,
            y,
            z,
            angle: Math.atan2(
              z - junction.z,
              x - junction.x
            )
          });
        }
      }

      if (boundary.length < 3) continue;

      boundary.sort(
        (a, b) => a.angle - b.angle
      );

      const centerSample =
        this.surface.sample(
          junction.x,
          junction.z
        );
      const centerY =
        centerSample?.height ??
        (
          centerSamples.length
            ? centerSamples.reduce(
                (sum, value) => sum + value,
                0
              ) / centerSamples.length
            : this.surface.terrainY(
                junction.x,
                junction.z
              ) + this.roadOffset
        );
      const center = {
        x: junction.x,
        y: centerY + 0.01,
        z: junction.z
      };
      const ringCount = Math.max(
        1,
        Math.ceil(
          Math.max(
            ...boundary.map((point) =>
              Math.hypot(
                point.x - center.x,
                point.z - center.z
              )
            )
          ) / this.maxSlopeSegmentLength
        )
      );

      for (let i = 0; i < boundary.length; i++) {
        const a = boundary[i];
        const b = boundary[
          (i + 1) % boundary.length
        ];

        let innerA = center;
        let innerB = center;

        for (let ring = 1; ring <= ringCount; ring++) {
          const t = ring / ringCount;
          const outerA = this.sampleBoundaryPoint(
            center,
            a,
            t
          );
          const outerB = this.sampleBoundaryPoint(
            center,
            b,
            t
          );

          positions.push(
            innerA.x, innerA.y, innerA.z,
            outerA.x, outerA.y, outerA.z,
            outerB.x, outerB.y, outerB.z,
            innerA.x, innerA.y, innerA.z,
            outerB.x, outerB.y, outerB.z,
            innerB.x, innerB.y, innerB.z
          );

          uvs.push(
            innerA.x / 4, innerA.z / 4,
            outerA.x / 4, outerA.z / 4,
            outerB.x / 4, outerB.z / 4,
            innerA.x / 4, innerA.z / 4,
            outerB.x / 4, outerB.z / 4,
            innerB.x / 4, innerB.z / 4
          );

          innerA = outerA;
          innerB = outerB;
        }
      }
    }

    if (positions.length === 0) return null;

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

  sampleBoundaryPoint(center, boundary, t) {
    const x =
      center.x +
      (boundary.x - center.x) * t;
    const z =
      center.z +
      (boundary.z - center.z) * t;
    const sample =
      this.surface.sample(x, z);

    return {
      x,
      y: (sample?.height ??
        this.surface.terrainY(x, z) +
          this.roadOffset) + 0.01,
      z
    };
  }
}
