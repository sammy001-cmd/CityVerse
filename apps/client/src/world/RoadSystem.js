import * as THREE from 'three';
import {
  RoadSurface
} from './RoadSurface.js';
import { RoadGeometry } from './RoadGeometry.js';
import { JunctionBuilder } from './JunctionBuilder.js';
import { RoadTerrainBlend } from './RoadTerrainBlend.js';
import { buildRoadTile } from './RoadTileBuilder.js';
import { unpackGeometry, unpackGroup } from './RoadWorldTransfer.js';
import {worldAssets} from './WorldAssetResolver.js';

export class RoadSystem {
  constructor({
    scene,
    groundY,
    roadMaterial,
    shoulderMaterial,
    markingMaterial,
    baseUrl = '/data/road-tiles',
    loadRadius = 2,
    lowPerformance = false,
    groundMaterial = null, onProgress=null, assetResolver=worldAssets
  }) {
    this.scene = scene;
    this.assetResolver=assetResolver;
    this.groundY = groundY;
    this.lowPerformance=lowPerformance;
    this.onProgress=onProgress;

    this.surface = new RoadSurface({
      terrainY: groundY,
      shoulderWidth: 0.7,
      roadOffset: 0.055
    });
    this.roadGeometry = new RoadGeometry({
      surface: this.surface,
      shoulderWidth: 0.7,
      roadOffset: 0.055,
      lowPerformance
    });
    this.junctionBuilder =
      new JunctionBuilder({
        surface:
          this.surface
      });
    this.colliderManager = null;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.loadRadius = loadRadius;
    this.manifest = null;
    this.tileSize = 250;
    this.available = new Set();
    this.loaded = new Map();
    this.tileData = new Map();
    this.loading = new Map();
    this.desired = new Set();
    this.lastTile = null;
    this.timings={workerMs:0,terrainClippingMs:0,uploadMs:0,colliderMs:0};
    this.requestsStarted=0;this.unloadedCount=0;
    this.roadMaterial = roadMaterial ?? new THREE.MeshStandardMaterial({
      color: 0x34383d,
      roughness: 0.92,
      side: THREE.DoubleSide
    });
    this.shoulderMaterial = shoulderMaterial ?? new THREE.MeshStandardMaterial({
      color: 0x8c8172,
      roughness: 0.95,
      side: THREE.DoubleSide
    });
    this.markingMaterial = markingMaterial ?? new THREE.MeshStandardMaterial({
      color: 0xe7dfbd,
      roughness: 0.85,
      side: THREE.DoubleSide
    });
    // Vertex tint gives hierarchy while retaining one shared asphalt material.
    this.roadMaterial = this.roadMaterial.clone();
    this.roadMaterial.color.set('#ffffff'); this.roadMaterial.vertexColors = true;
    this.roadMaterial.needsUpdate = true;
    this.groundMaterial = groundMaterial ?? this.shoulderMaterial;
    this.concreteMaterial = new THREE.MeshStandardMaterial({color:0xaba698,roughness:1,side:THREE.DoubleSide});
  }

  async init() {
    const response = await this.assetResolver.fetch(`${this.baseUrl}/manifest.json`);
    if (!response.ok) {
      throw new Error(`Road manifest request failed (${response.status}). Run: node pipeline/world/build-road-tiles.mjs`);
    }

    const manifest = await response.json();
    if (!Array.isArray(manifest.tiles) || !Number.isFinite(manifest.tileSize)) {
      throw new Error('Road manifest is malformed; rebuild the road tiles.');
    }

    this.manifest = manifest;
    this.tileSize = manifest.tileSize;
    this.available = new Set(manifest.tiles);

    console.log('Production road system:', manifest.stats);
    return this;
  }

  tileFor(x, z) {
    return [Math.floor(x / this.tileSize), Math.floor(z / this.tileSize)];
  }

  buildTile(data) { return buildRoadTile.call(this,data); }

  async loadTile(tx, tz) {
    if(this.retired)return;
    const key = `${tx}_${tz}`;
    if (this.tileData.has(key) || !this.available.has(key)) return;
    if (this.loading.has(key)) return this.loading.get(key);

    const task = (async () => {
      this.requestsStarted++;
      const response = await this.assetResolver.fetch(`${this.baseUrl}/${key}.json`);
      if (!response.ok) throw new Error(`Road tile ${key} request failed (${response.status}).`);
      const data = await response.json();



      if (this.retired || !this.desired.has(key)) return;
      this.tileData.set(key,data);
      this.onProgress?.('first-required-road-tile');
    })();

    this.loading.set(key, task);
    try {
      await task;
    } finally {
      this.loading.delete(key);
    }
  }

