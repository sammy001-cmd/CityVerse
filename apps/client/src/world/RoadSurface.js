// ============================================================
// CITYVERSE — ROAD SURFACE
//
// Authoritative road-height/query layer.
//
// Used by:
// - road rendering
// - player grounding
// - vehicle spawning
// - later: Rapier road collision
// - later: traffic + navigation
// ============================================================

import { RenderedRoadSurface } from './RenderedRoadSurface.js';

const clamp01 = (value) =>
  Math.max(
    0,
    Math.min(1, value)
  );


export class RoadSurface {

  constructor({
    terrainY,
    cellSize = 32,
    shoulderWidth = 0.7,
    roadOffset = 0.055,
    crownHeight = 0.015
  }) {

    this.terrainY =
      terrainY;

    this.cellSize =
      cellSize;

    this.shoulderWidth =
      shoulderWidth;

    this.roadOffset =
      roadOffset;

    this.crownHeight =
      crownHeight;

    // Spatial lookup.
    this.cells =
      new Map();


    // tileKey -> prepared road segments
    this.tiles =
      new Map();


    // Original road JSON object -> prepared profile
    this.profiles =
      new WeakMap();
    this.rendered = new RenderedRoadSurface(cellSize);

  }


  cellKey(x, z) {

    return (
      `${Math.floor(x / this.cellSize)},` +
      `${Math.floor(z / this.cellSize)}`
    );

  }


  // ----------------------------------------------------------
  // SMOOTH TERRAIN INTO A ROAD PROFILE
  // ----------------------------------------------------------

  smoothTerrainHeight(
    x,
    z,
    ux,
    uz
  ) {

    // Weighted longitudinal smoothing.
    // This removes tiny terrain bumps without flattening hills.
    const samples = [
      [-12, 1],
      [-6, 2],
      [0, 3],
      [6, 2],
      [12, 1]
    ];


    let total =
      0;

    let weightTotal =
      0;


    for (
      const [
        distance,
        weight
      ] of samples
    ) {

      total +=
        this.terrainY(
          x +
            ux *
            distance,

          z +
            uz *
            distance
        ) *
        weight;


      weightTotal +=
        weight;

    }


    return (
      total /
      weightTotal
    );

  }


  prepareRoad(
    road
  ) {

    const [
      ax,
      az
    ] =
      road.a;


    const [
      bx,
      bz
    ] =
      road.b;


    const dx =
      bx - ax;

    const dz =
      bz - az;


    const length =
      Math.hypot(
        dx,
        dz
      );


    if (
      length < 0.05
    ) {
      return null;
    }


    const ux =
      dx / length;

    const uz =
      dz / length;


    const nx =
      -uz;

    const nz =
      ux;


    const yA =
      this.smoothTerrainHeight(
        ax,
        az,
        ux,
        uz
      );


    const yB =
      this.smoothTerrainHeight(
        bx,
        bz,
        ux,
        uz
      );


    const profile = {

      road,

      wayId:
        road.wayId,

      seq:
        road.seq,

      type:
        road.type,

      name:
        road.name,

      width:
        road.width,

      ax,
      az,

      bx,
      bz,

      dx,
      dz,

      length,

      ux,
      uz,

      nx,
      nz,

      yA,
      yB

    };


    this.profiles.set(
      road,
      profile
    );


    return profile;

  }


  // ----------------------------------------------------------
  // TILE REGISTRATION
  // ----------------------------------------------------------

  addTile(
    tileKey,
    roads
  ) {

    this.removeTile(
      tileKey
    );


    const entries =
      [];


    for (
      const road of roads
    ) {

      const segment =
        this.prepareRoad(
          road
        );


      if (!segment) {
        continue;
      }


      entries.push(
        segment
      );


      const padding =
        segment.width /
          2 +
        this.shoulderWidth;


      const minX =
        Math.min(
          segment.ax,
          segment.bx
        ) -
        padding;


      const maxX =
        Math.max(
          segment.ax,
          segment.bx
        ) +
        padding;


      const minZ =
        Math.min(
          segment.az,
          segment.bz
        ) -
        padding;


      const maxZ =
        Math.max(
          segment.az,
          segment.bz
        ) +
        padding;


      const cx0 =
        Math.floor(
          minX /
          this.cellSize
        );


      const cx1 =
        Math.floor(
          maxX /
          this.cellSize
        );


      const cz0 =
        Math.floor(
          minZ /
          this.cellSize
        );


      const cz1 =
        Math.floor(
          maxZ /
          this.cellSize
        );


      for (
        let cx = cx0;
        cx <= cx1;
        cx++
      ) {

        for (
          let cz = cz0;
          cz <= cz1;
          cz++
        ) {

          const key =
            `${cx},${cz}`;


          if (
            !this.cells.has(
              key
            )
          ) {

            this.cells.set(
              key,
              new Set()
            );

          }


          this.cells
            .get(key)
            .add(segment);

        }

      }

    }


    this.tiles.set(
      tileKey,
      entries
    );

  }


