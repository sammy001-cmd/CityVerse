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

const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const INPUT=path.resolve(ROOT,arg('--input','apps/client/public/data/district.json'));
const OUTPUT=path.resolve(ROOT,arg('--output','apps/client/public/data/road-tiles'));
const fullCoverage=process.argv.includes('--full-coverage'),noNavigationGraph=process.argv.includes('--no-navigation-graph');
if(fullCoverage&&!OUTPUT.startsWith(path.join(ROOT,'.world-assets','staging')+path.sep))
  throw new Error('Full road coverage output must stay under .world-assets/staging/.');

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
  motorway_link: 14,
  trunk: 6.8,
  trunk_link: 6.8,
  primary: 6.5,
  primary_link: 6.5,
  secondary: 6,
  secondary_link: 6,
  tertiary: 5.6,
  tertiary_link: 5.6,
  unclassified: 5.2,
  residential: 5.2,
  living_street: 5,
  service: 2.4,
  track: 5.2
};

function sourceWidth(tags, type) {
  const rawTag=String(tags?.width??'').trim().toLowerCase();
  const parsed=Number.parseFloat(rawTag.replace(',','.'));
  const raw=Number.isFinite(parsed)&&/(?:\s*(?:ft|feet|foot|'|′))$/.test(rawTag)?parsed*0.3048:parsed;
  if (Number.isFinite(raw) && raw>=2.2 && raw<=32) return {width:raw,widthSource:'osm'};
  const baseType=type.replace(/_link$/,'');
  const lanes=Number.parseInt(tags?.lanes,10);
  if(Number.isFinite(lanes)&&lanes>0&&lanes<=6){
    const laneWidth=({motorway:3.5,trunk:3.4,primary:3.25,secondary:3,tertiary:2.8,residential:2.6,unclassified:2.6,living_street:2.5,service:2.4})[baseType]??2.6;
    return {width:Math.min(32,lanes*laneWidth),widthSource:'lanes'};
  }
  return {width:ROAD_W[type],widthSource:'class'};
}


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

// Conservative, bounded Chaikin smoothing. Only bends whose two source
// segments are short and non-junction vertices are softened. Each replacement
// point is a convex combination of adjacent source points, with the maximum
// displacement bounded by the corner cut (<= 1 m). Source geometry remains
// unchanged for node/junction detection and every smoothed way is re-densified
// to the established 8 m maximum segment length.
function smoothCenterline(points, protectedNodes = new Set(), { maxCut = 1, maxInputSegment = 24, maxTurnDegrees = 100 } = {}) {
  if (points.length < 3) return { points, changed: 0 };
  const output = [points[0]];
  let changed = 0;
  const maxTurn = maxTurnDegrees * Math.PI / 180;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], before = points[i - 1], after = points[i + 1];
    const ax = p[0] - before[0], az = p[1] - before[1];
    const bx = after[0] - p[0], bz = after[1] - p[1];
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    const turn = Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / Math.max(la * lb, 1e-9))));
    if (protectedNodes.has(i) || la < 0.1 || lb < 0.1 || la > maxInputSegment || lb > maxInputSegment ||
        turn < 8 * Math.PI / 180 || turn > maxTurn) {
      output.push(p);
      continue;
    }
    const cut = Math.min(0.22, maxCut / Math.max(la, lb));
    const q = [p[0] * (1 - cut) + before[0] * cut, p[1] * (1 - cut) + before[1] * cut];
    const r = [p[0] * (1 - cut) + after[0] * cut, p[1] * (1 - cut) + after[1] * cut];
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) > maxCut + 1e-6 || Math.hypot(r[0] - p[0], r[1] - p[1]) > maxCut + 1e-6) {
      output.push(p); continue;
    }
    output.push(q, r); changed++;
  }
  output.push(points.at(-1));
  return { points: changed ? output : points, changed };
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
let sourcePointCount = 0, smoothedPointCount = 0, smoothedWays = 0, maxSmoothingDeviation = 0, smoothingMs = 0;

const graphNodes = {};
const graphEdges = [];


// Used for detecting real junctions.
const nodeUsage =
  new Map();

