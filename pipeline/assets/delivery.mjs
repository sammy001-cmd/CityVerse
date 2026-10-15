import fs from 'node:fs/promises';import path from 'node:path';
import {parseRelease,parseInventory,parseIntegrity,storageBase,RELEASE_ID} from './ReleaseSchema.js';
import {inside,noSymlink,atomicWrite,readIf,verify,sha256,jsonBytes,pool,download} from './io.mjs';

export function compareFiles(previous,current){
  const old=new Map((previous?.files??[]).map(f=>[f.path,f])),now=new Map(current.files.map(f=>[f.path,f]));
  const diff={unchanged:[],changed:[],added:[],removed:[]};
  for(const f of current.files)diff[!old.has(f.path)?'added':old.get(f.path).sha256===f.sha256&&old.get(f.path).bytes===f.bytes?'unchanged':'changed'].push(f.path);
  for(const f of old.values())if(!now.has(f.path))diff.removed.push(f.path);return diff;
}
export async function remoteMetadata(release,baseURL,fetcher=fetch){
  parseRelease(release);const base=`${storageBase(baseURL)}/releases/${release.release}`;
  const inventoryBytes=await download(`${base}/${release.inventory.path}`,release.inventory,fetcher);
  const inventory=parseInventory(JSON.parse(inventoryBytes),release),metadata=new Map([[release.inventory.path,inventoryBytes]]);
  await pool(Object.entries(release.integrityGroups),async([group,d])=>{
    const bytes=await download(`${base}/${d.path}`,d,fetcher),entries=parseIntegrity(JSON.parse(bytes),release,group);
    for(const f of inventory.files.filter(f=>f.group===group)){const e=entries[f.path];if(!e||e.sha256!==f.sha256||e.bytes!==f.bytes)throw Error('Inventory/integrity index disagreement');}
    metadata.set(d.path,bytes);
  });
  const manifestBytes=jsonBytes(release),remoteRelease=await download(`${base}/release.json`,{bytes:manifestBytes.length,sha256:sha256(manifestBytes)},fetcher);
  metadata.set('release.json',remoteRelease);return {base,inventory,metadata};
}
export async function verifyRemote({release,baseURL,fetcher=fetch}){
  const {base,inventory}=await remoteMetadata(release,baseURL,fetcher);let bytes=0;
  await pool(inventory.files,async file=>{await download(`${base}/${file.path}`,file,fetcher);bytes+=file.bytes;});
  return {release:release.release,verifiedFiles:inventory.files.length,verifiedBytes:bytes};
}
export async function syncRelease({root,release,baseURL,fetcher=fetch}){
  parseRelease(release);const {base,inventory,metadata}=await remoteMetadata(release,baseURL,fetcher);
  const cacheRoot=path.join(root,'apps/client/public/data/releases'),destination=path.join(cacheRoot,release.release);
  const previousBytes=await readIf(path.join(root,'.world-assets/local.json'));
  const previous=previousBytes?JSON.parse(previousBytes):null;
  let previousInventory=null;
  if(previous&&RELEASE_ID.test(previous.release)){
    const bytes=await readIf(path.join(cacheRoot,previous.release,'inventory.json'));
    if(bytes)try{previousInventory=JSON.parse(bytes);}catch{}
  }
  const old=new Map((previousInventory?.files??[]).map(f=>[f.path,f]));
  const stats={release:release.release,filesReused:0,filesDownloaded:0,bytesDownloaded:0,diff:compareFiles(previousInventory,inventory)};
  await pool(inventory.files,async file=>{
    const target=inside(destination,file.path);await noSymlink(cacheRoot,target);
    const current=await readIf(target);
    if(current&&current.length===file.bytes&&sha256(current)===file.sha256){stats.filesReused++;return;}
    if(old.get(file.path)?.sha256===file.sha256&&old.get(file.path)?.bytes===file.bytes){
      const source=inside(path.join(cacheRoot,previous.release),file.path);await noSymlink(cacheRoot,source);
      const bytes=await readIf(source);
      if(bytes&&bytes.length===file.bytes&&sha256(bytes)===file.sha256){await atomicWrite(destination,file.path,bytes);stats.filesReused++;return;}
    }
    const bytes=await download(`${base}/${file.path}`,file,fetcher);
    await atomicWrite(destination,file.path,bytes);stats.filesDownloaded++;stats.bytesDownloaded+=bytes.length;
  });
  for(const [relative,bytes] of metadata)await atomicWrite(destination,relative,bytes);
  // This is the only activation step. A failed/incomplete sync leaves the last
  // complete release selected; no legacy directories or unrelated files change.
  await atomicWrite(root,'.world-assets/local.json',jsonBytes({schemaVersion:1,release:release.release,treeSHA256:release.treeSHA256,completedAt:new Date().toISOString()}));
  return stats;
}

export async function publishRelease({release,inventory,readAsset,readMetadata,store,activate=true}){
  parseRelease(release);parseInventory(inventory,release);
  const previous=await store.get('current.json');
  const stats={release:release.release,filesUploaded:0,filesReused:0,bytesUploaded:0,activated:false};
  const upload=async(key,bytes,expected)=>{
    verify(bytes,expected,key);let existing=await store.get(key);
    if(existing){verify(existing.body,expected,key);stats.filesReused++;return;}
    try{await store.put(key,bytes,{immutable:true,cacheControl:'public,max-age=31536000,immutable',sha256:expected.sha256});stats.filesUploaded++;stats.bytesUploaded+=bytes.length;}
    catch(error){if(error.status!==412)throw error;existing=await store.get(key);if(!existing)throw error;verify(existing.body,expected,key);stats.filesReused++;}
    const uploaded=await store.get(key);if(!uploaded)throw Error(`Uploaded object missing: ${key}`);verify(uploaded.body,expected,key);
  };
  const prefix=`releases/${release.release}`;
  await pool(inventory.files,async f=>upload(`${prefix}/${f.path}`,await readAsset(f.path),f));
  for(const d of Object.values(release.integrityGroups))await upload(`${prefix}/${d.path}`,await readMetadata(d.path),d);
  await upload(`${prefix}/${release.inventory.path}`,await readMetadata(release.inventory.path),release.inventory);
  const bytes=jsonBytes(release),descriptor={bytes:bytes.length,sha256:sha256(bytes)};
  await upload(`${prefix}/release.json`,bytes,descriptor);
  if(activate){
    if(previous&&!previous.etag)throw Error('Storage must expose ETag for conditional release activation');
    const pointer=jsonBytes({schemaVersion:1,release:release.release,manifest:`${prefix}/release.json`,sha256:descriptor.sha256,activatedAt:new Date().toISOString()});
    await store.put('current.json',pointer,{immutable:false,etag:previous?.etag,cacheControl:'no-cache,max-age=0,must-revalidate'});stats.activated=true;
  }
  return stats;
}
