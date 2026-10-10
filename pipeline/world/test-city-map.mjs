import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { POIManager, TileCache } from '../../apps/client/src/navigation/POIManager.js';

const root = new URL('../../apps/client/public/', import.meta.url);
const realFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url) => {
  calls.push(url);
  try { return { ok: true, json: async () => JSON.parse(await fs.readFile(new URL(`.${url}`, root), 'utf8')) }; }
  catch { return { ok: false, status: 404 }; }
};
// Node has no CSS loader. Keep the actual JS module intact except its CSS import.
const source = (await fs.readFile(new URL('../../apps/client/src/navigation/CityMap.js', import.meta.url), 'utf8'))
  .replace("import './CityMap.css';", '')
  .replace("'./POIManager.js'", JSON.stringify(new URL('../../apps/client/src/navigation/POIManager.js', import.meta.url).href));
const { CityMap } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

await test('initialization fetches only manifests and overview; transforms preserve north and cursor anchors', async () => {
  calls.length = 0;
  const map = new CityMap();
  map.root = {}; map.attribution = {}; map.createFilters = () => {};
  map.message = (text) => assert.fail(text);
  assert.equal(await map.init(), true);
  assert.deepEqual([...calls].sort(), ['/data/city-map-roads/manifest.json', '/data/city-map-roads/overview.json', '/data/poi-tiles/manifest.json']);
  map.width = 390; map.height = 844; map.fitCity();
  const b = map.cityBounds;
  assert.ok(map.worldToScreen(b.minX,b.minZ).x >= 0);
  assert.ok(map.worldToScreen(b.maxX,b.maxZ).y <= map.height);
  assert.ok(map.worldToScreen(0,-100).y < map.worldToScreen(0,100).y);
  const original = map.screenToWorld(80,200); map.viewportChanged = () => {};
  map.zoom(0.5,80,200);
  const after = map.screenToWorld(80,200);
  assert.ok(Math.abs(after.x-original.x)<1e-8 && Math.abs(after.z-original.z)<1e-8);
  map.metersPerPixel = 1;
  const road = [10,20,30,40,0,0];
  map.styles = new Map([[0,{rank:0,color:'#fff',width:2}]]);
  const moves=[];
  map.ctx = {beginPath(){},moveTo(x,y){moves.push([x,y]);},lineTo(){},stroke(){}};
  map.drawRoads({roads:[road],names:[null]},-1000,-2000,
    {minX:-2000,maxX:0,minZ:-3000,maxZ:-1000},false);
  const expected=map.worldToScreen(-990,-1980);
  assert.deepEqual(moves,[[expected.x,expected.y]]);
});

await test('citywide lazy search ranks names, returns compact entries and loads one metadata tile', async () => {
  calls.length = 0;
  const manager = new POIManager(); await manager.init();
  assert.equal(calls.length,1);
  const index = await manager.loadSearchIndex();
  assert.equal(index.length,474);
  const result = index.find((p) => p.category === 'hospital');
  const found = await manager.search(result.name.toUpperCase(),20);
  assert.equal(found[0].name.toLowerCase(),result.name.toLowerCase());
  assert.ok(found.length <= 20);
  assert.ok(!('address' in found[0]));
  assert.ok((await manager.search('hospital',3)).length <= 3);
  assert.equal(calls.filter((u) => u.endsWith('search-index.json')).length,1);
  const before = calls.length;
  const full = await manager.getFullPOI(found[0]);
  assert.equal(full.id,found[0].id);
  assert.equal(calls.length,before+1);
  assert.ok('address' in full);
  const unknown = await manager.loadTile(99999,99999);
  assert.equal(unknown,null); assert.equal(calls.length,before+1);
});

await test('map streams only nearby manifested tiles and pinch preserves the world midpoint', async () => {
  const map = new CityMap();
  map.root = {}; map.attribution = {}; map.createFilters = () => {};
  map.message = (text) => assert.fail(text);
  await map.init();
  map.opened = true; map.width = 390; map.height = 844;
  map.invalidate = () => {}; map.viewportChanged = () => {};
  calls.length = 0; map.metersPerPixel = 60;
  await map.stream(); assert.equal(calls.length,0);
  map.centerX = 0; map.centerZ = 0; map.metersPerPixel = 1;
  await map.stream();
  while (map.roads.pending.size) await new Promise((resolve) => setTimeout(resolve,5));
  assert.ok(calls.length>0 && calls.length<96);
  assert.ok(!calls.some((url) => /search-index|routing/.test(url)));
  for (const url of calls) {
    const key = url.split('/').pop().replace('.json','');
    assert.ok(url.includes('city-map-roads') ? map.roadKeys.has(key) : map.poiManager.keys.has(key));
  }
  map.localPoint = (event) => ({x:event.x,y:event.y});
  map.pointers.set(1,{x:100,y:200}); map.pointers.set(2,{x:200,y:200});
  const anchor = map.screenToWorld(150,200);
  map.pointerMove({pointerId:2,x:300,y:200});
  assert.equal(map.metersPerPixel,0.5);
  assert.deepEqual(map.screenToWorld(200,200),anchor);
});

await test('visible POI streaming uses manifest keys, one tile margin and absolute coordinates', async () => {
  calls.length=0;
  const manager=new POIManager(); await manager.init();
  const index=await manager.loadSearchIndex(); const poi=index[0];
  const bounds={minX:poi.x-10,maxX:poi.x+10,minZ:poi.z-10,maxZ:poi.z+10};
  calls.length=0; await manager.loadVisible(bounds);
  for (const url of calls) {
    const key=url.split('/').pop().replace('.json',''); assert.ok(manager.keys.has(key));
    const [tx,tz]=key.split('_').map(Number);
    assert.ok(tx>=Math.floor(bounds.minX/250)-1 && tx<=Math.floor(bounds.maxX/250)+1);
    assert.ok(tz>=Math.floor(bounds.minZ/250)-1 && tz<=Math.floor(bounds.maxZ/250)+1);
  }
  const visible=manager.getVisible(bounds); assert.ok(visible.some((p) => p.id===poi.id));
  assert.equal(visible.find((p) => p.id===poi.id).x,poi.x);
  assert.ok(manager.getVisible(bounds,['hospital']).every((p) => p.category==='hospital'));
});

await test('tile loader deduplicates, caps concurrency, evicts LRU and tolerates failures', async () => {
  let active=0,peak=0,requests=0;
  globalThis.fetch=async (url) => {
    requests++; active++; peak=Math.max(peak,active);
    await new Promise((resolve) => setTimeout(resolve,5)); active--;
    return {ok:url!=='bad',status:500,json:async () => ({url})};
  };
  const keys=new Set([...Array.from({length:12},(_,i) => String(i)),'bad']);
  const cache=new TileCache({keys,url:(key) => key,maxTiles:3,concurrency:2});
  const a=cache.load('0'),b=cache.load('0'); assert.equal(a,b); await a; assert.equal(requests,1);
  await cache.load('1'); await cache.load('2'); cache.get('0'); await cache.load('3');
  assert.ok(cache.tiles.has('0')); assert.ok(!cache.tiles.has('1'));
  await Promise.all([...keys].filter((key) => key!=='bad').map((key) => cache.load(key)));
  assert.ok(peak<=2); assert.equal(cache.tiles.size,3);
  await assert.rejects(cache.load('bad')); assert.equal(await cache.load('bad'),null);
  globalThis.fetch=realFetch;
});