  unloadTile(key, preserveData = false) {
    this.changedWays ??= new Set();
    for(const edge of this.loaded.get(key)?.userData.roadEdges ?? []) this.changedWays.add(edge.roadId);
    this.terrainBlend?.markRoadTile(key);
    if(!preserveData) this.tileData.delete(key);
    const group = this.loaded.get(key);
    if (!group) return;
    this.unloadedCount++;

    this.surface.removeTile(
      key
    );

    this.colliderManager
      ?.removeTile(
        key
      );

    group.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
    });
    this.scene.remove(group);
    this.loaded.delete(key);
  }

  attachColliderManager(
    colliderManager, {bounds=null}={}
  ) {
    this.colliderManager =
      colliderManager;

    for (const [key, group] of this.loaded) {
      if(bounds){const [x,z]=key.split('_').map(Number);if((x+1)*this.tileSize<bounds.minX||x*this.tileSize>bounds.maxX||(z+1)*this.tileSize<bounds.minZ||z*this.tileSize>bounds.maxZ)continue;}
      colliderManager.addTile(
        key,
        group
      );
    }
    this.terrainBlend?.attachPhysics(colliderManager.physics,colliderManager.constructor,{bounds});
  }

  async attachTerrainAsync(terrainMesh,worldSurface){
    const prepared=await RoadTerrainBlend.createAsync({terrainMesh,scene:this.scene,surface:this.surface,tileSize:this.tileSize});
    this.attachTerrain(terrainMesh,worldSurface,{prepared});
  }

  attachTerrain(terrainMesh, worldSurface, {prepared=null}={}) {
    // Staged scenes must sample their own immutable source mesh, even while the
    // active game continues using its critical patch or a previous terrain.
    this.surface.terrainY=(x,z)=>worldSurface.terrainHeightAt(x,z);
    this.terrainBlend=prepared??new RoadTerrainBlend({terrainMesh,scene:this.scene,surface:this.surface,tileSize:this.tileSize});
    worldSurface.setTerrainBlend(this.terrainBlend);
    if (typeof Worker!=='undefined') {
      try {this.worker=new Worker(new URL('./RoadWorldWorker.js',import.meta.url),{type:'module'});}
      catch(error) {console.warn('Road geometry worker unavailable; using synchronous preparation:',error);return;}
      terrainMesh.updateMatrixWorld(true);
      this.workerTerrain={parameters:terrainMesh.geometry.parameters,matrix:terrainMesh.matrixWorld.toArray(),
        attributes:Object.fromEntries(Object.entries(terrainMesh.geometry.attributes).map(([name,a])=>
          [name,{array:a.array,itemSize:a.itemSize}]))};
      this.workerJobs=new Map();this.workerId=0;this.workerFirst=true;
      this.worker.onmessage=(event)=>{
        const job=this.workerJobs.get(event.data.id);if(!job) return;
        this.workerJobs.delete(event.data.id);
        if(event.data.error) job.reject(new Error(event.data.error));else job.resolve(event.data);
      };
      this.worker.onerror=()=>{
        for(const job of this.workerJobs.values()) job.reject(new Error('Road geometry worker failed'));
        this.workerJobs.clear();
      };
    }
  }

  async commitTilesInWorker() {
    const run=async()=>{
      if(this.retired)return;
      if(!this.worker) { this.commitTiles();return; }
      const tiles=[...this.tileData].filter(([key])=>this.desired.has(key));
      const id=++this.workerId;
      try {
        const result=await new Promise((resolve,reject)=>{
          this.workerJobs.set(id,{resolve,reject});
          this.worker.postMessage({id,first:this.workerFirst,terrain:this.workerFirst ? this.workerTerrain : undefined,
            tiles,tileSize:this.tileSize,lowPerformance:this.lowPerformance});
        });
        if(this.retired)return;
        this.workerFirst=false;
        this.timings.workerMs+=result.workerBuildMs??0;this.timings.terrainClippingMs+=result.terrainBuildMs??0;
        const uploadStart=performance.now();
        const colliderBefore=(this.colliderManager?.installMs??0)+(this.terrainBlend.colliders?.installMs??0);
        const requested=new Map(tiles);
        const active=new Set(tiles.map(([key])=>key));
        // Install terrain, road queries, rendering and colliders in one JS turn.
        for(const key of this.loaded.keys()) if(!active.has(key)) this.unloadTile(key,true);
        this.surface.setJunctions(result.junctions);
        this.surface.setConnections(tiles.flatMap(([,data])=>data.roads));
        const materials={asphalt:this.roadMaterial,shoulders:this.shoulderMaterial,blend:this.groundMaterial,
          curbs:this.concreteMaterial,sidewalks:this.concreteMaterial,markings:this.markingMaterial};
        for(const [key,value] of result.roads) {
          const group=unpackGroup(value,materials),previous=this.loaded.get(key);
          this.surface.addTile(key,requested.get(key).roads);this.surface.addRenderedTile(key,group);
          const colliderStart=performance.now();this.colliderManager?.addTile(key,group);this.timings.colliderMs+=performance.now()-colliderStart;
          if(previous) {this.scene.remove(previous);previous.traverse((mesh)=>mesh.geometry?.dispose());}
          this.scene.add(group);this.loaded.set(key,group);
        }
        for(const [key,value] of result.terrain) this.terrainBlend.installGeometry(key,unpackGeometry(value));
        this.terrainBlend.dirty.clear();
        this.terrainBlend.lastBuildMs=result.terrainBuildMs;
        this.timings.uploadMs+=performance.now()-uploadStart-((this.colliderManager?.installMs??0)+(this.terrainBlend.colliders?.installMs??0)-colliderBefore);
      } catch(error) {
        if(this.retired)return;
        this.worker?.terminate();this.worker=null;
        console.warn('Using synchronous road geometry fallback:',error);
        this.commitTiles();
      }
    };
    this.workerQueue=(this.workerQueue ?? Promise.resolve()).then(run,run);
    return this.workerQueue;
  }

  commitTiles() {
    if(this.retired)return;
    for(const key of this.loaded.keys()) if(!this.desired.has(key)) this.unloadTile(key);
    const junctions=[...this.tileData].filter(([key]) => this.desired.has(key)).flatMap(([,data]) => data.junctions);
    const signature=JSON.stringify(junctions);
    const junctionChanged=signature!==this.junctionSignature;
    this.junctionSignature=signature;
    this.surface.setJunctions(junctions);
    this.roadGeometry.connectedRoads=[...this.tileData.values()].flatMap((data)=>data.roads);
    this.surface.setConnections(this.roadGeometry.connectedRoads);
    this.changedWays ??=new Set();
    for(const [key,data] of this.tileData) if(!this.loaded.has(key)) for(const road of data.roads) this.changedWays.add(road.wayId);
    // Rebuild only new tiles or tiles near a changed junction plan.
    const junctionPoints=[...(this.previousJunctions ?? []),...junctions];
    this.previousJunctions=junctions;
    for (const [key,data] of this.tileData) {
      if (!this.desired.has(key)) continue;
      const nearJunction=junctionChanged && junctionPoints.some((j) => data.roads.some((road) =>
        Math.min(Math.hypot(road.a[0]-j.x,road.a[1]-j.z),Math.hypot(road.b[0]-j.x,road.b[1]-j.z))<(j.radius ?? 3)+20));
      if (this.loaded.has(key) && !nearJunction && !data.roads.some((road)=>this.changedWays.has(road.wayId))) continue;
      this.terrainBlend?.markRoadTile(key);
      const previous=this.loaded.get(key);
      this.surface.addTile(key,data.roads);
      const group=this.buildTile(data);
      this.surface.addRenderedTile(key,group);
      this.terrainBlend?.markRoadTile(key);
      this.colliderManager?.addTile(key,group);
      if (previous) {
        this.scene.remove(previous);
        previous.traverse((object) => object.geometry?.dispose());
      }
      this.scene.add(group); this.loaded.set(key,group);
    }
    this.terrainBlend?.flush();
    this.changedWays.clear();
  }

  getRoadEdges(bounds = null) {
    const edges=[...this.loaded.values()].flatMap((group) => group.userData.roadEdges ?? []);
    return bounds ? edges.filter((edge) => Math.max(edge.a[0],edge.b[0])+edge.width/2>=bounds.minX &&
      Math.min(edge.a[0],edge.b[0])-edge.width/2<=bounds.maxX && Math.max(edge.a[1],edge.b[1])+edge.width/2>=bounds.minZ &&
      Math.min(edge.a[1],edge.b[1])-edge.width/2<=bounds.maxZ) : edges;
  }

  getStats() {
    const totals={triangles:0,drawCalls:0,roadTriangles:0,junctionTriangles:0,markingTriangles:0,segments:0,tiles:this.loaded.size,
      roadGeometryMs:0,markingGenerationMs:0,junctionGenerationMs:0,junctionClipMs:0};
    for(const group of this.loaded.values()){
      const timing=group.userData.roadTimings??{};totals.roadGeometryMs+=timing.geometryMs??0;totals.markingGenerationMs+=timing.markingGenerationMs??0;
      totals.junctionGenerationMs+=timing.junctionGenerationMs??0;totals.junctionClipMs+=timing.junctionClipMs??0;
      for(const mesh of group.children){
      const triangles=(mesh.geometry?.index?.count??mesh.geometry?.attributes?.position?.count??0)/3;
      totals.drawCalls++;totals.triangles+=triangles;
      if(mesh.name==='RoadJunctions')totals.junctionTriangles+=triangles;
      else if(mesh.userData.part==='markings')totals.markingTriangles+=triangles;
      else totals.roadTriangles+=triangles;
      }
    }
    totals.segments=[...this.tileData].filter(([key])=>this.desired.has(key)).reduce((sum,[,tile])=>sum+tile.roads.length,0);
    totals.classCounts={};for(const edge of this.getRoadEdges())totals.classCounts[edge.type]=(totals.classCounts[edge.type]??0)+1;
    const terrainTriangles=this.terrainBlend?[...this.terrainBlend.tiles.values()].reduce((n,g)=>n+(g.children[0]?.geometry.attributes.position.count??0)/3,0):0;
    return {...totals,...this.timings,terrainTriangles,cachedTiles:this.tileData.size,requestedTiles:this.requestsStarted,
      unloadedTiles:this.unloadedCount,desiredTiles:this.desired.size,availableTiles:this.available.size,loadingTiles:this.loading.size};
  }

  async primeSpawn(x,z) {
    const result=await this.update(x,z,{spawnOnly:true});this.lastTile=null;return result;
  }
  update(x, z, {spawnOnly=false}={}) {
    if(this.retired)return Promise.resolve();
    const [tx, tz] = this.tileFor(x, z);
    const currentKey = `${tx}_${tz}`;
    if (currentKey === this.lastTile) return this.pending;
    this.lastTile = currentKey;

    const wanted =
      new Set();

    for (
      let dx =
        -this.loadRadius;

      dx <=
        this.loadRadius;

      dx++
    ) {
      for (
        let dz =
          -this.loadRadius;

        dz <=
          this.loadRadius;

        dz++
      ) {
        const key = `${tx + dx}_${tz + dz}`;
        if(spawnOnly&&((tx+dx+1)*this.tileSize<x-20||(tx+dx)*this.tileSize>x+20||(tz+dz+1)*this.tileSize<z-20||(tz+dz)*this.tileSize>z+20))continue;

        if (
          this.available.has(
            key
          )
        ) {
          wanted.add(
            key
          );
        }
      }
    }

    this.desired =
      wanted;

    const jobs =
      [];

    for (
      const key
      of wanted
    ) {
      const [
        tileX,
        tileZ
      ] =
        key
          .split('_')
          .map(Number);

      jobs.push(
        this.loadTile(
          tileX,
          tileZ
        )
      );
    }

    for (const key of this.tileData.keys()) {
      if (!wanted.has(key)) {
        if(this.worker) this.tileData.delete(key);else this.unloadTile(key);
      }
    }

    this.pending=Promise.allSettled(jobs).then(async (results) => {
      if(this.retired)return;
      if(this.worker) await this.commitTilesInWorker();else this.commitTiles();
      if (results.some((result) => result.status==='rejected')) {
        this.lastTile=null;
        throw new Error('Some road tiles failed; retrying on the next update.');
      }
    });
    return this.pending;
  }

  // In-flight fetches and worker continuations must not reinstall a retired
  // terrain/road owner after a staged handover has removed its colliders.
  retire(){
    this.retired=true;
    for(const job of this.workerJobs?.values()??[])job.reject(new Error('Road owner retired'));
    this.workerJobs?.clear();this.worker?.terminate();this.worker=null;
  }

  
  sampleSurface(
    x,
    z
  ) {
    return this.surface.sample(
      x,
      z
    );
  }

  getNearestSpawn(x = 0, z = 0) {
    const points = this.manifest?.spawnPoints ?? [];
    if (!points.length) throw new Error('Road manifest contains no spawn points.');

    let best = points[0];
    let bestDistance = Infinity;
    for (const point of points) {
      const distance = Math.hypot(point[0] - x, point[1] - z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = point;
      }
    }
    return best;
  }
}
