import pinnedRelease from '../../../../world/release.json' with {type:'json'};
import {assetPath,groupFor,parseRelease,parseIntegrity,storageBase} from '../../../../pipeline/assets/ReleaseSchema.js';
const selectedRelease=typeof __WORLD_CANDIDATE_RELEASE__==='undefined'||!__WORLD_CANDIDATE_RELEASE__?pinnedRelease:__WORLD_CANDIDATE_RELEASE__;
export class WorldAssetResolver {
  constructor({release=selectedRelease,baseURL=import.meta.env?.VITE_WORLD_ASSET_URL??'',localRelease=typeof __WORLD_LOCAL_RELEASE__==='undefined'?'':__WORLD_LOCAL_RELEASE__}={}){
    this.release=parseRelease(release);this.groups=new Map();
    this.base=baseURL?`${storageBase(baseURL)}/releases/${this.release.release}`:localRelease;
    if(this.base&&!baseURL&&this.base!==`/data/releases/${this.release.release}`)throw Error('Local release does not match application pin');
    this.mode=baseURL?'remote':localRelease?'local-release':'local-author';
  }
  resolve(value){const p=assetPath(value);return this.base?`${this.base}/${p}`:`/${p}`;}
  async verified(response,expected,label){
    if(!response.ok)throw Error(`HTTP ${response.status}: ${label}`);
    let bytes;
    if(response.body?.getReader){
      const reader=response.body.getReader(),chunks=[];let size=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>expected.bytes){await reader.cancel();throw Error(`Size exceeds release descriptor: ${label}`);}chunks.push(value);}}finally{reader.releaseLock();}
      bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
    }else bytes=new Uint8Array(await response.arrayBuffer());
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
    if(bytes.length!==expected.bytes||hash!==expected.sha256)throw Error(`SHA256/size mismatch: ${label}`);return bytes;
  }
  async fetch(value,options={},fetcher=(...args)=>globalThis.fetch(...args)){
    const p=assetPath(value),url=this.resolve(p);if(this.mode==='local-author')return fetcher(url,options);
    try{
      const group=groupFor(p),d=this.release.integrityGroups[group];if(!d)throw Error(`Layer absent from release: ${group}`);
      if(!this.groups.has(group)){
        // A tile abort must not cancel shared immutable integrity metadata.
        const task=(async()=>{const r=await fetcher(`${this.base}/${d.path}`,{cache:'force-cache'});return parseIntegrity(JSON.parse(new TextDecoder().decode(await this.verified(r,d,d.path))),this.release,group);})();
        this.groups.set(group,task);task.catch(()=>{if(this.groups.get(group)===task)this.groups.delete(group);});
      }
      const entries=await this.groups.get(group),expected=entries[p];if(!expected)throw Error(`Asset absent from release: ${p}`);
      if(options.signal?.aborted)throw new DOMException('Asset request aborted','AbortError');
      const r=await fetcher(url,options),bytes=await this.verified(r,expected,p);
      return new Response(bytes,{status:200,headers:{'content-type':'application/json','content-length':String(bytes.length)}});
    }catch(error){
      if(error.name!=='AbortError'){
        globalThis.dispatchEvent?.(new CustomEvent('cityverse:world-asset-error',{detail:{release:this.release.release,path:p,message:error.message}}));
        throw Error(`World release ${this.release.release} unavailable (${p}): ${error.message}`);
      }throw error;
    }
  }
}
export const worldAssets=new WorldAssetResolver();
