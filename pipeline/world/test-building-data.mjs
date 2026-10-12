import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CENTER,CATEGORIES,ROOFS,TAGS,project,seedFor,classify,metres,normalizeHeight,
  normalizeRoof,cleanRing,signedArea,cleanPolygons,ringCentroid,ownerTile,encodeFootprints,
  decodeFootprints,normalizeBuilding,roadOverlapRatio} from './building-data.mjs';
import {buildTiles as generateTiles,writeTiles} from './build-building-tiles.mjs';
import {loadCity,PROJECTION} from './city-config.mjs';
const CITY=await loadCity('ibadan'), BOUNDS=CITY.bbox;
const buildTiles=(source,roads)=>generateTiles(source,CITY,roads);

const square=(x=0,z=0,size=10)=>[[x,z],[x+size,z],[x+size,z+size],[x,z+size]];
const lonLat=([x,z])=>[CENTER.lon+x/(111320*Math.cos(CENTER.lat*Math.PI/180)),CENTER.lat-z/110540];
const building=(id='way:1',ring=square(),tags={building:'yes'})=>({id,tags,polygons:[[ring.map(lonLat)]]});
const source=elements=>({version:1,region:CITY.slug,projection:PROJECTION.id,tileSize:CITY.tileSize,center:CENTER,bounds:BOUNDS,elements});

