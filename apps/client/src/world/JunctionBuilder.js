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

  build(junctions, rendered = null) {
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
            (rendered ?? this.surface).sample(
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
            );

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

      // Convex apron boundary avoids concave fan folds at unequal arm angles.
      boundary.sort((a,b) => a.x-b.x || a.z-b.z);
      const turn=(a,b,c) => (b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
      const lower=[],upper=[];
      for (const point of boundary) {
        while (lower.length>=2 && turn(lower.at(-2),lower.at(-1),point)<=0) lower.pop();
        lower.push(point);
      }
      for (const point of [...boundary].reverse()) {
        while (upper.length>=2 && turn(upper.at(-2),upper.at(-1),point)<=0) upper.pop();
        upper.push(point);
      }
      boundary.splice(0,boundary.length,...lower.slice(0,-1),...upper.slice(0,-1));
      boundary.reverse();

      const centerSample =
        (rendered ?? this.surface).sample(
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
        y: centerY,
        z: junction.z
      };
      for (let i=0;i<boundary.length;i++) {
        const a=boundary[i],b=boundary[(i+1)%boundary.length];
        positions.push(center.x,center.y,center.z,a.x,a.y,a.z,b.x,b.y,b.z);
        uvs.push(center.x/4,center.z/4,a.x/4,a.z/4,b.x/4,b.z/4);
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

}