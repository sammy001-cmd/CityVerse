import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

const INPUT = path.join(
  ROOT,
  'apps/client/public/data/city-road-source.json'
);
const OUTPUT = path.join(
  ROOT,
  'apps/client/public/data/city-map-roads'
);
const ROUTING_OUTPUT = path.join(
  ROOT,
  'data/generated/ibadan-routing-graph.json'
);

const CENTER = {
  lat: 7.3962,
  lon: 3.8968
};
const TILE_SIZE = 1000;
const MAX_DETAIL_SEGMENT = 80;
const METRES_PER_DEGREE_LAT = 110540;
const METRES_PER_DEGREE_LON = 111320;
const EARTH_RADIUS_METRES = 6371008.8;
const COS_CENTER_LAT = Math.cos(CENTER.lat * Math.PI / 180);

const ROAD_CLASSES = [
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'unclassified',
  'residential',
  'living_street',
  'service'
];
const ROAD_CLASS_IDS = new Map(
  ROAD_CLASSES.map((roadClass, id) => [roadClass, id])
);
const OVERVIEW_CLASSES = new Set([
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link'
]);

function project(lat, lon) {
  return [
    (lon - CENTER.lon) * METRES_PER_DEGREE_LON * COS_CENTER_LAT,
    -(lat - CENTER.lat) * METRES_PER_DEGREE_LAT
  ];
}

function tileKey(tx, tz) {
  return `${tx}_${tz}`;
}

function metersBetween(a, b) {
  const latA = a.lat * Math.PI / 180;
  const latB = b.lat * Math.PI / 180;
  const deltaLat = latB - latA;
  const deltaLon = (b.lon - a.lon) * Math.PI / 180;
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) *
      Math.sin(deltaLon / 2) ** 2;

  return 2 * EARTH_RADIUS_METRES *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function nameFor(tags) {
  const name = tags?.name;
  if (typeof name !== 'string') {
    return null;
  }

  const normalized = name.trim();
  return normalized || null;
}

function getNameId(tile, name) {
  if (name === null) {
    return 0;
  }

  const existingId = tile.nameIds.get(name);
  if (existingId !== undefined) {
    return existingId;
  }

  const nameId = tile.names.length;
  tile.names.push(name);
  tile.nameIds.set(name, nameId);
  return nameId;
}

function makeTile(tx, tz) {
  return {
    tx,
    tz,
    names: [null],
    nameIds: new Map(),
    roads: []
  };
}

function addOverviewSegment(overview, a, b, classId, name) {
  const nameId = getNameId(overview, name);
  overview.roads.push([
    Math.round(a[0]),
    Math.round(a[1]),
    Math.round(b[0]),
    Math.round(b[1]),
    classId,
    nameId
  ]);
}

function segmentCuts(a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const length = Math.hypot(dx, dz);
  const segmentCount = Math.max(
    1,
    Math.ceil(length / MAX_DETAIL_SEGMENT)
  );
  const cuts = [];

  for (let index = 0; index <= segmentCount; index += 1) {
    cuts.push(index / segmentCount);
  }

  if (dx !== 0) {
    const firstBoundary =
      Math.floor(Math.min(a[0], b[0]) / TILE_SIZE) + 1;
    const lastBoundary =
      Math.floor(Math.max(a[0], b[0]) / TILE_SIZE);

    for (
      let boundary = firstBoundary;
      boundary <= lastBoundary;
      boundary += 1
    ) {
      const t = (boundary * TILE_SIZE - a[0]) / dx;
      if (t > 0 && t < 1) {
        cuts.push(t);
      }
    }
  }

  if (dz !== 0) {
    const firstBoundary =
      Math.floor(Math.min(a[1], b[1]) / TILE_SIZE) + 1;
    const lastBoundary =
      Math.floor(Math.max(a[1], b[1]) / TILE_SIZE);

    for (
      let boundary = firstBoundary;
      boundary <= lastBoundary;
      boundary += 1
    ) {
      const t = (boundary * TILE_SIZE - a[1]) / dz;
      if (t > 0 && t < 1) {
        cuts.push(t);
      }
    }
  }

  cuts.sort((left, right) => left - right);
  return cuts.filter(
    (cut, index) =>
      index === 0 || Math.abs(cut - cuts[index - 1]) > 1e-10
  );
}

