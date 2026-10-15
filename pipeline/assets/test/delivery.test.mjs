import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import http from 'node:http';
import * as THREE from '../../../apps/client/node_modules/three/build/three.module.js';
import {sha256,jsonBytes} from '../io.mjs';
import {parseRelease,parseInventory,safePath,storageBase,groupFor} from '../ReleaseSchema.js';
import {syncRelease,publishRelease,verifyRemote,compareFiles} from '../delivery.mjs';
import {WorldAssetResolver} from '../../../apps/client/src/world/WorldAssetResolver.js';
import {BuildingSystem} from '../../../apps/client/src/world/BuildingSystem.js';
import {s3Store} from '../s3.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
function fixture(values={'data/world/regions.json':{version:1}},id='world-test'){
  const payload=new Map(Object.entries(values).map(([p,v])=>[p,jsonBytes(v)]));
  const files=[...payload].map(([p,b])=>({path:p,bytes:b.length,sha256:sha256(b),group:groupFor(p)}));
  const integrityGroups={};for(const group of new Set(files.map(f=>f.group))){const entries=files.filter(f=>f.group===group);const bytes=jsonBytes({schemaVersion:1,release:id,files:Object.fromEntries(entries.map(f=>[f.path,{bytes:f.bytes,sha256:f.sha256}]))}),p=`integrity/${group}.json`;payload.set(p,bytes);integrityGroups[group]={path:p,bytes:bytes.length,sha256:sha256(bytes),fileCount:entries.length,totalBytes:entries.reduce((s,f)=>s+f.bytes,0)};}
  const inventory={schemaVersion:1,release:id,files},bytes=jsonBytes(inventory);payload.set('inventory.json',bytes);
  const release=parseRelease({schemaVersion:1,release:id,generatedAt:'2026-10-14T00:00:00Z',treeSHA256:sha256(bytes),fileCount:files.length,totalBytes:files.reduce((s,f)=>s+f.bytes,0),inventory:{path:'inventory.json',bytes:bytes.length,sha256:sha256(bytes)},regions:{ibadan:{buildings:{manifest:'data/world/ibadan/buildings/manifest.json',schemaVersion:2,fileCount:1}}},integrityGroups});payload.set('release.json',jsonBytes(release));
  const calls=[];
  const fetcher=async url=>{const u=new URL(url),key=u.pathname.replace(`/assets/releases/${id}/`,'');calls.push(key);return payload.has(key)?new Response(payload.get(key)):new Response('missing',{status:404});};
  return {release,inventory,payload,calls,fetcher};
}
async function temporary(){const base=path.join(root,'.world-assets');await fs.mkdir(base,{recursive:true});return fs.mkdtemp(path.join(base,'test-'));}
const summary=stats=>Object.fromEntries(Object.entries(stats.diff).map(([k,v])=>[k,v.length]));