test('CityVerse projection matches road and POI convention, including negative tiles',()=>{
  assert.deepEqual(project(CENTER.lon,CENTER.lat),[0,-0]);
  const [x,z]=project(CENTER.lon-0.001,CENTER.lat+0.001);
  assert.ok(x<0&&z<0);assert.ok(Math.abs(z+110.54)<1e-8);
  assert.deepEqual(ownerTile([x,z]),[-1,-1]);
  assert.deepEqual(ownerTile([-250,-250]),[-1,-1]);assert.deepEqual(ownerTile([-250.01,-250.01]),[-2,-2]);
});
test('coordinate constants agree with authoritative pipeline files',async()=>{
  for(const file of ['build-city-map-tiles.mjs','build-poi-tiles.mjs','extract-ibadan-roads.py']) {
    const text=await fs.readFile(new URL(file,import.meta.url),'utf8');
    assert.match(text,/7\.3962/);assert.match(text,/3\.8968/);
  }
  const road=await fs.readFile(new URL('extract-ibadan-roads.py',import.meta.url),'utf8');
  for(const value of Object.values(BOUNDS))assert.ok(road.includes(String(value)));
});
test('cleanup removes closing and consecutive duplicates without altering footprint',()=>{
  const ring=square(),cleaned=cleanRing([ring[0],ring[0],...ring.slice(1),ring[0]]);
  assert.deepEqual(cleaned.ring,ring);assert.equal(signedArea(cleaned.ring),100);
  assert.deepEqual(ringCentroid(ring),[5,5]);assert.deepEqual(ringCentroid([...ring].reverse()),[5,5]);
});
test('malformed, nonfinite, self-touching and self-crossing geometry is rejected with reasons',()=>{
  assert.equal(cleanRing([[0,0],[1,1],[0,0]]).reason,'fewer_than_three_vertices');
  assert.equal(cleanRing([[NaN,0],[1,0],[0,1]]).reason,'nonfinite_coordinate');
  assert.equal(cleanRing([[Infinity,0],[1,0],[0,1]]).reason,'nonfinite_coordinate');
  assert.equal(cleanRing([[0,0],[10,10],[0,10],[10,0]]).reason,'self_intersection');
  assert.equal(cleanRing([[0,0],[10,0],[10,10],[5,0],[0,10]]).reason,'self_intersection');
  assert.equal(normalizeBuilding({id:'way:1',tags:{building:'yes'}}).reason,'malformed_polygons');
  assert.equal(normalizeBuilding(building('w1')).reason,'invalid_source_identity');
});
test('tiny corrupt footprints rejected, large valid complex polygons retained and flagged',()=>{
  assert.equal(cleanPolygons([[square(0,0,0.5)]]).reason,'tiny_footprint');
  const large=cleanPolygons([[square(0,0,400)]]);assert.equal(large.area,160000);assert.ok(large.large);
  assert.equal(cleanPolygons([[square(0,0,3000)]]).reason,'implausible_footprint');
  const many=Array.from({length:600},(_,i)=>[100*Math.cos(i/600*Math.PI*2),100*Math.sin(i/600*Math.PI*2)]);
  assert.ok(cleanPolygons([[many]]).polygons,'valid complex rings must not have an arbitrary vertex cap');
});
test('holes preserve net area and area-weighted centroid, overlapping holes are rejected',()=>{
  const geometry=cleanPolygons([[square(0,0,20),square(1,1,2)]]);
  assert.equal(geometry.area,396);assert.ok(geometry.centroid[0]>10);
  assert.equal(cleanPolygons([[square(),square(8,8,5)]]).reason,'invalid_hole');
  assert.equal(cleanPolygons([[square(),square(1,1,4),square(3,3,4)]]).reason,'overlapping_holes');
  assert.equal(cleanPolygons([[square()],[square(5,5)]]).reason,'overlapping_polygon_parts');
});
test('multipolygon ownership weights all outer rings and holes rather than vertex counts',()=>{
  const geometry=cleanPolygons([[square(-400,0,10)],[square(260,0,100)]]);
  assert.deepEqual(ownerTile(geometry.centroid),[1,0]);
});
test('tile-local decimetres round-trip negative and crossing-tile geometry once',()=>{
  const polygons=[[square(-251,-1,10)]],local=encodeFootprints(polygons,-1,0);
  assert.deepEqual(decodeFootprints(local,-1,0),polygons);assert.equal(local[0][0][0][0],-10);
  const result=buildTiles(source([building('way:1',square(-251,-1,10))]));
  assert.equal(result.tiles.size,1);assert.equal(result.stats.usableBuildings,1);
});
test('category classifier respects explicit semantics and marks unknown classification inferred',()=>{
  for(const [tags,expected] of [[{amenity:'hospital'},'hospital'],[{amenity:'clinic'},'clinic'],
    [{amenity:'school'},'school'],[{amenity:'university'},'university'],[{office:'yes'},'office'],
    [{shop:'supermarket'},'commercial'],[{tourism:'hotel'},'hotel'],[{amenity:'place_of_worship'},'place_of_worship'],
    [{building:'warehouse'},'warehouse'],[{building:'parking'},'parking_structure'],
    [{building:'apartments',shop:'yes'},'mixed_use'],[{building:'church',amenity:'hospital'},'hospital']])
    assert.deepEqual(classify(tags),{category:expected,source:'explicit'});
  assert.deepEqual(classify({building:'yes',office:'no',shop:'no'}),{category:'generic',source:'inferred'});
  assert.equal(classify({building:'yes',healthcare:'pharmacy'}).category,'generic');
  assert.equal(classify({building:'constructor',amenity:'__proto__'}).category,'generic');
});
test('metres, decimal height and feet parsing reject garbage and excessive heights',()=>{
  for(const [value,expected] of [['12',12],['12 m',12],['12.5',12.5],['40 ft',12.192],['40 feet',12.192]])
    assert.equal(metres(value),expected);
  for(const value of ['NaN','Infinity','-1','tall','12;14','301 m',''])assert.equal(metres(value),null);
});
test('explicit height wins, levels use realistic family floors, inferred values are deterministic',()=>{
  assert.equal(normalizeHeight({height:'40 ft','building:levels':'2'},'office',7).source,'explicit_height');
  assert.equal(normalizeHeight({height:'40 ft'},'office',7).height,12.2);
  assert.equal(normalizeHeight({'building:levels':'2'},'residential_low',7).height,6.2);
  assert.equal(normalizeHeight({'building:levels':'2'},'office',7).height,7.2);
  assert.equal(normalizeHeight({'building:levels':'2'},'office',7).source,'explicit_levels');
  const seed=seedFor('way:123');assert.deepEqual(normalizeHeight({},'generic',seed),normalizeHeight({},'generic',seed));
  assert.ok(normalizeHeight({},'generic',seed).height<5);
  assert.ok(normalizeHeight({height:'invalid','building:levels':'no'},'generic',seed).warnings.length===2);
  assert.equal(normalizeHeight({'building:levels':'4','building:min_level':'1'},'office').minHeight,3.6);
});
test('identity seeds are stable, source type distinguished and no runtime randomness needed',()=>{
  assert.equal(seedFor('way:123'),seedFor('way:123'));assert.notEqual(seedFor('way:123'),seedFor('relation:123'));
  assert.ok(Number.isInteger(seedFor('way:1'))&&seedFor('way:1')>=0);
});
test('roof aliases preserve explicit information and fallback is family-appropriate and stable',()=>{
  for(const [shape,expected] of [['gabled','gable'],['hipped','hipped'],['pyramidal','pyramidal'],['skillion','shed'],['dome','other']])
    assert.deepEqual(normalizeRoof({'roof:shape':shape}),{shape:expected,source:'explicit'});
  assert.equal(normalizeRoof({},'office',3,7).shape,'flat');assert.equal(normalizeRoof({},'warehouse',1,7).shape,'gable');
  assert.deepEqual(normalizeRoof({},'generic',1,7),normalizeRoof({},'generic',1,7));
  assert.equal(normalizeRoof({'roof:shape':'constructor'}).shape,'other');
  assert.equal(normalizeRoof({'roof:shape':123}).source,'inferred');
});
test('validated relations suppress tagged members; broken relations do not suppress real ways',()=>{
  const way=building('way:10'),relation={...building('relation:20'),members:[10]};
  const valid=buildTiles(source([way,relation]));assert.equal(valid.stats.usableBuildings,1);
  assert.equal(valid.stats.acceptedRelations,1);assert.equal(valid.stats.deduplicatedMemberWays,1);
  const invalid=buildTiles(source([way,{...relation,polygons:[]} ]));assert.equal(invalid.stats.acceptedWays,1);
  assert.equal(invalid.stats.deferredRelations,1);assert.equal(invalid.rejections[0].reason,'missing_polygons');
});
test('duplicate identities and quantization collapse cannot create fake buildings',()=>{
  const e=building();assert.equal(buildTiles(source([e,e])).stats.duplicateIdentities,1);
  const thin=building('way:2',[[0,0],[100,0],[100,0.01],[0,0.01]]);
  assert.match(normalizeBuilding(thin).reason,/quantization_/);
});
test('road overlap is analysis only and courtyard roads do not count as solid footprint',()=>{
  const geometry=cleanPolygons([[square()]]),edge={a:[-1,5],b:[11,5],width:4};
  assert.ok(Math.abs(roadOverlapRatio(geometry,[edge])-0.4)<1e-8);
  const courtyard=cleanPolygons([[square(),square(2,2,6)]]);
  assert.equal(roadOverlapRatio(courtyard,[{a:[3,5],b:[7,5],width:1}]),0);
  const original=building(),roadCells=new Map([['0_0',[edge]]]);
  const result=buildTiles(source([original]),{available:true,cells:roadCells,edgeCount:1,tileCount:1});
  assert.equal(result.stats.roadAnalysis.heavyConflicts,1);
  assert.deepEqual([...result.tiles.values()][0].buildings[0][10],normalizeBuilding(original).local);
});
test('compact schema, approved sparse tags, stats and repeated builds are deterministic',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cityverse-building-test-'));
  try {
    const e=building('way:5',square(),{building:'house',name:'House',height:'12 m','addr:street':'Main',source:'omit'});
    const result=buildTiles(source([e]));
    const report=await writeTiles(result,path.join(directory,'public'),path.join(directory,'report.json'));
    const first=await fs.readFile(path.join(directory,'public/tiles/0_0.json'),'utf8');
    await writeTiles(buildTiles(source([e])),path.join(directory,'public'),path.join(directory,'report.json'));
    assert.equal(await fs.readFile(path.join(directory,'public/tiles/0_0.json'),'utf8'),first);
    const tile=JSON.parse(first),row=tile.buildings[0];
    assert.equal(tile.strings[row[7]],'House');assert.equal(CATEGORIES[row[1]],'residential_low');
    assert.ok(ROOFS[row[5]]);assert.ok(row[11].includes(TAGS.indexOf('addr:street')));
    assert.ok(!tile.strings.includes('omit'));assert.equal(report.totalClientBytes,report.rawTileBytes+report.manifestBytes);
    const manifest=JSON.parse(await fs.readFile(path.join(directory,'public/manifest.json'),'utf8'));
    assert.equal(manifest.schemaVersion,2);assert.equal(manifest.buildingCount,1);
    assert.equal(manifest.attribution,'© OpenStreetMap contributors');assert.equal(manifest.fields.length,row.length);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
    await fs.rm(directory,{recursive:true,force:true});
  }
});
test('wrong coordinate origin or bounds aborts the data build',()=>{
  assert.throws(()=>buildTiles({...source([]),center:{lat:0,lon:0}}),/authoritative/);
  assert.throws(()=>buildTiles({...source([]),bounds:{...BOUNDS,east:5}}),/authoritative/);
});
test('Client has no raw-source dependency',async()=>{
  const main=await fs.readFile(new URL('../../apps/client/src/main.js',import.meta.url),'utf8');
  assert.doesNotMatch(main,/nigeria-latest\.osm\.pbf|ibadan-buildings-source/);
  assert.match(main,/buildBuildings\(/);assert.match(main,/physics\.addBuildings\(/);
});
