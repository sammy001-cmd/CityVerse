import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {seedFor} from '../src/world/BuildingRules.js';
import {architecturalLOD,chooseArchetype,interpretBuilding,facadeEdges,entranceFacade,nearestRoadFront,windowLayout,compoundTreatment} from '../src/world/BuildingArchitecture.js';
import {buildBuildingData,buildCollisionPositions} from '../src/world/BuildingMeshData.js';
import {buildingMaterials,buildBuildingGeometry} from '../src/world/BuildingGeometry.js';
import {BuildingOverrideRegistry} from '../src/world/BuildingOverrideRegistry.js';
import {BuildingSystem} from '../src/world/BuildingSystem.js';
const b=(overrides={})=>({id:'way:47',seed:seedFor('way:47'),category:'generic',categorySource:'inferred',height:5.2,levels:1,minHeight:0,
  roof:'hipped',roofSource:'inferred',heightSource:'inferred',tags:{},baseY:1,foundationBottom:0,minX:0,maxX:12,minZ:0,maxZ:8,
  polygons:[[[[0,0],[12,0],[12,8],[0,8]]]],...overrides});
const size=data=>data.geometry.reduce((s,g)=>s+(g?.attributes.position.array.length??0)/9,0);
test('stable ID/seed gives deterministic generic architecture, with restrained low-rise distributions',()=>{
  const source=b(),original=structuredClone(source);
  assert.deepEqual(interpretBuilding(source),interpretBuilding(structuredClone(source)));assert.deepEqual(source,original);
  assert.equal(chooseArchetype(source),'bungalow');assert.equal(interpretBuilding(source).source,'procedural');
  const walls=new Set(),roofs=new Set();for(let i=1;i<=200;i++){const s=interpretBuilding(b({id:`way:${i}`,seed:seedFor(`way:${i}`)}));walls.add(s.wall);roofs.add(s.roof);assert.equal(s.floors,1);}
  assert.ok(walls.size>=7&&walls.size<=9);assert.ok(roofs.size>=4);
  assert.equal(chooseArchetype(b({height:10,levels:3})),'multi_storey');
  for(const [category,expected] of [['warehouse','industrial'],['school','school_block'],['place_of_worship','worship'],['office','office_institutional'],['commercial','roadside_commercial']])assert.equal(chooseArchetype(b({category,categorySource:'explicit'})),expected);
  assert.equal(chooseArchetype(b({seed:7,frontage:{distance:10,roadType:'secondary'}})),'roadside_commercial');
  assert.equal(interpretBuilding(b({seed:7,frontage:{distance:10,roadType:'footway'}})).commercialFront,false);
  assert.equal(interpretBuilding(b({seed:7,frontage:{distance:10,roadType:'secondary'}})).commercialFront,true);
  const roadAbsent=interpretBuilding(b({seed:7})),roadPresent=interpretBuilding(b({seed:7,frontage:{distance:10,roadType:'secondary'}}));
  for(const key of ['archetype','wall','roof','roofColor','floors'])assert.equal(roadAbsent[key],roadPresent[key]);
});
test('LOD thresholds and hysteresis preserve three distinct levels and tighter LOW ranges',()=>{
  assert.equal(architecturalLOD(90),'near');assert.equal(architecturalLOD(96),'medium');assert.equal(architecturalLOD(286),'far');
  assert.equal(architecturalLOD(105,false,'near'),'near');assert.equal(architecturalLOD(114,false,'near'),'medium');
  assert.equal(architecturalLOD(88,false,'medium'),'medium');assert.equal(architecturalLOD(76,false,'medium'),'near');
  assert.equal(architecturalLOD(275,false,'far'),'far');assert.equal(architecturalLOD(266,false,'far'),'medium');
  assert.equal(architecturalLOD(60,true),'medium');assert.equal(architecturalLOD(180,true),'far');
  const costs=['far','medium','near'].map(lod=>size(buildBuildingData([b()],lod)));assert.ok(costs[0]<costs[1]&&costs[1]<costs[2]);
});
test('five roof kits preserve footprint and explicit total height and floor count',()=>{
  for(const roof of ['flat','hipped','gable','pyramidal','shed']){
    const source=b({roof,roofSource:'explicit',height:9.8,levels:3,heightSource:'explicit_levels'}),before=structuredClone(source),data=buildBuildingData([source],'medium');
    assert.equal(data.stats.roofFallbacks,0);assert.deepEqual(source,before);assert.equal(interpretBuilding(source).floors,3);
    const ys=data.geometry.flatMap(g=>g?Array.from(g.attributes.position.array).filter((_,i)=>i%3===1):[]);
    assert.ok(Math.abs(Math.max(...ys)-(source.baseY+source.height))<0.00001);
    assert.ok(Math.min(...ys)<=source.foundationBottom);
    assert.ok(data.stats.roofTriangles>=2);
  }
  const courtyard=b();courtyard.polygons[0].push([[3,2],[9,2],[9,6],[3,6]]);
  const data=buildBuildingData([courtyard],'medium');assert.equal(data.stats.roofFallbacks,1);assert.ok(data.stats.roofTriangles>=8);
});
test('window rhythm respects storeys, wall ends, roof envelope and LOW budgets',()=>{
  const source=b({height:10.2,levels:3,heightSource:'explicit_levels'}),style=interpretBuilding(source),edge=facadeEdges(source.polygons[0][0])[0];
  const windows=windowLayout(edge,style,source,'near');assert.ok(windows.length>0);
  for(const w of windows){assert.ok(w.t-w.width/2>0&&w.t+w.width/2<edge.length);assert.ok(w.y>=source.baseY);assert.ok(w.y+w.height<=source.baseY+style.eaveHeight);}
  assert.deepEqual(windowLayout(edge,style,source,'far'),[]);
  const near=buildBuildingData([source],'near'),low=buildBuildingData([source],'near',{lowPerformance:true});assert.ok(size(low)<size(near));assert.equal(low.stats.balconies,0);assert.equal(low.stats.verandas,0);assert.equal(low.stats.compounds,0);
});
test('road-facing entrance uses facade outward normal without rotating source footprint',()=>{
  const source=b(),before=structuredClone(source.polygons),edge={a:[-10,-10],b:[22,-10],width:5,roadId:99,type:'residential'};
  source.frontage=nearestRoadFront(source,[{...edge,type:'motorway'},edge]);assert.equal(source.frontage.roadType,'residential');
  const front=entranceFacade(source,source.polygons[0][0]);assert.equal(front.index,0);assert.equal(front.roadFacing,true);assert.deepEqual(source.polygons,before);
  const reverse=source.polygons[0][0].slice().reverse(),reversed=entranceFacade(source,reverse);assert.equal(reversed.midpoint[1],0);assert.equal(reversed.roadFacing,true);
  const data=buildBuildingData([source],'near');assert.equal(data.stats.entrances,1);assert.equal(data.stats.roadFacingEntrances,1);
});
test('sloped plinth reaches lowest sample; source height/footprint and collider remain decoration-independent',()=>{
  const source=b({baseY:2,foundationBottom:-1}),data=buildBuildingData([source],'near');assert.equal(data.stats.foundations,1);
  const positions=buildCollisionPositions([source]),ys=Array.from(positions).filter((_,i)=>i%3===1);assert.ok(Math.abs(Math.min(...ys)+1.2)<1e-6);assert.ok(Math.abs(Math.max(...ys)-7.2)<1e-6);
  assert.deepEqual(positions,buildCollisionPositions([{...source,visualLOD:'near'}]));
  assert.equal(compoundTreatment(source),null);
  assert.equal(compoundTreatment({...source,boundary:{source:'inferred',points:[[-2,0],[-2,8]]}}),null);
  assert.ok(compoundTreatment({...source,boundary:{source:'explicit',points:[[-2,0],[-2,8]]}}));
});
test('batching uses two shared materials regardless of number of buildings and no worker Three objects',()=>{
  const records=Array.from({length:100},(_,i)=>b({id:`way:${i+1}`,seed:seedFor(`way:${i+1}`),visualLOD:i<3?'near':i<25?'medium':'far'}));
  const geometry=buildBuildingGeometry(records,'far'),materials=buildingMaterials();assert.equal(geometry.filter(Boolean).length,2);assert.equal(materials.length,2);assert.equal(geometry.buildStats.lodCounts.near,3);
  const text=readFileSync(new URL('../src/world/BuildingWorker.js',import.meta.url),'utf8');assert.doesNotMatch(text,/import.*BuildingGeometry|RoadWorldTransfer|new\s+THREE|from\s+['"]three['"]/);assert.match(text,/transfers/);
  geometry.forEach(g=>g?.dispose());materials.forEach(m=>m.dispose());
});
test('malformed geometry is skipped safely and optional roofs fall back to a valid source cap',()=>{
  const broken=b();broken.polygons[0][0][0]=[NaN,0];const data=buildBuildingData([broken,b()],'near');assert.equal(data.stats.malformedGeometry,1);assert.ok(size(data)>0);
  const concave=b({polygons:[[[[0,0],[12,0],[12,3],[5,3],[5,8],[0,8]]]],roof:'gable',roofSource:'explicit'});
  assert.equal(buildBuildingData([concave],'medium').stats.roofFallbacks,1);
});
test('override registry is empty until explicitly populated and replaces its procedural record',async()=>{
  const registry=new BuildingOverrideRegistry();assert.equal(registry.entries.size,0);assert.throws(()=>registry.register('w47',()=>null));
  const index=JSON.parse(readFileSync(new URL('../public/data/world/regions.json',import.meta.url))),manifest=JSON.parse(readFileSync(new URL('../public/data/world/ibadan/buildings/manifest.json',import.meta.url)));
  registry.register('way:47',()=>{const group=new THREE.Group();group.name='test-custom';return group;});
  const row=['way:47',16,5.2,1,0,2,seedFor('way:47'),0,0,2,[[[[0,0],[120,0],[120,80],[0,80]]]],[]];
  const system=await new BuildingSystem({scene:new THREE.Scene(),worldSurface:{heightAt:()=>0},worker:false,overrides:registry,fetcher:async url=>({ok:true,json:async()=>url.endsWith('regions.json')?index:url.endsWith('manifest.json')?{...manifest,tiles:['0_0']}:{tx:0,tz:0,strings:[null],buildings:[row]}})}).init();
  await system.update(0,0);const tile=system.loaded.get('0_0');assert.equal(tile.group.children.length,1);assert.equal(tile.group.children[0].name,'test-custom');assert.equal(tile.buildStats.lodCounts.near,0);assert.equal(system.getStats().triangles,0);system.dispose();
});

test('dense tile detail stays bounded and LOW disables optional architecture first',()=>{
  const records=Array.from({length:381},(_,i)=>b({id:`way:${i+1}`,seed:seedFor(`way:${i+1}`),visualLOD:i<12?'near':i<90?'medium':'far'}));
  const normal=buildBuildingData(records,'far'),low=buildBuildingData(records,'far',{lowPerformance:true});
  assert.equal(normal.stats.lodCounts.near,12);
  assert.equal(normal.stats.lodCounts.far,291);
  assert.ok(size(normal)<20000);
  assert.ok(size(low)<size(normal));
  assert.equal(low.geometry.filter(Boolean).length,2);
  assert.equal(low.stats.balconies+low.stats.verandas+low.stats.compounds,0);
  assert.equal(normal.stats.wallTriangles+normal.stats.roofTriangles+normal.stats.windowTriangles+normal.stats.detailTriangles,size(normal));
});