function addDetailSegments(tiles, a, b, classId, name) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const cuts = segmentCuts(a, b);

  for (let index = 1; index < cuts.length; index += 1) {
    const startT = cuts[index - 1];
    const endT = cuts[index];
    const midpointT = (startT + endT) / 2;
    const tx = Math.floor((a[0] + dx * midpointT) / TILE_SIZE);
    const tz = Math.floor((a[1] + dz * midpointT) / TILE_SIZE);
    const key = tileKey(tx, tz);
    let tile = tiles.get(key);

    if (!tile) {
      tile = makeTile(tx, tz);
      tiles.set(key, tile);
    }

    const ax = Math.round(a[0] + dx * startT) - tx * TILE_SIZE;
    const az = Math.round(a[1] + dz * startT) - tz * TILE_SIZE;
    const bx = Math.round(a[0] + dx * endT) - tx * TILE_SIZE;
    const bz = Math.round(a[1] + dz * endT) - tz * TILE_SIZE;

    if (ax === bx && az === bz) {
      continue;
    }

    tile.roads.push([
      ax,
      az,
      bx,
      bz,
      classId,
      getNameId(tile, name)
    ]);
  }
}

function nodeIdFor(value, wayId, index) {
  if (
    (typeof value === 'number' && Number.isSafeInteger(value)) ||
    (typeof value === 'string' && /^\d+$/.test(value))
  ) {
    return String(value);
  }

  throw new Error(
    `Way ${wayId} has an invalid OSM node ID at geometry index ${index}`
  );
}

