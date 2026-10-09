// Run from the client/ folder:  node scripts/fetch-osm.mjs
// Downloads Ibadan OSM data once and saves it to public/data/district.json
// Keep CENTER and RADIUS the same as in src/main.js
import { mkdir, writeFile } from 'node:fs/promises';

const CENTER = { lat: 7.3962, lon: 3.8968 };
const RADIUS = 450;

const M_LON = 111320, M_LAT = 110540;
const cosLat = Math.cos((CENTER.lat * Math.PI) / 180);
const dLat = RADIUS / M_LAT, dLon = RADIUS / (M_LON * cosLat);
const s = CENTER.lat - dLat, n = CENTER.lat + dLat, w = CENTER.lon - dLon, e = CENTER.lon + dLon;

const query = `[out:json][timeout:90];(way["building"](${s},${w},${n},${e});way["highway"](${s},${w},${n},${e}););out geom;`;

const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let round = 1; round <= 3; round++) {
  for (const url of SERVERS) {
    try {
      console.log(`Round ${round}: ${url}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      await mkdir('public/data', { recursive: true });
      await writeFile('public/data/district.json', JSON.stringify(json));
      const b = json.elements.filter((x) => x.tags?.building).length;
      const r = json.elements.filter((x) => x.tags?.highway).length;
      console.log(`Saved public/data/district.json  (${b} buildings, ${r} roads)`);
      process.exit(0);
    } catch (err) {
      console.log('  failed:', err.message);
    }
  }
  console.log('All servers busy, waiting 15s...');
  await sleep(15000);
}
console.log('Could not download. Use the manual method (Overpass Turbo) instead.');
process.exit(1);
