import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {cleanRing,selectLOD,pointInRing,roadOverlap,validHoles} from './BuildingRules.js';
import {buildingMaterials,buildBuildingGeometry} from './BuildingGeometry.js';
import {unpackGeometry} from './RoadWorldTransfer.js';

export function decodeBuilding(row,tile,heightAt) {
  if(!Array.isArray(row)||typeof row[0]!=='string'||!Number.isInteger(row[1])||row[1]<0||row[1]>15||!Number.isFinite(row[2])||row[2]<=0||row[2]>300||!Number.isFinite(row[3])||row[3]<=0||!['flat','gabled','hipped'].includes(row[4])||!Number.isInteger(row[5])||!Array.isArray(row[6])||!Number.isFinite(row[10])||row[10]<0||row[10]>=row[2])return null;
  const polygons=row[6].map(p=>Array.isArray(p)?p.map(r=>Array.isArray(r)?cleanRing(r.map(v=>Array.isArray(v)&&v.length===2&&v.every(Number.isFinite)?[v[0]*0.1+tile.tx*250,v[1]*0.1+tile.tz*250]:[])):null):[]);
  if(!polygons.length||polygons.some(p=>!p.length||p.some(r=>!r)||!validHoles(p)))return null;
  const pts=polygons.flatMap(p=>p[0]),xs=pts.map(p=>p[0]),zs=pts.map(p=>p[1]),ys=pts.map(p=>heightAt(...p));if(!ys.every(Number.isFinite))return null;
  return {id:row[0],family:row[1],height:row[2],levels:row[3],roof:row[4],seed:row[5],polygons,name:row[7],verified:!!row[8],heightSource:row[9],minHeight:row[10],semantic:row[11],wallMaterial:row[12],roofMaterial:row[13],baseY:Math.max(...ys),foundationBottom:Math.min(...ys),minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)};
}