function validatePoint(point, wayId, index) {
  if (
    !Number.isFinite(point?.lat) ||
    !Number.isFinite(point?.lon)
  ) {
    throw new Error(
      `Way ${wayId} has invalid geometry at index ${index}`
    );
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function sortedTileKeys(tiles) {
  return [...tiles.keys()].sort((left, right) => {
    const [leftX, leftZ] = left.split('_').map(Number);
    const [rightX, rightZ] = right.split('_').map(Number);
    return leftX - rightX || leftZ - rightZ;
  });
}

const source = JSON.parse(await fs.readFile(INPUT, 'utf8'));
if (!Array.isArray(source.elements)) {
  throw new Error(`Input file does not contain an elements array: ${INPUT}`);
}

const tiles = new Map();
const overview = {
  names: [null],
  nameIds: new Map(),
  roads: []
};
const graphNodes = Object.create(null);
const graphEdges = [];
let overviewSegments = 0;

for (const way of source.elements) {
  const roadType = way.tags?.highway;
  const classId = ROAD_CLASS_IDS.get(roadType);
  if (classId === undefined) {
    continue;
  }

  if (
    (typeof way.id !== 'number' || !Number.isSafeInteger(way.id)) &&
    (typeof way.id !== 'string' || !/^\d+$/.test(way.id))
  ) {
    throw new Error('A supported road way is missing a valid OSM way ID');
  }
  if (
    !Array.isArray(way.geometry) ||
    way.geometry.length < 2 ||
    !Array.isArray(way.nodes) ||
    way.geometry.length !== way.nodes.length
  ) {
    throw new Error(
      `Way ${way.id} must have matching geometry and OSM node ID arrays`
    );
  }

  const wayId = String(way.id);
  const name = nameFor(way.tags);
  const points = way.geometry;
  const projected = [];
  const nodeIds = [];

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    validatePoint(point, wayId, index);
    projected.push(project(point.lat, point.lon));
    nodeIds.push(nodeIdFor(way.nodes[index], wayId, index));

    const nodeId = nodeIds[index];
    const previousPosition = graphNodes[nodeId];
    if (previousPosition) {
      if (
        Math.abs(previousPosition.lat - point.lat) > 1e-8 ||
        Math.abs(previousPosition.lon - point.lon) > 1e-8
      ) {
        throw new Error(
          `OSM node ${nodeId} has inconsistent coordinates across ways`
        );
      }
    } else {
      graphNodes[nodeId] = {
        lat: point.lat,
        lon: point.lon
      };
    }
  }

  const onewayTag = String(way.tags?.oneway ?? '')
    .trim()
    .toLowerCase();
  const reverse = onewayTag === '-1';
  const oneWay =
    reverse ||
    ['yes', 'true', '1'].includes(onewayTag) ||
    String(way.tags?.junction ?? '').toLowerCase() === 'roundabout';

  for (let index = 1; index < points.length; index += 1) {
    const pointA = points[index - 1];
    const pointB = points[index];
    const projectedA = projected[index - 1];
    const projectedB = projected[index];

    if (OVERVIEW_CLASSES.has(roadType)) {
      addOverviewSegment(
        overview,
        projectedA,
        projectedB,
        classId,
        name
      );
      overviewSegments += 1;
    }

    addDetailSegments(
      tiles,
      projectedA,
      projectedB,
      classId,
      name
    );

    graphEdges.push({
      from: nodeIds[reverse ? index : index - 1],
      to: nodeIds[reverse ? index - 1 : index],
      wayId,
      type: roadType,
      name,
      lengthMeters: Number(metersBetween(pointA, pointB).toFixed(3)),
      oneWay
    });
  }
}

const tileKeys = sortedTileKeys(tiles);
const overviewPayload = {
  names: overview.names,
  roads: overview.roads
};
const overviewJson = JSON.stringify(overviewPayload);
const detailSizes = new Map();
let detailSegments = 0;

await fs.rm(OUTPUT, { recursive: true, force: true });
await fs.mkdir(path.join(OUTPUT, 'tiles'), { recursive: true });
await fs.mkdir(path.dirname(ROUTING_OUTPUT), { recursive: true });

for (const key of tileKeys) {
  const tile = tiles.get(key);
  const json = JSON.stringify({
    names: tile.names,
    roads: tile.roads
  });
  const outputPath = path.join(OUTPUT, 'tiles', `${key}.json`);
  await fs.writeFile(outputPath, json);
  detailSizes.set(key, Buffer.byteLength(json, 'utf8'));
  detailSegments += tile.roads.length;
}

await fs.writeFile(
  path.join(OUTPUT, 'overview.json'),
  overviewJson
);

const routingGraph = {
  version: 1,
  coordinateSystem: 'WGS84',
  nodes: graphNodes,
  edges: graphEdges
};
const routingGraphJson = JSON.stringify(routingGraph);
await fs.writeFile(ROUTING_OUTPUT, routingGraphJson);

const overviewBytes = Buffer.byteLength(overviewJson, 'utf8');
const detailDataBytes = [...detailSizes.values()]
  .reduce((total, size) => total + size, 0);
const routingGraphBytes = Buffer.byteLength(routingGraphJson, 'utf8');
const statistics = {
  inputWays: source.elements.length,
  overviewSegments,
  detailTiles: tileKeys.length,
  detailSegments,
  routingNodes: Object.keys(graphNodes).length,
  routingEdges: graphEdges.length,
  overviewBytes,
  detailDataBytes,
  routingGraphBytes
};

const manifest = {
  version: 1,
  center: CENTER,
  tileSize: TILE_SIZE,
  detailTileKeys: tileKeys,
  detailTilePath: 'tiles/{tx}_{tz}.json',
  roadClasses: ROAD_CLASSES.map((type, id) => ({ id, type })),
  overview: 'overview.json',
  statistics,
  attribution: '\u00A9 OpenStreetMap contributors'
};

await fs.writeFile(
  path.join(OUTPUT, 'manifest.json'),
  JSON.stringify(manifest, null, 2)
);

console.log('');
console.log('CITYVERSE CITY MAP BUILD COMPLETE');
console.log('---------------------------------');
console.log('Input ways:', statistics.inputWays);
console.log('Overview segments:', statistics.overviewSegments);
console.log('Detail tiles:', statistics.detailTiles);
console.log('Detail segments:', statistics.detailSegments);
console.log('Routing nodes:', statistics.routingNodes);
console.log('Routing edges:', statistics.routingEdges);
console.log('Overview file size:', formatBytes(overviewBytes));
console.log('Detail data size:', formatBytes(detailDataBytes));
console.log('Routing graph size:', formatBytes(routingGraphBytes));
console.log('');
