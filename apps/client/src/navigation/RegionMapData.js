import {TileCache,visibleTileKeys} from './POIManager.js';
import {LandmarkRegistry} from './LandmarkRegistry.js';
export function mapRegionAt(regions,x,z){return regions.find(r=>x>=r.bounds.minX&&x<=r.bounds.maxX&&z>=r.bounds.minZ&&z<=r.bounds.maxZ)??null;}
export class RegionMapData {
  constructor({fetcher=globalThis.fetch,lowPerformance=false}={}){this.fetcher=fetcher.bind(globalThis);this.low=lowPerformance;this.epoch=0;this.registry=new LandmarkRegistry();this.bytes={index:0,manifest:0,overview:0,landmarks:0,tiles:0,poi:0,search:0};this.failures=0;}
  async json(url,kind){const r=await this.fetcher(url,{priority:'high'});if(!r.ok)throw Error(`Map data unavailable (${r.status}): ${url}`);let value,bytes=0;if(r.text){const text=await r.text();bytes=new TextEncoder().encode(text).length;value=JSON.parse(text);}else value=await r.json();this.bytes[kind]+=bytes;return value;}
  async init(){if(!this.indexPromise)this.indexPromise=this.json('/data/city-map-v2/regions.json','index').then(index=>this.index=index).catch(error=>{this.indexPromise=null;throw error;});return this.indexPromise;}
  async activate(x,z){await this.init();const region=mapRegionAt(this.index.regions,x,z);if(region?.slug===this.region?.slug&&this.manifest&&this.overview)return true;
    const epoch=++this.epoch;this.cache?.retainQueued(new Set());this.cache?.tiles.clear();this.cache=null;this.pinned=null;this.region=region;this.manifest=null;this.overview=null;this.searchIndex=null;this.searchPromise=null;this.registry.clear();
    if(!region)return false;
    const manifest=await this.json(region.manifest,'manifest');if(epoch!==this.epoch)return false;
    if(manifest.version!==2||manifest.region!==region.slug||manifest.projection.id!==this.index.projection.id)throw Error('Map region/projection mismatch');
    this.manifest=manifest;this.base=region.manifest.replace(/\/manifest\.json$/,'');this.keys=new Set(manifest.tiles);
    const base=this.base;
    // TileCache is shared with legacy POIs, without changing that subsystem.
    this.cache=new TileCache({keys:this.keys,maxTiles:this.low?24:48,concurrency:this.low?2:3,url:key=>`${base}/${manifest.tilePath.replace('{tx}',key.split('_')[0]).replace('{tz}',key.split('_')[1])}`,
      fetcher:async url=>{const tile=await this.json(url,'tiles');if(!Array.isArray(tile.roads)||!Array.isArray(tile.pois)||tile.pois.some(p=>p.region!==region.slug))throw Error('Invalid map tile');this.bytes.poi+=new TextEncoder().encode(JSON.stringify(tile.pois)).length;return {ok:true,json:async()=>tile};}});
    const results=await Promise.allSettled([this.json(`${base}/${manifest.overview}`,'overview'),this.json(`${base}/${manifest.landmarks}`,'landmarks')]);
    if(epoch!==this.epoch)return false;
    if(results[0].status==='fulfilled')this.overview=results[0].value;
    if(results[1].status==='fulfilled')this.registry.install(region.slug,results[1].value.landmarks??[]);
    this.failures+=results.filter(r=>r.status==='rejected').length;
    return true;
  }
  visibleKeys(bounds,mpp){if(!this.manifest||mpp>8)return [];return visibleTileKeys(bounds,this.manifest.tileSize,this.keys,1).slice(0,this.low?20:36);}
  async stream(bounds,mpp,onTile=()=>{}){if(!this.manifest)return;const cache=this.cache,epoch=this.epoch,keys=this.visibleKeys(bounds,mpp);cache.retainQueued(new Set([...keys,...(this.pinned?[this.pinned]:[])]));
    const results=await Promise.allSettled(keys.map(key=>cache.load(key).then(tile=>{if(epoch!==this.epoch)return;if(tile){onTile(tile);}})));if(epoch===this.epoch)this.failures+=results.filter(r=>r.status==='rejected').length;return results;
  }
  visible(bounds){if(!this.cache||!this.manifest)return [];return visibleTileKeys(bounds,this.manifest.tileSize,this.keys,1).map(k=>this.cache.get(k)).filter(Boolean);}
  async search(query,limit=20){const q=String(query??'').trim().toLowerCase();if(!this.manifest||!q)return [];if(!this.searchPromise){const epoch=this.epoch,base=this.base;this.searchPromise=this.json(`${base}/${this.manifest.searchIndex}`,'search').then(index=>{if(epoch!==this.epoch)return null;if(index.region!==this.region.slug)throw Error('Search region mismatch');return this.searchIndex=index.entries.map(([id,name,category,x,z,tileKey,importance,aliases])=>({id,name,category,x,z,tileKey,importance,aliases,region:index.region}));}).catch(error=>{if(epoch===this.epoch){this.searchPromise=null;this.failures++;}throw error;});}
    const index=await this.searchPromise;if(!index)return [];
    return index.map(p=>{const name=p.name.toLowerCase(),alias=(p.aliases??[]).some(a=>a.toLowerCase().includes(q));return {p,score:name===q?10:name.startsWith(q)?7:name.includes(q)?5:alias?6:p.category.replaceAll('_',' ').includes(q)?3:0};}).filter(r=>r.score).sort((a,b)=>b.score-a.score||(b.p.importance??0)-(a.p.importance??0)||a.p.name.localeCompare(b.p.name)).slice(0,limit).map(r=>r.p);
  }
  async details(result){if(result.region!==this.region?.slug)return null;const landmark=this.registry.get(result.id);if(landmark)return landmark;if(['road','neighborhood'].includes(result.category))return result;this.pinned=result.tileKey;try{const tile=await this.cache.load(result.tileKey);return tile?.pois.find(p=>p.id===result.id)??result;}finally{this.pinned=null;}}
  getStats(){const size=value=>value?new TextEncoder().encode(JSON.stringify(value)).length:0;return {region:this.region?.slug??null,bytes:{...this.bytes},retainedJSONBytes:{overview:size(this.overview),landmarks:size(this.registry.all()),tiles:[...(this.cache?.tiles.values()??[])].reduce((sum,tile)=>sum+size(tile),0),search:size(this.searchIndex)},cache:this.cache?.tiles.size??0,cacheLimit:this.cache?.maxTiles??(this.low?24:48),pending:this.cache?.pending.size??0,searchEntries:this.searchIndex?.length??0,landmarks:this.registry.records.size,failures:this.failures};}
  dispose(){this.epoch++;this.cache?.retainQueued(new Set());this.cache?.tiles.clear();this.cache=null;this.registry.clear();}
}