const sourceNodeWayCounts=new Map();
for(const way of osm.elements){
  if(!way.geometry||way.geometry.length<2)continue;
  for(const nodeId of way.nodes??[])if(nodeId!=null)sourceNodeWayCounts.set(String(nodeId),(sourceNodeWayCounts.get(String(nodeId))??0)+1);
}


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


  const dimensions=sourceWidth(way.tags,type);
  const width=dimensions.width;


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
  sourcePointCount += original.length;

  const graphNodeIds =
    original.map(
      (point, index) => {
        const nodeId =
          way.nodes?.[index];
        const id = nodeId != null
          ? String(nodeId)
          : `coord:${point[0].toFixed(2)},${point[1].toFixed(2)}`;

        if(!noNavigationGraph)graphNodes[id] = {
          x: point[0],
          z: point[1]
        };

        return id;
      }
    );

  const onewayTag =
    String(way.tags?.oneway ?? '')
      .trim()
      .toLowerCase();
  const reverseOneWay =
    onewayTag === '-1';
  const oneWay =
    reverseOneWay ||
    ['yes', 'true', '1'].includes(onewayTag) ||
    way.tags?.junction === 'roundabout';

  for (
    let i = 1;
    i < original.length;
    i++
  ) {
    const fromPoint = original[i - 1];
    const toPoint = original[i];
    const length = Math.hypot(
      toPoint[0] - fromPoint[0],
      toPoint[1] - fromPoint[1]
    );

    if (length < 0.1) {
      continue;
    }

    if(!noNavigationGraph)graphEdges.push({
      from: graphNodeIds[reverseOneWay ? i : i - 1],
      to: graphNodeIds[reverseOneWay ? i - 1 : i],
      wayId: way.id,
      name: way.tags?.name || null,
      type,
      length,
      width,

      widthSource:dimensions.widthSource,
      lanes:way.tags?.lanes??null,
      oneWay
    });
  }


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
            ways: new Set(),
            arms: []
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

      const addArm = (neighbour) => {
        if (!neighbour) {
          return;
        }

        const dx =
          neighbour[0] -
          point[0];
        const dz =
          neighbour[1] -
          point[1];
        const length =
          Math.hypot(dx, dz);

        if (length < 0.1) {
          return;
        }

        const dirX = dx / length;
        const dirZ = dz / length;
        const duplicate =
          record.arms.some(
            (arm) =>
              arm.wayId === way.id &&
              arm.dirX * dirX +
                arm.dirZ * dirZ >
                0.999
          );

        if (duplicate) {
          return;
        }

        record.arms.push({
          wayId: way.id,
          type,
          width,
          widthSource:dimensions.widthSource,
          lanes:way.tags?.lanes??null,
          name: way.tags?.name || null,
          dirX,
          dirZ
        });
      };

      addArm(
        original[index - 1]
      );
      addArm(
        original[index + 1]
      );

    }
  );


  // ----------------------------------------------------------
  // ROAD SEGMENTS
  // ----------------------------------------------------------

  const protectedNodes = new Set();
  original.forEach((point,index)=>{
    const nodeId=way.nodes?.[index];
    const nodeKey=nodeId!=null?`node:${nodeId}`:`coord:${point[0].toFixed(1)},${point[1].toFixed(1)}`;
    if(nodeId!=null ? (sourceNodeWayCounts.get(String(nodeId))??0)>1 : (nodeUsage.get(nodeKey)?.ways.size??0)>1) protectedNodes.add(index);
  });
  const smoothingStart=performance.now();
  const smoothed=smoothCenterline(original,protectedNodes);
  smoothingMs+=performance.now()-smoothingStart;
  if(smoothed.changed) smoothedWays++;
  const alignmentDistance=p=>{let nearest=Infinity;for(let i=1;i<original.length;i++){
    const a=original[i-1],b=original[i],dx=b[0]-a[0],dz=b[1]-a[1],den=dx*dx+dz*dz;
    const t=den?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/den)):0;
    nearest=Math.min(nearest,Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz));
  }return nearest;};
  for(let i=0;i<smoothed.points.length;i++){
    maxSmoothingDeviation=Math.max(maxSmoothingDeviation,alignmentDistance(smoothed.points[i]));
    if(i+1<smoothed.points.length){const a=smoothed.points[i],b=smoothed.points[i+1];maxSmoothingDeviation=Math.max(maxSmoothingDeviation,alignmentDistance([(a[0]+b[0])/2,(a[1]+b[1])/2]));}
  }
  // Retain protected junction positions while taking their arm tangents from
  // the final smoothed path, so aprons, meshes and collision share one curve.
  for(const index of protectedNodes){
    const p=original[index],nodeId=way.nodes?.[index],nodeKey=nodeId!=null?`node:${nodeId}`:`coord:${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    const record=nodeUsage.get(nodeKey);if(!record)continue;
    const at=smoothed.points.findIndex(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<0.001);if(at<0)continue;
    const candidates=[];for(const neighbour of [smoothed.points[at-1],smoothed.points[at+1]])if(neighbour){const dx=neighbour[0]-p[0],dz=neighbour[1]-p[1],length=Math.hypot(dx,dz);if(length>.01)candidates.push({dirX:dx/length,dirZ:dz/length});}
    for(const arm of record.arms.filter(a=>String(a.wayId)===String(way.id))){
      let best=-1,bestDot=-Infinity;for(let i=0;i<candidates.length;i++){const dot=arm.dirX*candidates[i].dirX+arm.dirZ*candidates[i].dirZ;if(dot>bestDot){bestDot=dot;best=i;}}
      if(best>=0){const [tangent]=candidates.splice(best,1);arm.dirX=tangent.dirX;arm.dirZ=tangent.dirZ;}
    }
  }
  const points = densify(smoothed.points);
  smoothedPointCount += points.length;


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
      widthSource:dimensions.widthSource,
      lanes:way.tags?.lanes??null,
      surface:way.tags?.surface??null,
      oneway:oneWay,

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
      spawnDistance >= 250
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
  const [
    junctionId,
    record
  ]
  of nodeUsage
) {

  if (
    record.arms.length < 3
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

    junctionId,

    id:
      junctionId,

    x:
      record.x,

    z:
      record.z,

    radius:
      Math.max(
        3,
        record.width *
        0.65
      ),

    arms:
      record.arms

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

  ...(noNavigationGraph?{}:{navigationGraph:'navigation-graph.json'}),

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

    sourcePoints:sourcePointCount,
    resampledPoints:smoothedPointCount,
    smoothedWays,
    maxSmoothingDeviationMetres:Number(maxSmoothingDeviation.toFixed(3)),
    smoothingMs:Number(smoothingMs.toFixed(2)),
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
        ),

    ...(noNavigationGraph?{}:{navigationNodes:Object.keys(graphNodes).length,navigationEdges:graphEdges.length})

  }

};

if(!noNavigationGraph)await fs.writeFile(path.join(OUTPUT,manifest.navigationGraph),JSON.stringify({version:1,nodes:graphNodes,edges:graphEdges}));

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
if(!noNavigationGraph){console.log('Navigation nodes:', manifest.stats.navigationNodes);console.log('Navigation edges:', manifest.stats.navigationEdges);}
console.log('Spawn points:', spawnPoints.length);
console.log('Lamp spots:', lampSpots.length);
console.log('');
