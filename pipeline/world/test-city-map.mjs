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
