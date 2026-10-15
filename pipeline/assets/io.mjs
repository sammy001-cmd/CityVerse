import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {safePath} from './ReleaseSchema.js';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const jsonBytes=value=>Buffer.from(JSON.stringify(value));
export function inside(root,relative){safePath(relative);const target=path.resolve(root,...relative.split('/'));if(path.relative(path.resolve(root),target).startsWith('..'))throw Error('Path escapes asset root');return target;}
export async function noSymlink(root,target){
  const rel=path.relative(path.resolve(root),path.resolve(target));if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('Path escapes asset root');
  let current=path.resolve(root);
  for(const segment of ['',...rel.split(path.sep).filter(Boolean)]){if(segment)current=path.join(current,segment);try{if((await fs.lstat(current)).isSymbolicLink())throw Error('Asset paths must not contain symlinks');}catch(e){if(e.code!=='ENOENT')throw e;}}
}
export async function atomicWrite(root,relative,bytes){
  const target=inside(root,relative);await noSymlink(root,target);await fs.mkdir(path.dirname(target),{recursive:true});
  const temporary=`${target}.${randomUUID()}.tmp`;
  try{await fs.writeFile(temporary,bytes,{flag:'wx'});await fs.rename(temporary,target);}finally{await fs.rm(temporary,{force:true});}
}
export async function readIf(file){try{return await fs.readFile(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export function verify(bytes,expected,label){if(bytes.byteLength!==expected.bytes||sha256(bytes)!==expected.sha256)throw Error(`World asset hash/size mismatch: ${label}`);return bytes;}
export async function pool(items,work,concurrency=8){let next=0;await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(next<items.length)await work(items[next++]);}));}
export async function download(url,expected,fetcher=fetch){
  for(let attempt=0;attempt<3;attempt++)try{
    const r=await fetcher(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw Error(`World asset HTTP ${r.status}: ${url}`);
    const reader=r.body.getReader(),chunks=[];let length=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>expected.bytes){await reader.cancel();throw Error(`World asset exceeds declared size: ${url}`);}chunks.push(value);}}finally{reader.releaseLock();}
    return verify(Buffer.concat(chunks,length),expected,url);
  }catch(e){if(attempt===2)throw e;}
}
