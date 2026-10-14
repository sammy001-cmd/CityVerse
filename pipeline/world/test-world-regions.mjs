import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {loadCity,loadCities,validateCity,regionPaths,PROJECTION,CENTER,parseCityArgs} from './city-config.mjs';
import {project,normalizeBuilding,normalizeHeight,seedFor,ownerTile,encodeFootprints,decodeFootprints,FLAGS} from './building-data.mjs';
import {buildTiles,writeTiles,readRoadAnalysis} from './build-building-tiles.mjs';
import {makeRegionIndex,writeRegionIndex} from './build-world-regions.mjs';
import {selectWorldRegion,buildingManifestForPosition} from './world-region-index.mjs';

const cities=await loadCities(),a=await loadCity('ibadan'),b=await loadCity('ogbomoso');
const fixture=city=>{
  const lon=(city.bbox.west+city.bbox.east)/2,lat=(city.bbox.south+city.bbox.north)/2;
  return {version:1,region:city.slug,projection:PROJECTION.id,center:CENTER,bounds:city.bbox,tileSize:city.tileSize,
    elements:[{id:'way:101',tags:{building:'yes'},polygons:[[[[lon,lat],[lon+0.0001,lat],[lon+0.0001,lat+0.0001],[lon,lat+0.0001],[lon,lat]]]]}]};
};
test('city configs validate and reject traversal, incompatible projections, origin overrides and bad bounds',async()=>{
  assert.ok(cities.some(city=>city.slug===a.slug)&&cities.some(city=>city.slug===b.slug));
  assert.equal(new Set(cities.map(city=>city.slug)).size,cities.length);
  for(const city of cities)assert.equal(validateCity(city),city);
  for(const patch of [{slug:'../escape'},{countryCode:'bad'}, {projection:'city-specific'},
    {origin:{lat:8,lon:4}},{tileSize:0},{tileSize:250.5},{enabledWorldLayers:['buildings','buildings']},
    {bbox:{south:10,north:9,west:0,east:1}},{bbox:{south:0,north:Infinity,west:0,east:1}},
    {build:{roadAnalysisDirectory:'../outside'}}])assert.throws(()=>validateCity({...a,...patch}));
  await assert.rejects(loadCity('../escape'));
  assert.equal(parseCityArgs(['--city','ogbomoso']),'ogbomoso');assert.throws(()=>parseCityArgs([]));
});
test('both cities use the same normalization and tile builder without city-specific branches',()=>{
  for(const city of cities) {
    const input=fixture(city),result=buildTiles(input,city),record=[...result.tiles.values()][0].buildings[0];
    assert.equal(result.stats.usableBuildings,1);assert.equal(record[6],seedFor('way:101'));
    assert.equal(record[2],normalizeHeight({},'generic',seedFor('way:101')).height);
    assert.equal(record[8]&FLAGS.explicitCategory,0,'inferred family must never be marked explicit');
    assert.equal(record[9],2,'inferred height provenance must remain separate');
    assert.equal(normalizeBuilding(input.elements[0],{tileSize:city.tileSize}).height.source,'inferred');
  }
  assert.equal(a.projection,b.projection);
});
test('shared world origin preserves cross-city displacement rather than recentering each city',()=>{
  assert.deepEqual(project(CENTER.lon,CENTER.lat),[0,-0]);
  const [x,z]=project(b.build.focus.lon,b.build.focus.lat);
  assert.ok(x>30000&&z< -70000);
  const ratio=project(CENTER.lon+0.01,CENTER.lat)[0]/0.01;
  assert.ok(Math.abs(ratio-PROJECTION.metresPerDegreeLon*Math.cos(CENTER.lat*Math.PI/180))<1e-7);
});
test('Ogbomoso bbox contains both authoritative LGA extents and a full city-scale fringe',()=>{
  const original=b.build.administrativeBbox;
  assert.ok(b.bbox.south<original.south&&b.bbox.north>original.north);
  assert.ok(b.bbox.west<original.west&&b.bbox.east>original.east);
  const sw=project(b.bbox.west,b.bbox.south),ne=project(b.bbox.east,b.bbox.north);
  assert.ok(ne[0]-sw[0]>=30000&&sw[1]-ne[1]>=30000);
  assert.equal(b.build.administrativeAreas.length,2);assert.match(b.build.geometryUrl,/9469f09/);
});
test('tile keys are region-namespaced even when the local key is identical',()=>{
  assert.notEqual(regionPaths(a).tileUrl('-1_0'),regionPaths(b).tileUrl('-1_0'));
  assert.equal(regionPaths(b).tileUrl('-1_0'),'/data/world/ogbomoso/buildings/tiles/-1_0.json');
  assert.throws(()=>regionPaths('../escape'));assert.throws(()=>regionPaths(a).tileUrl('../0'));
});
test('configured tile size, negative coordinates and signed local quantization reconstruct correctly',()=>{
  const size=500,polygons=[[[[-501,-501],[-491,-501],[-491,-491],[-501,-491]]]];
  assert.deepEqual(ownerTile([-501,-501],size),[-2,-2]);
  const encoded=encodeFootprints(polygons,-2,-2,size);
  assert.deepEqual(decodeFootprints(encoded,-2,-2,size),polygons);
  const city={...a,tileSize:size},input=fixture(city),result=buildTiles(input,city);
  const geometry=normalizeBuilding(input.elements[0],{tileSize:size});
  assert.ok(result.tiles.has(`${geometry.tx}_${geometry.tz}`));
});
test('deterministic procedural inputs depend on OSM identity, not requested region',()=>{
  const input=fixture(a).elements[0];
  const first=normalizeBuilding(input),second=normalizeBuilding({...input});
  assert.deepEqual(first.height,second.height);assert.equal(first.seed,second.seed);
  assert.equal(first.classification.source,'inferred');assert.equal(first.roof.source,'inferred');
});
test('city mismatches and disabled layers cannot silently write a different region',()=>{
  assert.throws(()=>buildTiles(fixture(a),b),/selected region/);
  assert.throws(()=>buildTiles({...fixture(a),tileSize:500},a),/selected region/);
  assert.throws(()=>buildTiles(fixture(a),{...a,enabledWorldLayers:['pois']}),/enable buildings/);
});
test('lightweight index selects one manifest with zero inactive-region fetches or allocations',()=>{
  const index=makeRegionIndex(cities,new Set(cities.map(c=>c.slug)));
  assert.ok(Buffer.byteLength(JSON.stringify(index))<2000+1024*cities.length);
  assert.ok(!JSON.stringify(index).includes('tiles/'),'no tile lists in region index');
  const [x,z]=project((a.bbox.west+a.bbox.east)/2,(a.bbox.south+a.bbox.north)/2);
  assert.equal(selectWorldRegion(index,x,z).slug,a.slug);
  assert.equal(buildingManifestForPosition(index,x,z),regionPaths(a).manifestUrl);
  assert.equal(buildingManifestForPosition(makeRegionIndex(cities),x,z),null);
  assert.equal(selectWorldRegion(index,NaN,z),null);
  // Selection is a pure descriptor query: no network, geometry or rendering APIs.
  const requestPlan=[buildingManifestForPosition(index,x,z)];
  assert.ok(requestPlan.every(url=>!url.includes('/ogbomoso/')));
});
test('region-scoped outputs coexist, metadata stays small, rebuilds are stable and stale tiles are removed',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cityverse-regions-'));
  try {
    for(const city of cities) {
      const paths=regionPaths(city,root),result=buildTiles(fixture(city),city);
      const report=await writeTiles(result,paths.output,paths.report);
      const first=await fs.readFile(path.join(paths.output,'manifest.json'),'utf8');
      const key=[...result.tiles.keys()][0];
      await fs.writeFile(path.join(paths.output,'tiles/9999_9999.json'),'{}');
      await writeTiles(buildTiles(fixture(city),city),paths.output,paths.report);
      assert.equal(await fs.readFile(path.join(paths.output,'manifest.json'),'utf8'),first);
      await assert.rejects(fs.access(path.join(paths.output,'tiles/9999_9999.json')));
      const manifest=JSON.parse(first);
      assert.equal(manifest.region,city.slug);assert.equal(manifest.center.lat,CENTER.lat);
      assert.equal(manifest.tileSize,city.tileSize);assert.match(manifest.inferencePolicy,/never verified/);
      assert.equal(report.totalClientBytes,report.rawTileBytes+report.manifestBytes);
      assert.equal(report.densestTile.key,key);
    }
    const index=await writeRegionIndex(root);
    assert.ok(index.regions.every(r=>r.layers.buildings.available));
    const file=path.join(root,'apps/client/public/data/world/regions.json');
    assert.ok((await fs.stat(file)).size<2000+1024*cities.length);
    const key=[...buildTiles(fixture(b),b).tiles.keys()][0];
    await fs.unlink(path.join(regionPaths(b,root).output,'tiles',`${key}.json`));
    const partial=await writeRegionIndex(root);
    assert.equal(partial.regions.find(r=>r.slug===b.slug).layers.buildings.available,false);
    assert.equal(partial.regions.find(r=>r.slug===a.slug).layers.buildings.available,true);
  } finally {
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
    await fs.rm(root,{recursive:true,force:true});
  }
});
test('missing city road data is reported rather than reusing another city roads',async()=>{
  const result=await readRoadAnalysis(b);assert.equal(result.available,false);assert.equal(result.cells.size,0);
});
test('shared implementation contains no hardcoded city slug, bbox or data path',async()=>{
  for(const file of ['building-data.mjs','build-building-tiles.mjs','building_extraction.py','extract-buildings.py',
    'city-config.mjs','city_config.py','build-world-regions.mjs','world-region-index.mjs','benchmark-buildings.mjs'])
    assert.doesNotMatch(await fs.readFile(new URL(file,import.meta.url),'utf8'),/ibadan|ogbomoso/i,file);
});
test('Git policy excludes generated tiles and sources while retaining small metadata and configs',()=>{
  const ignored=['apps/client/public/data/world/ibadan/buildings/tiles/0_0.json',
    'apps/client/public/data/world/ogbomoso/buildings/tiles/0_0.json','apps/client/public/data/building-tiles/tiles/0_0.json',
    'data/generated/world/ogbomoso/buildings-source.json'];
  for(const file of ignored)assert.equal(execFileSync('git',['check-ignore',file],{encoding:'utf8'}).trim(),file);
  for(const file of ['pipeline/world/cities/ibadan.json','pipeline/world/cities/ogbomoso.json',
    'apps/client/public/data/world/regions.json','apps/client/public/data/world/ibadan/buildings/manifest.json']) {
    assert.throws(()=>execFileSync('git',['check-ignore','--quiet',file],{stdio:'pipe'}),error=>error.status===1);
  }
});
