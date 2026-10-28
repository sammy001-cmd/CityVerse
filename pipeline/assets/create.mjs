import fs from 'node:fs/promises';import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {assetPath,groupFor,parseRelease,RELEASE_ID} from './ReleaseSchema.js';
import {inside,noSymlink,sha256,jsonBytes,atomicWrite,readIf,pool} from './io.mjs';

export async function createRelease({root,release='world-0001',generatedAt=new Date().toISOString(),expectedIbadanTiles=12477,
  roadRoot=path.join(root,'apps/client/public/data/road-tiles'),roadBuildId='road-world-v2'}){
  if(!RELEASE_ID.test(release))throw Error('Invalid release ID');
  const publicRoot=path.join(root,'apps/client/public'),stage=path.join(root,'.world-assets/releases',release),required=new Set(),roots=new Map(),regions={};
  const json=async p=>{p=assetPath(p);required.add(p);roots.set(p,publicRoot);await noSymlink(publicRoot,inside(publicRoot,p));return JSON.parse(await fs.readFile(inside(publicRoot,p),'utf8'));};
  const add=(p,base=publicRoot)=>{p=assetPath(p);required.add(p);roots.set(p,base);};
  const index=await json('data/world/regions.json'),mapIndex=await json('data/city-map-v2/regions.json');
  const layers=[];
  for(const r of index.regions){
    const manifest=assetPath(r.layers.buildings.manifest),m=await json(manifest);
    if(m.region!==r.slug||m.schemaVersion!==2||!Array.isArray(m.tiles)||new Set(m.tiles).size!==m.tiles.length)throw Error(`Invalid building manifest ${r.slug}`);
    if(r.slug==='ibadan'&&m.tiles.length!==expectedIbadanTiles)throw Error(`Expected ${expectedIbadanTiles} Ibadan building tiles; found ${m.tiles.length}`);
    const base=path.posix.dirname(manifest);for(const key of m.tiles){if(!/^-?\d+_-?\d+$/.test(key))throw Error('Invalid tile key');add(`${base}/tiles/${key}.json`);}
    regions[r.slug]={};layers.push({region:r.slug,layer:'buildings',manifest,group:groupFor(manifest),schemaVersion:m.schemaVersion,tileCount:m.tiles.length,source:m.source,buildId:m.pipelineVersion});
    const mapRegion=mapIndex.regions.find(p=>p.slug===r.slug);if(!mapRegion)throw Error(`Missing map region ${r.slug}`);
    const mapManifest=assetPath(mapRegion.manifest),map=await json(mapManifest),mapBase=path.posix.dirname(mapManifest);
    if(map.region!==r.slug||map.version!==2)throw Error('Invalid map region/schema');
    for(const p of [map.overview,map.searchIndex,map.landmarks])add(`${mapBase}/${p}`);
    for(const key of map.tiles){if(!/^-?\d+_-?\d+$/.test(key))throw Error('Invalid map tile key');const [tx,tz]=key.split('_');add(`${mapBase}/${map.tilePath.replace('{tx}',tx).replace('{tz}',tz)}`);}
    layers.push({region:r.slug,layer:'map',manifest:mapManifest,group:groupFor(mapManifest),schemaVersion:map.version,tileCount:map.tiles.length,source:map.source});
    const landmarkManifest=`data/world/${r.slug}/landmarks.json`,landmarks=await json(landmarkManifest);
    if(landmarks.region!==r.slug||!Array.isArray(landmarks.landmarks))throw Error('Invalid landmark registry');
    layers.push({region:r.slug,layer:'landmarks',manifest:landmarkManifest,group:groupFor(landmarkManifest),schemaVersion:landmarks.version,source:{provider:'OpenStreetMap',derivedFrom:`world/${r.slug}/map/landmarks.json`}});
  }
  for(const folder of ['road-tiles','poi-tiles']){
    const base=folder==='road-tiles'?roadRoot:publicRoot,manifest=`data/${folder}/manifest.json`;
    let m;if(base===publicRoot)m=await json(manifest);else{add(manifest,base);await noSymlink(base,inside(base,'manifest.json'));m=JSON.parse(await fs.readFile(inside(base,'manifest.json'),'utf8'));}
    if(m.version!==1||!Array.isArray(m.tiles))throw Error(`Invalid ${folder} manifest`);
    for(const key of m.tiles){if(!/^-?\d+_-?\d+$/.test(key))throw Error('Invalid tile key');add(`data/${folder}/${key}.json`,base);}
    if(m.searchIndex)add(`data/${folder}/${m.searchIndex}`,base);
    if(m.navigationGraph)add(`data/${folder}/${m.navigationGraph}`,base);
  if(folder==='road-tiles')layers.push({region:'ibadan',layer:'roads',manifest,group:folder,schemaVersion:m.version,tileCount:m.tiles.length,buildId:roadBuildId});
  }
  const files=new Array(required.size),paths=[...required].sort();
  await pool(paths.map((p,i)=>({p,i})),async({p,i})=>{
    const base=roots.get(p)??publicRoot,relative=base===publicRoot?p:p.replace(/^data\/road-tiles\//,''),target=inside(base,relative);await noSymlink(base,target);const bytes=await fs.readFile(target);
    try{JSON.parse(bytes.toString('utf8'));}catch{throw Error(`Invalid generated JSON: ${p}`);}
    files[i]={path:p,bytes:bytes.length,sha256:sha256(bytes),group:groupFor(p)};
  });
  const treeSHA256=sha256(jsonBytes(files));
  const existing=await readIf(path.join(stage,'release.json'))??await readIf(path.join(root,'world/release.json'));
  const candidate=existing?parseRelease(JSON.parse(existing)):null;
  const previous=candidate?.release===release?candidate:null;
  if(previous&&previous.treeSHA256!==treeSHA256)throw Error(`Release ${release} is immutable; choose a new ID`);
  const integrityGroups={};
  for(const group of [...new Set(files.map(f=>f.group))].sort()){
    const members=files.filter(f=>f.group===group),bytes=jsonBytes({schemaVersion:1,release,files:Object.fromEntries(members.map(f=>[f.path,{bytes:f.bytes,sha256:f.sha256}]))});
    const relative=`integrity/${group}.json`;
    if(previous&&(previous.integrityGroups[group]?.sha256!==sha256(bytes)))throw Error('Integrity index format changed; choose a new release ID');
    await atomicWrite(stage,relative,bytes);
    integrityGroups[group]={path:relative,bytes:bytes.length,sha256:sha256(bytes),fileCount:members.length,totalBytes:members.reduce((s,f)=>s+f.bytes,0)};
  }
  for(const l of layers){const g=integrityGroups[l.group];regions[l.region][l.layer]={manifest:l.manifest,schemaVersion:l.schemaVersion,fileCount:g.fileCount,totalBytes:g.totalBytes,tileCount:l.tileCount,source:l.source,buildId:l.buildId};}
  const inventoryBytes=jsonBytes({schemaVersion:1,release,files});await atomicWrite(stage,'inventory.json',inventoryBytes);
  let git='unknown';try{git=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}catch{}
  const manifest=previous??parseRelease({schemaVersion:1,release,generatedAt,buildId:git,treeSHA256,projection:index.projection.id,fileCount:files.length,totalBytes:files.reduce((s,f)=>s+f.bytes,0),inventory:{path:'inventory.json',bytes:inventoryBytes.length,sha256:sha256(inventoryBytes)},regions,integrityGroups});
  await atomicWrite(stage,'release.json',jsonBytes(manifest));
  return manifest;
}
