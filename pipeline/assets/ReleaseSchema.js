export const RELEASE_ID = /^world-[a-z0-9][a-z0-9-]{0,63}$/;
export const SHA256 = /^[a-f0-9]{64}$/;
export function safePath(value) {
  if(typeof value!=='string'||!value||value.length>512||!value.split('/').every(p=>/^[a-zA-Z0-9_.-]+$/.test(p)&&p!=='.'&&p!=='..'))throw Error(`Unsafe asset path: ${String(value).slice(0,100)}`);
  return value;
}
export function assetPath(value){const path=safePath(String(value).replace(/^\//,''));if(!path.startsWith('data/'))throw Error('World assets must be under data/');return path;}
export function groupFor(value){const p=assetPath(value);const match=p.match(/^data\/world\/([a-z0-9-]+)\/(buildings|map)\//);if(match)return `world/${match[1]}/${match[2]}`;const landmark=p.match(/^data\/world\/([a-z0-9-]+)\/landmarks.json$/);if(landmark)return `world/${landmark[1]}/landmarks`;return p.startsWith('data/road-tiles/')?'road-tiles':p.startsWith('data/poi-tiles/')?'poi-tiles':'root';}
export function storageBase(value){
  if(typeof value!=='string'||/[\\%]/.test(value))throw Error('Invalid world asset base URL');
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('World asset base must be an HTTP(S) URL without credentials, query or fragment');
  return url.href.replace(/\/+$/,'');
}
function descriptor(d){if(!d||!SHA256.test(d.sha256)||!Number.isSafeInteger(d.bytes)||d.bytes<0)throw Error('Invalid asset hash/size descriptor');}
export function parseRelease(value){
  if(!value||value.schemaVersion!==1||!RELEASE_ID.test(value.release)||!Number.isFinite(Date.parse(value.generatedAt))||!value.regions||!value.integrityGroups)throw Error('Invalid world release manifest');
  descriptor(value.inventory);safePath(value.inventory.path);
  if(!Number.isSafeInteger(value.fileCount)||value.fileCount<1||!Number.isSafeInteger(value.totalBytes)||value.totalBytes<1)throw Error('Invalid release totals');
  for(const [key,d] of Object.entries(value.integrityGroups)){safePath(key);descriptor(d);safePath(d.path);}
  for(const [region,layers] of Object.entries(value.regions)){
    if(!/^[a-z0-9-]+$/.test(region)||!layers.buildings)throw Error('Invalid release region');
    for(const layer of Object.values(layers)){assetPath(layer.manifest);if(!Number.isInteger(layer.schemaVersion)||!Number.isInteger(layer.fileCount)||layer.fileCount<1)throw Error('Invalid layer descriptor');}
  }
  return value;
}
export function parseInventory(value,release){
  if(value?.schemaVersion!==1||value.release!==release.release||!Array.isArray(value.files))throw Error('Inventory release/schema mismatch');
  const seen=new Set();let bytes=0;
  for(const f of value.files){assetPath(f.path);descriptor(f);safePath(f.group);if(!release.integrityGroups[f.group]||seen.has(f.path))throw Error('Duplicate file or unknown integrity group');seen.add(f.path);bytes+=f.bytes;}
  if(value.files.length!==release.fileCount||bytes!==release.totalBytes)throw Error('Inventory totals do not match pinned release');
  return value;
}
export function parseIntegrity(value,release,group){
  if(value?.schemaVersion!==1||value.release!==release.release||!value.files||Array.isArray(value.files))throw Error('Integrity index release/schema mismatch');
  let bytes=0,count=0;
  for(const [path,d] of Object.entries(value.files)){assetPath(path);descriptor(d);bytes+=d.bytes;count++;}
  const expected=release.integrityGroups[group];
  if(count!==expected.fileCount||bytes!==expected.totalBytes)throw Error('Integrity index totals mismatch');
  return value.files;
}