test('safe deterministic local/remote URLs, pinned versions, and invalid input rejection',()=>{
  const f=fixture(),local=new WorldAssetResolver({release:f.release,baseURL:'',localRelease:''}),remote=new WorldAssetResolver({release:f.release,baseURL:'https://cdn.example/assets/'});
  assert.equal(local.resolve('/data/world/regions.json'),'/data/world/regions.json');
  assert.equal(remote.resolve('/data/world/regions.json'),'https://cdn.example/assets/releases/world-test/data/world/regions.json');
  assert.equal(new WorldAssetResolver({release:fixture({'data/world/regions.json':{version:2}},'world-next').release,baseURL:'https://cdn.example/assets'}).resolve('/data/world/regions.json'),'https://cdn.example/assets/releases/world-next/data/world/regions.json');
  for(const p of ['../secret','data/../secret','data/%2e%2e/secret','data/a\\b','https://evil/x','/data//x'])assert.throws(()=>local.resolve(p));
  assert.throws(()=>storageBase('https://user:password@example.com'));assert.throws(()=>storageBase('https://example.com/?token=secret'));
  assert.throws(()=>parseRelease({...f.release,release:'../bad'}));assert.throws(()=>parseRelease({...f.release,schemaVersion:99}));assert.throws(()=>parseInventory({...f.inventory,files:[...f.inventory.files,...f.inventory.files]},f.release));assert.throws(()=>safePath('/absolute'));
});
test('resolver metadata and data stay lazy, deduplicate integrity requests and reject corruption without local fallback',async()=>{
  const f=fixture(),resolver=new WorldAssetResolver({release:f.release,baseURL:'https://cdn.example/assets'});assert.equal(f.calls.length,0);
  await Promise.all([resolver.fetch('/data/world/regions.json',{},f.fetcher),resolver.fetch('/data/world/regions.json',{},f.fetcher)]);
  assert.equal(f.calls.filter(p=>p==='integrity/root.json').length,1);assert.ok(!f.calls.includes('inventory.json'));
  f.payload.set('data/world/regions.json',Buffer.from('corrupt'));
  await assert.rejects(resolver.fetch('/data/world/regions.json',{},f.fetcher),/mismatch|exceeds/);
  assert.ok(f.calls.every(p=>!p.startsWith('/data')));
  await assert.rejects(resolver.fetch('/data/world/ogbomoso/buildings/manifest.json',{},f.fetcher),/Layer absent/);
});
test('sync verifies data, skips unchanged files, repairs missing/corrupt files and never deletes unrelated files',async()=>{
  const root=await temporary(),f=fixture({'data/world/regions.json':{version:1},'data/world/ibadan/landmarks.json':{region:'ibadan'}});
  const first=await syncRelease({root,release:f.release,baseURL:'https://cdn.example/assets',fetcher:f.fetcher});assert.equal(first.filesDownloaded,2);
  const target=path.join(root,'apps/client/public/data/releases/world-test/data/world/regions.json');
  await fs.writeFile(path.join(path.dirname(target),'personal.txt'),'keep me');f.calls.length=0;
  const second=await syncRelease({root,release:f.release,baseURL:'https://cdn.example/assets',fetcher:f.fetcher});assert.equal(second.filesDownloaded,0);assert.equal(second.filesReused,2);assert.ok(!f.calls.includes('data/world/regions.json'));
  await fs.unlink(target);assert.equal((await syncRelease({root,release:f.release,baseURL:'https://cdn.example/assets',fetcher:f.fetcher})).filesDownloaded,1);
  await fs.writeFile(target,'corrupt');assert.equal((await syncRelease({root,release:f.release,baseURL:'https://cdn.example/assets',fetcher:f.fetcher})).filesDownloaded,1);
  assert.equal(await fs.readFile(path.join(path.dirname(target),'personal.txt'),'utf8'),'keep me');
});
test('new release reuses verified unchanged bytes, reports all diff classes and failed sync leaves previous selection intact',async()=>{
  const root=await temporary(),old=fixture({'data/world/regions.json':{v:1},'data/world/ibadan/landmarks.json':{v:1},'data/poi-tiles/old.json':{v:1}},'world-old');
  await syncRelease({root,release:old.release,baseURL:'https://cdn.example/assets',fetcher:old.fetcher});
  const next=fixture({'data/world/regions.json':{v:1},'data/world/ibadan/landmarks.json':{v:2},'data/poi-tiles/new.json':{v:1}},'world-next');
  const result=await syncRelease({root,release:next.release,baseURL:'https://cdn.example/assets',fetcher:next.fetcher});assert.equal(result.filesReused,1);assert.equal(result.filesDownloaded,2);assert.deepEqual(summary(result),{unchanged:1,changed:1,added:1,removed:1});
  const failed=fixture({'data/world/regions.json':{v:3}},'world-failed');failed.payload.set('data/world/regions.json',Buffer.from('broken'));
  await assert.rejects(syncRelease({root,release:failed.release,baseURL:'https://cdn.example/assets',fetcher:failed.fetcher}),/mismatch|exceeds/);
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'.world-assets/local.json'))).release,'world-next');
  assert.equal(compareFiles(old.inventory,next.inventory).removed.length,1);
});
function memoryStore(fail=false){
  const objects=new Map([['current.json',{body:jsonBytes({release:'world-old'}),etag:'old'}]]),puts=[];
  return {objects,puts,async get(key){return objects.get(key)??null;},async put(key,body,options){if(fail&&key.includes('/data/'))throw Error('injected upload failure');const old=objects.get(key);if(options.immutable&&old||!options.immutable&&options.etag!==old?.etag){const e=Error('conditional write failed');e.status=412;throw e;}puts.push(key);objects.set(key,{body,etag:sha256(body)});}};
}
test('publish verifies immutable files before activating; retry reuses bytes; failure preserves previous production pointer',async()=>{
  const f=fixture(),store=memoryStore(true),params={release:f.release,inventory:f.inventory,readAsset:p=>f.payload.get(p),readMetadata:p=>f.payload.get(p),store};
  await assert.rejects(publishRelease(params),/injected/);assert.equal(JSON.parse(store.objects.get('current.json').body).release,'world-old');assert.ok(!store.puts.includes('current.json'));
  const working=memoryStore();const first=await publishRelease({...params,store:working});assert.equal(first.activated,true);assert.equal(working.puts.at(-1),'current.json');
  const second=await publishRelease({...params,store:working});assert.equal(second.filesUploaded,0);assert.ok(second.filesReused>=3);
  const conflict=memoryStore();conflict.objects.set('releases/world-test/data/world/regions.json',{body:Buffer.from('bad'),etag:'bad'});
  await assert.rejects(publishRelease({...params,store:conflict}),/mismatch/);assert.equal(JSON.parse(conflict.objects.get('current.json').body).release,'world-old');
});
test('production verification checks every file, detects an incomplete release and never consults another version',async()=>{
  const f=fixture();assert.equal((await verifyRemote({release:f.release,baseURL:'https://cdn.example/assets',fetcher:f.fetcher})).verifiedFiles,1);
  f.payload.delete('data/world/regions.json');await assert.rejects(verifyRemote({release:f.release,baseURL:'https://cdn.example/assets',fetcher:f.fetcher}),/HTTP 404/);
});
test('BuildingSystem local and remote modes preserve lazy tile loading and region isolation',async()=>{
  const index=JSON.parse(await fs.readFile(path.join(root,'apps/client/public/data/world/regions.json'))),manifest=JSON.parse(await fs.readFile(path.join(root,'apps/client/public/data/world/ibadan/buildings/manifest.json')));
  const f=fixture({'data/world/regions.json':index,'data/world/ibadan/buildings/manifest.json':{...manifest,tiles:['0_0']},'data/world/ibadan/buildings/tiles/0_0.json':{version:1,tx:0,tz:0,strings:[null],buildings:[]}});
  for(const remote of [false,true]){
    f.calls.length=0;const calls=[];const resolver=new WorldAssetResolver({release:f.release,baseURL:remote?'https://cdn.example/assets':'',localRelease:''});
    const fetcher=remote?f.fetcher:async url=>{calls.push(url);return new Response(f.payload.get(url.slice(1)));};
    const system=new BuildingSystem({scene:new THREE.Scene(),worldSurface:{heightAt:()=>0},worker:false,assetResolver:resolver,fetcher});
    await system.init();assert.equal(system.loaded.size,0);await system.activate(index.regions[0]);await system.tileData('0_0');
    assert.equal(system.cache.size,1);assert.equal(system.region,'ibadan');assert.ok(!(remote?f.calls:calls).some(p=>p.includes('ogbomoso')));system.dispose();
  }
});
test('S3-compatible adapter uses environment credentials, conditional immutable writes, checksums and cache headers',async()=>{
  const objects=new Map(),requests=[];
  const server=http.createServer(async(req,res)=>{
    requests.push({method:req.method,key:req.url,headers:req.headers});const key=req.url.split('?')[0];
    if(req.method==='GET'){const bytes=objects.get(key);if(!bytes){res.writeHead(404,{'content-type':'application/xml'});res.end('<Error><Code>NoSuchKey</Code></Error>');}else{res.setHeader('etag',`"${sha256(bytes)}"`);res.end(bytes);}return;}
    const chunks=[];for await(const c of req)chunks.push(c);if(objects.has(key)&&req.headers['if-none-match']==='*'){res.writeHead(412);res.end();return;}
    const bytes=Buffer.concat(chunks);objects.set(key,bytes);res.setHeader('etag',`"${sha256(bytes)}"`);res.end();
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const store=s3Store({WORLD_ASSET_S3_ENDPOINT:`http://127.0.0.1:${server.address().port}`,WORLD_ASSET_BUCKET:'test-bucket',AWS_ACCESS_KEY_ID:'test-key',AWS_SECRET_ACCESS_KEY:'test-secret'});
  try{
    const bytes=Buffer.from('verified');await store.put('releases/world-test/file.json',bytes,{immutable:true,cacheControl:'public,max-age=31536000,immutable',sha256:sha256(bytes)});
    assert.deepEqual((await store.get('releases/world-test/file.json')).body,bytes);
    await assert.rejects(store.put('releases/world-test/file.json',bytes,{immutable:true}),e=>e.status===412);
    const request=requests.find(r=>r.method==='PUT');assert.match(request.headers.authorization,/AWS4-HMAC-SHA256/);assert.equal(request.headers['if-none-match'],'*');assert.equal(request.headers['x-amz-checksum-sha256'],sha256(bytes)?Buffer.from(sha256(bytes),'hex').toString('base64'):'');assert.match(request.headers['cache-control'],/immutable/);
  }finally{store.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
