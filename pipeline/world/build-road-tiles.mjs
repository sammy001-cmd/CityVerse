import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// CITYVERSE — PRODUCTION ROAD TILE BUILDER
// Converts district.json into streamable 250m road tiles.
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '../..');

const INPUT =
  path.join(ROOT, 'apps/client/public/data/district.json');

const OUTPUT =
  path.join(ROOT, 'apps/client/public/data/road-tiles');

const CENTER = {
  lat: 7.3962,
  lon: 3.8968
};

const TILE_SIZE = 250;
const MAX_SEGMENT = 8;

const M_LON = 111320;
const M_LAT = 110540;

const cosLat =
  Math.cos(
    CENTER.lat *
    Math.PI /
    180
  );

const ROAD_W = {
  motorway: 14,
  trunk: 14,
  primary: 12,
  secondary: 10,
  tertiary: 8,
  unclassified: 6,
  residential: 6,
  living_street: 5,
  service: 4,
  track: 3
};


// ============================================================
// GEO
// ============================================================

function project(lat, lon) {

  return [

    (lon - CENTER.lon) *
      M_LON *
      cosLat,

    -(lat - CENTER.lat) *
      M_LAT

  ];

}


// ============================================================
// TILE
// ============================================================

function tileFor(x, z) {

  return [

    Math.floor(
      x /
      TILE_SIZE
    ),

    Math.floor(
      z /
      TILE_SIZE
    )

  ];

}


function tileKey(tx, tz) {

  return `${tx}_${tz}`;

}


// ============================================================
// DENSIFY
// ============================================================

function densify(points) {

  if (
    points.length < 2
  ) {

    return points;

  }


  const output = [
    points[0]
  ];


  for (
    let i = 1;
    i < points.length;
    i++
  ) {

    const a =
      points[i - 1];

    const b =
      points[i];


    const dx =
      b[0] -
      a[0];

    const dz =
      b[1] -
      a[1];


    const distance =
      Math.hypot(
        dx,
        dz
      );


    const steps =
      Math.max(
        1,
        Math.ceil(
          distance /
          MAX_SEGMENT
        )
      );


    for (
      let s = 1;
      s <= steps;
      s++
    ) {

      const t =
        s /
        steps;


      output.push([

        a[0] +
          dx *
          t,

        a[1] +
          dz *
          t

      ]);

    }

  }


  return output;

}


// ============================================================
// MAIN
// ============================================================

const osm =
  JSON.parse(
    await fs.readFile(
      INPUT,
      'utf8'
    )
  );


await fs.rm(
  OUTPUT,
  {
    recursive: true,
    force: true
  }
);


await fs.mkdir(
  OUTPUT,
  {
    recursive: true
  }
);


const tiles =
  new Map();


const spawnPoints = [];

const lampSpots = [];


// Used for detecting real junctions.
const nodeUsage =
  new Map();


function getTile(tx, tz) {

  const key =
    tileKey(
      tx,
      tz
    );


  if (
    !tiles.has(key)
  ) {

    tiles.set(
      key,
      {
        tx,
        tz,
        roads: [],
        junctions: []
      }
    );

  }


  return tiles.get(key);

}


// ============================================================
// PROCESS WAYS
// ============================================================