export class BuildingSystem {
  constructor({scene,worldSurface,roadSystem,physics=null,lowPerformance=false,baseUrl='/data/building-tiles',cacheLimit=32,fetcher=(...args) => globalThis.fetch(...args),worker=true,overrides=new Map()}) {
    Object.assign(this,{scene,worldSurface,roadSystem,physics,lowPerformance,baseUrl,cacheLimit:Math.max(1,cacheLimit),fetcher,overrides});
    this.radius=lowPerformance?1:2;this.loaded=new Map();this.cache=new Map();this.loading=new Map();this.desired=new Set();this.available=new Set();this.materials=buildingMaterials();this.jobs=new Map();this.serial=0;this.overlaps=new Map();this.blockers=new Map();
    if(worker&&typeof Worker!=='undefined') {
      this.worker=new Worker(new URL('./BuildingWorker.js',import.meta.url),{type:'module'});
      this.worker.onmessage=({data})=>{const job=this.jobs.get(data.id);if(!job)return;this.jobs.delete(data.id);data.error?job.reject(new Error(data.error)):job.resolve(data.geometry.map(g=>g?unpackGeometry(g):null));};
      this.worker.onerror=()=>{for(const job of this.jobs.values())job.reject(new Error('Building worker failed'));this.jobs.clear();this.worker?.terminate();this.worker=null;this.lastKey=null;};
    }
  }
  async init() {
    const r=await this.fetcher(`${this.baseUrl}/manifest.json`);if(!r.ok)throw new Error('Building manifest missing; run offline building pipeline');
    this.manifest=await r.json();if(this.manifest.version!==1||this.manifest.tileSize!==250||this.manifest.quantization!==0.1||!Array.isArray(this.manifest.tiles))throw new Error('Malformed building manifest');
    const origin=this.roadSystem?.manifest?.center;
    if(origin&&(this.manifest.center?.lat!==origin.lat||this.manifest.center?.lon!==origin.lon))throw new Error('Building and road coordinate origins disagree');
    this.available=new Set(this.manifest.tiles);return this;
  }
  async tileData(key) {
    if(this.cache.has(key)){const d=this.cache.get(key);this.cache.delete(key);this.cache.set(key,d);return d;}
    if(this.loading.has(key))return this.loading.get(key);
    const task=(async()=>{const r=await this.fetcher(`${this.baseUrl}/tiles/${key}.json`);if(!r.ok)throw new Error(`Building tile ${key}: ${r.status}`);const d=await r.json();if(`${d.tx}_${d.tz}`!==key||!Array.isArray(d.buildings))throw new Error('Malformed building tile');this.cache.set(key,d);while(this.cache.size>this.cacheLimit)this.cache.delete(this.cache.keys().next().value);return d;})();
    this.loading.set(key,task);try{return await task;}finally{this.loading.delete(key);}
  }
  prepare(records,lod) {if(!this.worker)return Promise.resolve(buildBuildingGeometry(records,lod));const id=++this.serial;return new Promise((resolve,reject)=>{this.jobs.set(id,{resolve,reject});this.worker.postMessage({id,records,lod});});}
  unload(key) {const tile=this.loaded.get(key);if(!tile)return;this.scene.remove(tile.group);tile.group.traverse(o=>o.geometry?.dispose());for(const c of tile.colliders)this.physics?.world.removeCollider(c,true);const removed=new Set(tile.records);for(const [cell,list] of this.blockers){const remaining=list.filter(b=>!removed.has(b));remaining.length?this.blockers.set(cell,remaining):this.blockers.delete(cell);}this.loaded.delete(key);this.overlaps.delete(key);}
  // Future custom landmark factories replace procedural geometry by OSM ID.
  async install(key,lod,epoch) {
    const data=await this.tileData(key);if(epoch!==this.epoch||!this.desired.has(key))return;
    const records=data.buildings.map(r=>decodeBuilding(r,data,(x,z)=>this.worldSurface.heightAt(x,z))).filter(Boolean);
    const conflicts=[];
    const bounds=records.reduce((v,b)=>({minX:Math.min(v.minX,b.minX),maxX:Math.max(v.maxX,b.maxX),minZ:Math.min(v.minZ,b.minZ),maxZ:Math.max(v.maxZ,b.maxZ)}),{minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity});
    const candidates=records.length?(this.roadSystem?.getRoadEdges(bounds)??[]):[];
    for(const b of records) {
      const edges=candidates.filter(e=>Math.max(e.a[0],e.b[0])+e.width/2>=b.minX&&Math.min(e.a[0],e.b[0])-e.width/2<=b.maxX&&Math.max(e.a[1],e.b[1])+e.width/2>=b.minZ&&Math.min(e.a[1],e.b[1])-e.width/2<=b.maxZ);
      const roadId=b.polygons.map(p=>roadOverlap(p,edges)).find(id=>id!==null);
      if(roadId!==undefined){conflicts.push({id:b.id,roadId});b.roadConflict=true;}
      b.roadEdges=edges.map(e=>({roadId:e.roadId,left:e.sections?.[0]?.setbackLeft,right:e.sections?.[0]?.setbackRight}));
    }
    // Conflicting source footprints remain in metadata; defer rendering/collision until corrected.
    const active=records.filter(b=>!b.roadConflict),procedural=active.filter(b=>!this.overrides.has(b.id));
    const geometry=await this.prepare(procedural,lod);
    if(epoch!==this.epoch||!this.desired.has(key)){geometry.forEach(g=>g?.dispose());return;}
    this.unload(key);const group=new THREE.Group();group.name=`Buildings:${key}:${lod}`;const colliders=[];
    geometry.forEach((g,i)=>{if(g){const m=new THREE.Mesh(g,this.materials[i]);m.receiveShadow=true;group.add(m);}});
    for(const b of active) {if(this.overrides.has(b.id)){const obj=this.overrides.get(b.id)(b);if(obj)group.add(obj);} }
    if(this.physics) {
      // Triangle walls retain concave outlines and courtyard openings; one collider per tile.
      const positions=[];
      for(const g of geometry.slice(0,2))if(g)for(const value of g.attributes.position.array)positions.push(value);
      for(const b of active.filter(b=>this.overrides.has(b.id)))for(const rings of b.polygons)for(const ring of rings)for(let i=0;i<ring.length;i++) {
        const a=ring[i],c=ring[(i+1)%ring.length],bottom=b.minHeight?b.baseY+b.minHeight:b.foundationBottom-0.2,top=b.baseY+b.height;
        positions.push(a[0],bottom,a[1],c[0],bottom,c[1],c[0],top,c[1],a[0],bottom,a[1],c[0],top,c[1],a[0],top,a[1]);
      }
      if(positions.length)colliders.push(this.physics.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(positions),Uint32Array.from({length:positions.length/3},(_,i)=>i)).setFriction(0.5)));
    }
    this.scene.add(group);this.loaded.set(key,{group,records:active,sourceRecords:records,lod,colliders});this.overlaps.set(key,conflicts);
    for(const b of active)for(let x=Math.floor(b.minX/50);x<=Math.floor(b.maxX/50);x++)for(let z=Math.floor(b.minZ/50);z<=Math.floor(b.maxZ/50);z++){const cell=`${x}_${z}`;if(!this.blockers.has(cell))this.blockers.set(cell,[]);this.blockers.get(cell).push(b);}
  }
  async update(x,z) {
    const tx=Math.floor(x/250),tz=Math.floor(z/250),key=`${tx}_${tz}`;
    // Refresh when road streaming commits, even if the player stays in the same tile.
    const roads=[...(this.roadSystem?.loaded??new Map())].map(([k,g])=>`${k}:${g.uuid??''}`).sort().join(',');
    if(this.lastKey===`${key}|${roads}`)return;this.lastKey=`${key}|${roads}`;const epoch=this.epoch=(this.epoch??0)+1;const wanted=new Set();
    for(let dx=-this.radius;dx<=this.radius;dx++)for(let dz=-this.radius;dz<=this.radius;dz++){const k=`${tx+dx}_${tz+dz}`;if(this.available.has(k))wanted.add(k);}
    this.desired=wanted;for(const k of this.loaded.keys())if(!wanted.has(k))this.unload(k);
    // Sequential preparation bounds pending worker data and yields between tiles.
    try {for(const k of wanted){const [a,b]=k.split('_').map(Number),distance=Math.hypot(Math.max(a*250-x,0,x-(a+1)*250),Math.max(b*250-z,0,z-(b+1)*250)),lod=selectLOD(distance,this.lowPerformance);if(this.loaded.get(k)?.lod===lod&&this.loaded.get(k)?.roads===roads)continue;await this.install(k,lod,epoch);if(epoch!==this.epoch)return;if(this.loaded.has(k))this.loaded.get(k).roads=roads;if(!this.worker)await new Promise(resolve=>setTimeout(resolve,0));}}
    catch(e){if(epoch===this.epoch)this.lastKey=null;throw e;}
  }
  blockedPoint(x,z) {for(const b of this.blockers.get(`${Math.floor(x/50)}_${Math.floor(z/50)}`)??[])if(x>=b.minX&&x<=b.maxX&&z>=b.minZ&&z<=b.maxZ&&(!b.minHeight||b.baseY+b.minHeight<this.worldSurface.heightAt(x,z)+1.8)&&b.polygons.some(p=>pointInRing(x,z,p[0])&&!p.slice(1).some(r=>pointInRing(x,z,r))))return true;return false;}
  getBuildings(bounds=null) {const records=[...this.loaded.values()].flatMap(t=>t.sourceRecords);return bounds?records.filter(b=>b.maxX>=bounds.minX&&b.minX<=bounds.maxX&&b.maxZ>=bounds.minZ&&b.minZ<=bounds.maxZ):records;}
  getStats() {let buildings=0,drawCalls=0,triangles=0;for(const t of this.loaded.values()){buildings+=t.records.length;t.group.traverse(o=>{if(o.isMesh){drawCalls++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}});}return {buildings,tiles:this.loaded.size,drawCalls,triangles,overlaps:[...this.overlaps.values()].flat().length,cache:this.cache.size};}
  dispose() {this.epoch=(this.epoch??0)+1;this.desired.clear();for(const k of this.loaded.keys())this.unload(k);this.worker?.terminate();for(const job of this.jobs.values())job.reject(new Error('Building system disposed'));this.jobs.clear();this.cache.clear();this.materials.forEach(m=>m.dispose());}
}
