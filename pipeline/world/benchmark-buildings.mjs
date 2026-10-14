// Phase A data audit. This deliberately imports no rendering or physics systems.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {FIELDS,CATEGORIES,ROOFS,HEIGHT_SOURCES,TAGS,seedFor} from './building-data.mjs';

import {loadCity,parseCityArgs,regionPaths,PROJECTION} from './city-config.mjs';
const city=await loadCity(parseCityArgs()),output=regionPaths(city).output;
const manifestData=await fs.readFile(path.join(output,'manifest.json'));
const manifest=JSON.parse(manifestData);
assert.equal(manifest.schemaVersion,2);
assert.equal(manifest.region,city.slug);assert.equal(manifest.projection.id,PROJECTION.id);
const seen=new Set(),sizes=[];let bytes=0;
for(const key of manifest.tiles) {
  assert.match(key,/^-?\d+_-?\d+$/);
  const data=await fs.readFile(path.join(output,'tiles',`${key}.json`)),tile=JSON.parse(data);
  assert.equal(`${tile.tx}_${tile.tz}`,key);
  assert.equal(tile.strings[0],null);
  bytes+=data.byteLength;sizes.push({key,buildings:tile.buildings.length,bytes:data.byteLength});
  for(const row of tile.buildings) {
    assert.equal(row.length,FIELDS.length);assert.match(row[0],/^(way|relation):[1-9]\d*$/);
    assert.ok(!seen.has(row[0]),`Duplicate building ${row[0]}`);seen.add(row[0]);
    assert.ok(CATEGORIES[row[1]]);assert.ok(Number.isFinite(row[2])&&row[2]>0&&row[2]<=300);
    assert.ok(Number.isFinite(row[3])&&row[3]>0);assert.ok(row[4]>=0&&row[4]<row[2]);
    assert.ok(ROOFS[row[5]]);assert.equal(row[6],seedFor(row[0]));
    assert.ok(Number.isInteger(row[7])&&row[7]>=0&&row[7]<tile.strings.length);
    assert.ok(Number.isInteger(row[8])&&row[8]>=0&&row[8]<=15);assert.ok(HEIGHT_SOURCES[row[9]]);
    assert.ok(row[10].length>0);
    for(const polygon of row[10]) {
      assert.ok(polygon.length>0);
      for(const ring of polygon) {
        assert.ok(ring.length>=3);
        for(const point of ring)assert.ok(point.length===2&&point.every(Number.isSafeInteger));
      }
    }
    assert.equal(row[11].length%2,0);
    for(let i=0;i<row[11].length;i+=2) {
      assert.ok(TAGS[row[11][i]]);assert.ok(row[11][i+1]>0&&row[11][i+1]<tile.strings.length);
    }
  }
}
assert.equal(seen.size,manifest.buildingCount);assert.equal(sizes.length,manifest.tileCount);
assert.equal(bytes,manifest.stats.rawTileBytes);
const diskFiles=(await fs.readdir(path.join(output,'tiles'))).filter(file=>file.endsWith('.json'));
assert.equal(diskFiles.length,manifest.tileCount,'Stale generated tiles');
sizes.sort((a,b)=>b.bytes-a.bytes||a.key.localeCompare(b.key));
console.log(JSON.stringify({region:city.slug,audit:'All generated compact building records validated; no renderer initialized',
  buildings:seen.size,tiles:sizes.length,rawTileBytes:bytes,manifestBytes:manifestData.byteLength,
  totalClientBytes:bytes+manifestData.byteLength,averageTileBytes:Math.round(bytes/sizes.length),
  maximumBuildingsInOneTile:sizes.reduce((max,t)=>Math.max(max,t.buildings),0),largestTiles:sizes.slice(0,10)},null,2));