for (
  const way
  of osm.elements
) {

  const type =
    way.tags?.highway;


  const width =
    ROAD_W[type];


  if (
    !width ||
    !way.geometry ||
    way.geometry.length < 2
  ) {

    continue;

  }


  // ----------------------------------------------------------
  // ORIGINAL OSM NODES FOR JUNCTION DETECTION
  // ----------------------------------------------------------

  const original =
    way.geometry.map(
      (p) =>
        project(
          p.lat,
          p.lon
        )
    );


  original.forEach(
    (
      point,
      index
    ) => {

      const nodeId =
        way.nodes?.[index];


      const key =
        nodeId
          ? `node:${nodeId}`
          : `coord:${point[0].toFixed(1)},${point[1].toFixed(1)}`;


      if (
        !nodeUsage.has(key)
      ) {

        nodeUsage.set(
          key,
          {
            x: point[0],
            z: point[1],
            width,
            ways: new Set()
          }
        );

      }


      const record =
        nodeUsage.get(key);


      record.width =
        Math.max(
          record.width,
          width
        );


      record.ways.add(
        way.id
      );

    }
  );


  // ----------------------------------------------------------
  // ROAD SEGMENTS
  // ----------------------------------------------------------

  const points =
    densify(
      original
    );


  let lampDistance = 0;

  let spawnDistance = 0;

  let lampSide = 1;


  for (
    let i = 1;
    i < points.length;
    i++
  ) {

    const a =
      points[i - 1];

    const b =
      points[i];


    const dx =
      b[0] -
      a[0];

    const dz =
      b[1] -
      a[1];


    const length =
      Math.hypot(
        dx,
        dz
      );


    if (
      length < 0.1
    ) {

      continue;

    }


    const ux =
      dx /
      length;

    const uz =
      dz /
      length;


    const mx =
      (
        a[0] +
        b[0]
      ) /
      2;


    const mz =
      (
        a[1] +
        b[1]
      ) /
      2;


    const [
      tx,
      tz
    ] =
      tileFor(
        mx,
        mz
      );


    const tile =
      getTile(
        tx,
        tz
      );


    tile.roads.push({

      wayId:
        way.id,

      seq:
        i,

      type,

      width,

      name:
        way.tags?.name ||
        null,

      a,

      b

    });


    // --------------------------------------------------------
    // SPAWN / TRAFFIC CANDIDATES
    // --------------------------------------------------------

    spawnDistance +=
      length;


    if (
      width >= 6 &&
      spawnDistance >= 70
    ) {

      spawnDistance = 0;


      spawnPoints.push([

        mx,

        mz,

        ux,

        uz

      ]);

    }


    // --------------------------------------------------------
    // LAMPS
    // --------------------------------------------------------

    if (
      [
        'trunk',
        'primary',
        'secondary',
        'tertiary'
      ].includes(type)
    ) {

      lampDistance +=
        length;


      if (
        lampDistance >= 45
      ) {

        lampDistance = 0;


        const nx =
          -uz;

        const nz =
          ux;


        const offset =
          width /
          2 +
          1.5;


        lampSpots.push([

          mx +
            nx *
            offset *
            lampSide,

          mz +
            nz *
            offset *
            lampSide

        ]);


        lampSide *= -1;

      }

    }

  }

}


// ============================================================
// JUNCTIONS
// ============================================================

for (
  const record
  of nodeUsage.values()
) {

  if (
    record.ways.size < 2
  ) {

    continue;

  }


  const [
    tx,
    tz
  ] =
    tileFor(
      record.x,
      record.z
    );


  getTile(
    tx,
    tz
  ).junctions.push({

    x:
      record.x,

    z:
      record.z,

    radius:
      Math.max(
        3,
        record.width *
        0.65
      )

  });

}


// ============================================================
// WRITE TILES
// ============================================================

for (
  const [
    key,
    tile
  ]
  of tiles
) {

  await fs.writeFile(

    path.join(
      OUTPUT,
      `${key}.json`
    ),

    JSON.stringify(
      tile
    )

  );

}


// ============================================================
// MANIFEST
// ============================================================

const manifest = {

  version: 1,

  center:
    CENTER,

  tileSize:
    TILE_SIZE,

  tiles:
    [...tiles.keys()],

  spawnPoints,

  lampSpots,

  stats: {

    tiles:
      tiles.size,

    roadSegments:
      [...tiles.values()]
        .reduce(
          (
            total,
            tile
          ) =>
            total +
            tile.roads.length,

          0
        ),

    junctions:
      [...tiles.values()]
        .reduce(
          (
            total,
            tile
          ) =>
            total +
            tile.junctions.length,

          0
        )

  }

};


await fs.writeFile(

  path.join(
    OUTPUT,
    'manifest.json'
  ),

  JSON.stringify(
    manifest,
    null,
    2
  )

);


console.log('');
console.log('CITYVERSE ROAD BUILD COMPLETE');
console.log('--------------------------------');
console.log('Tiles:', manifest.stats.tiles);
console.log('Segments:', manifest.stats.roadSegments);
console.log('Junctions:', manifest.stats.junctions);
console.log('Spawn points:', spawnPoints.length);
console.log('Lamp spots:', lampSpots.length);
console.log('');