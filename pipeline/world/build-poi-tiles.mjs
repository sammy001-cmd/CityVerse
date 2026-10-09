import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);

const ROOT =
  path.resolve(
    __dirname,
    '../..'
  );

const INPUT =
  path.join(
    ROOT,
    'apps/client/public/data/poi-source.json'
  );

const OUTPUT =
  path.join(
    ROOT,
    'apps/client/public/data/poi-tiles'
  );

const CENTER = {
  lat: 7.3962,
  lon: 3.8968
};

const TILE_SIZE = 250;

const M_LON = 111320;
const M_LAT = 110540;

const cosLat =
  Math.cos(
    CENTER.lat *
    Math.PI /
    180
  );


function project(lat, lon) {
  return [
    (lon - CENTER.lon) *
      M_LON *
      cosLat,

    -(lat - CENTER.lat) *
      M_LAT
  ];
}


function tileFor(x, z) {
  return [
    Math.floor(
      x / TILE_SIZE
    ),

    Math.floor(
      z / TILE_SIZE
    )
  ];
}


function tileKey(tx, tz) {
  return `${tx}_${tz}`;
}


function positionFor(element) {
  if (
    Number.isFinite(element.lat) &&
    Number.isFinite(element.lon)
  ) {
    return {
      lat: element.lat,
      lon: element.lon
    };
  }

  if (
    Number.isFinite(element.center?.lat) &&
    Number.isFinite(element.center?.lon)
  ) {
    return {
      lat: element.center.lat,
      lon: element.center.lon
    };
  }

  if (element.bounds) {
    return {
      lat:
        (
          element.bounds.minlat +
          element.bounds.maxlat
        ) / 2,

      lon:
        (
          element.bounds.minlon +
          element.bounds.maxlon
        ) / 2
    };
  }

  return null;
}


function categoryFor(tags = {}) {
  if (
    tags.amenity === 'hospital' ||
    tags.healthcare === 'hospital'
  ) {
    return 'hospital';
  }

  if (
    tags.amenity === 'clinic' ||
    tags.healthcare === 'clinic'
  ) {
    return 'clinic';
  }

  if (
    tags.amenity === 'pharmacy' ||
    tags.healthcare === 'pharmacy'
  ) {
    return 'pharmacy';
  }

  if (
    tags.shop === 'mall' ||
    tags.shop === 'department_store'
  ) {
    return 'mall';
  }

  if (
    tags.shop === 'supermarket'
  ) {
    return 'supermarket';
  }

  if (tags.shop) {
    return 'shop';
  }

  if (
    tags.tourism === 'hotel' ||
    tags.tourism === 'guest_house' ||
    tags.tourism === 'hostel'
  ) {
    return 'hotel';
  }

  if (
    tags.amenity === 'restaurant' ||
    tags.amenity === 'fast_food' ||
    tags.amenity === 'cafe'
  ) {
    return 'food';
  }

  if (tags.amenity === 'bank') {
    return 'bank';
  }

  if (tags.amenity === 'atm') {
    return 'atm';
  }

  if (tags.amenity === 'fuel') {
    return 'fuel';
  }

  if (
    tags.amenity === 'school'
  ) {
    return 'school';
  }

  if (
    tags.amenity === 'university' ||
    tags.amenity === 'college'
  ) {
    return 'university';
  }

  if (tags.amenity === 'police') {
    return 'police';
  }

  if (
    tags.amenity === 'fire_station'
  ) {
    return 'fire_station';
  }

  if (
    tags.amenity === 'cinema' ||
    tags.amenity === 'theatre'
  ) {
    return 'entertainment';
  }

  if (
    tags.leisure === 'park' ||
    tags.leisure === 'garden'
  ) {
    return 'park';
  }

  if (
    tags.leisure === 'stadium' ||
    tags.leisure === 'sports_centre'
  ) {
    return 'sports';
  }

  if (
    tags.public_transport ||
    tags.railway === 'station' ||
    tags.amenity === 'bus_station'
  ) {
    return 'transport';
  }

  if (
    tags.amenity === 'place_of_worship'
  ) {
    return 'place_of_worship';
  }

  if (
    tags.tourism === 'attraction' ||
    tags.historic ||
    tags.tourism === 'museum'
  ) {
    return 'landmark';
  }

  if (
    tags.office === 'government' ||
    tags.amenity === 'townhall' ||
    tags.amenity === 'courthouse'
  ) {
    return 'government';
  }

  if (tags.tourism) {
    return 'tourism';
  }

  if (tags.office) {
    return 'office';
  }

  if (tags.leisure) {
    return 'leisure';
  }

  return 'other';
}


function addressFor(tags = {}) {
  return [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:suburb'],
    tags['addr:city']
  ]
    .filter(Boolean)
    .join(', ');
}


const source =
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

const allPOIs = [];

const dedupe =
  new Set();


for (
  const element
  of source.elements ?? []
) {
  const tags =
    element.tags ?? {};

  const name =
    tags.name ||
    tags.brand ||
    tags.operator;

  if (!name) {
    continue;
  }

  const position =
    positionFor(element);

  if (!position) {
    continue;
  }

  const category =
    categoryFor(tags);

  if (category === 'other') {
    continue;
  }

  const [x, z] =
    project(
      position.lat,
      position.lon
    );

  const key =
    [
      name
        .trim()
        .toLowerCase(),

      category,

      position.lat.toFixed(5),

      position.lon.toFixed(5)
    ].join('|');

  if (dedupe.has(key)) {
    continue;
  }

  dedupe.add(key);

  const poi = {
    id:
      `osm:${element.type}:${element.id}`,

    name,

    category,

    x,
    z,

    lat:
      position.lat,

    lon:
      position.lon,

    address:
      addressFor(tags) || null,

    phone:
      tags.phone ||
      tags['contact:phone'] ||
      null,

    website:
      tags.website ||
      tags['contact:website'] ||
      null,

    openingHours:
      tags.opening_hours ||
      null,

    brand:
      tags.brand ||
      null,

    source: {
      provider:
        'OpenStreetMap',

      type:
        element.type,

      id:
        element.id
    }
  };

  allPOIs.push(poi);

  const [tx, tz] =
    tileFor(x, z);

  const tile =
    tileKey(tx, tz);

  if (!tiles.has(tile)) {
    tiles.set(
      tile,
      {
        tx,
        tz,
        pois: []
      }
    );
  }

  tiles
    .get(tile)
    .pois
    .push(poi);
}


for (
  const [key, tile]
  of tiles
) {
  await fs.writeFile(
    path.join(
      OUTPUT,
      `${key}.json`
    ),

    JSON.stringify(tile)
  );
}


const categories = {};

for (const poi of allPOIs) {
  categories[poi.category] =
    (
      categories[poi.category] ??
      0
    ) + 1;
}


const manifest = {
  version: 1,

  center:
    CENTER,

  tileSize:
    TILE_SIZE,

  tiles:
    [...tiles.keys()],

  count:
    allPOIs.length,

  categories,

  attribution:
    '© OpenStreetMap contributors'
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
console.log('CITYVERSE POI BUILD COMPLETE');
console.log('----------------------------');
console.log('POIs:', allPOIs.length);
console.log('Tiles:', tiles.size);
console.log('Categories:', categories);
console.log('');