  removeTile(
    tileKey
  ) {
    this.rendered.removeTile(tileKey);

    const entries =
      this.tiles.get(
        tileKey
      );


    if (!entries) {
      return;
    }


    for (
      const segment of entries
    ) {

      for (
        const [
          key,
          set
        ] of this.cells
      ) {

        set.delete(
          segment
        );


        if (
          set.size === 0
        ) {

          this.cells.delete(
            key
          );

        }

      }

    }


    this.tiles.delete(
      tileKey
    );

  }


  profileFor(
    road
  ) {

    return (
      this.profiles.get(
        road
      ) ??
      null
    );

  }

  addRenderedTile(key, group) {
    this.rendered.addTile(key, group);
  }

  sampleRendered(x, z) {
    return this.rendered.sample(x, z);
  }

  profileHeight(
    profile,
    t
  ) {
    const x =
      profile.ax +
      profile.dx * t;
    const z =
      profile.az +
      profile.dz * t;

    return this.smoothTerrainHeight(
      x,
      z,
      profile.ux,
      profile.uz
    );
  }


  heightForRoad(
    road,
    t,
    offset = 0
  ) {

    const profile =
      this.profileFor(
        road
      );


    if (!profile) {
      return null;
    }


    return this.profileHeight(
      profile,
      clamp01(t)
    ) + offset;

  }


  // ----------------------------------------------------------
  // WORLD POSITION -> ROAD SURFACE
  // ----------------------------------------------------------

  sample(
    x,
    z
  ) {

    const candidates =
      this.cells.get(
        this.cellKey(
          x,
          z
        )
      );


    if (
      !candidates ||
      candidates.size === 0
    ) {

      return {
        onRoad: false,
        onShoulder: false,
        height: null
      };

    }


    let best =
      null;

    let bestDistance =
      Infinity;


    for (
      const segment
      of candidates
    ) {

      const len2 =
        segment.dx *
          segment.dx +
        segment.dz *
          segment.dz;


      if (
        len2 <= 0
      ) {
        continue;
      }


      const t =
        clamp01(
          (
            (
              x -
              segment.ax
            ) *
              segment.dx +
            (
              z -
              segment.az
            ) *
              segment.dz
          ) /
          len2
        );


      const centreX =
        segment.ax +
        segment.dx *
          t;


      const centreZ =
        segment.az +
        segment.dz *
          t;


      const distance =
        Math.hypot(
          x - centreX,
          z - centreZ
        );


      const halfRoad =
        segment.width /
        2;


      const maxDistance =
        halfRoad +
        this.shoulderWidth;


      if (
        distance >
        maxDistance
      ) {
        continue;
      }


      if (
        distance >=
        bestDistance
      ) {
        continue;
      }


      bestDistance =
        distance;


      const baseHeight =
        this.profileHeight(
          segment,
          t
        );

      const roadHeight =
        baseHeight +
        this.roadOffset;

      const terrainHeight =
        this.terrainY(
          x,
          z
        );

      let surfaceHeight =
        roadHeight;

      if (
        distance <=
        halfRoad
      ) {
        surfaceHeight =
          roadHeight +
          this.crownHeight *
          (
            1 -
            clamp01(
              distance /
              halfRoad
            )
          );
      } else {
        const shoulderT =
          clamp01(
            (
              distance -
              halfRoad
            ) /
            this.shoulderWidth
          );

        surfaceHeight =
          roadHeight +
          (
            terrainHeight -
            roadHeight
          ) *
          shoulderT;
      }


      best = {

        onRoad:
          distance <=
          halfRoad,

        onShoulder:
          distance >
            halfRoad &&
          distance <=
            maxDistance,

        surface:
          distance <= halfRoad
            ? 'road'
            : 'shoulder',

        height:
          surfaceHeight,

        baseHeight,

        roadId:
          segment.wayId,

        sequence:
          segment.seq,

        roadType:
          segment.type,

        name:
          segment.name,

        width:
          segment.width,

        distanceFromCenter:
          distance,

        t,

        heading:
          Math.atan2(
            segment.ux,
            segment.uz
          ),

        directionX:
          segment.ux,

        directionZ:
          segment.uz

      };

    }


    return (
      best ?? {
        onRoad: false,
        onShoulder: false,
        height: null
      }
    );

  }

}
