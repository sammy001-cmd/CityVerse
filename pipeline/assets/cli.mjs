import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {createRelease} from './create.mjs';import {syncRelease,verifyRemote,publishRelease,compareFiles} from './delivery.mjs';
import {parseRelease,parseInventory} from './ReleaseSchema.js';
import {inside,noSymlink,readIf,atomicWrite,jsonBytes,verify,pool} from './io.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const args=process.argv.slice(2),command=args[0],pinFile=path.join(root,'world/release.json');
let lock;
try{
  if(!['create','sync','publish','verify-remote','validate'].includes(command))throw Error('Use assets:create, assets:sync, assets:publish, assets:verify:remote or assets:validate');
  await fs.mkdir(path.join(root,'.world-assets'),{recursive:true});
  const lockPath=path.join(root,'.world-assets',`${command}.lock`);lock=await fs.open(lockPath,'wx').catch(e=>{if(e.code==='EEXIST')throw Error(`Another ${command} may be running. Inspect .world-assets/${command}.lock before removing a stale lock.`);throw e;});
  await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));lock.path=lockPath;
  const pin=await readIf(pinFile);let release=pin?parseRelease(JSON.parse(pin)):null;
  const baseURL=process.env.WORLD_ASSET_URL||process.env.VITE_WORLD_ASSET_URL;
  if(command==='create'){
    const at=args.indexOf('--release'),id=at>=0?args[at+1]:release?.release??'world-0001';
    const old=release?await readIf(path.join(root,'.world-assets/releases',release.release,'inventory.json')):null;
    release=await createRelease({root,release:id});await atomicWrite(root,'world/release.json',jsonBytes(release));
    const next=JSON.parse(await fs.readFile(path.join(root,'.world-assets/releases',id,'inventory.json')));
    const diff=compareFiles(old?JSON.parse(old):null,next);
    console.log(JSON.stringify({release:id,fileCount:release.fileCount,totalBytes:release.totalBytes,manifestBytes:jsonBytes(release).length,diff:Object.fromEntries(Object.entries(diff).map(([k,v])=>[k,v.length]))},null,2));
  }else{
    if(!release)throw Error('Missing tracked world/release.json; the world author must run assets:create');
    if(['sync','verify-remote'].includes(command)&&!baseURL)throw Error('Set WORLD_ASSET_URL (sync/verify) or VITE_WORLD_ASSET_URL to the public storage root containing releases/. Storage has not been configured.');
    let result;
    if(command==='sync')result=await syncRelease({root,release,baseURL});
    if(command==='verify-remote')result=await verifyRemote({release,baseURL});
    if(command==='publish'||command==='validate'){
      const stage=path.join(root,'.world-assets/releases',release.release);
      // Reconstruct hash metadata from the author's files when needed; the pin
      // remains authoritative, including its original generation timestamp.
      if(!await readIf(path.join(stage,'inventory.json')))await createRelease({root,release:release.release});
      const inventory=parseInventory(JSON.parse(verify(await fs.readFile(inside(stage,release.inventory.path)),release.inventory,'inventory')),release);
      const publicRoot=path.join(root,'apps/client/public');
      const readAsset=async p=>{const target=inside(publicRoot,p);await noSymlink(publicRoot,target);return fs.readFile(target);};
      if(command==='validate'){await pool(inventory.files,async f=>verify(await readAsset(f.path),f,f.path));result={release:release.release,verifiedFiles:inventory.files.length,totalBytes:release.totalBytes,ibadanBuildingTiles:release.regions.ibadan.buildings.tileCount};}
      else{
        const {s3Store}=await import('./s3.mjs'),store=s3Store();
        try{result=await publishRelease({release,inventory,readAsset,readMetadata:p=>fs.readFile(inside(stage,p)),store,activate:!args.includes('--no-activate')});}finally{store.close();}
      }
    }
    await atomicWrite(root,`.world-assets/last-${command}-report.json`,jsonBytes(result));
    console.log(JSON.stringify({...result,...(result.diff?{diff:Object.fromEntries(Object.entries(result.diff).map(([k,v])=>[k,v.length]))}:{})},null,2));
  }
}catch(error){console.error(`World asset ${command??'command'} failed: ${error.message}`);process.exitCode=1;}
finally{if(lock){await lock.close();await fs.rm(lock.path,{force:true});}}
