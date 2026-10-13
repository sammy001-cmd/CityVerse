import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { pointInRing } from './BuildingRules.js';
import {architecturalLOD,distanceToBuilding,nearestRoadFront} from './BuildingArchitecture.js';
import {BuildingOverrideRegistry} from './BuildingOverrideRegistry.js';
import {createBuildingBuilder,appendBuildingRecords,finishBuildingBuilder,buildCollisionPositions} from './BuildingMeshData.js';
import { decodeBuilding, selectRegion, validateManifest, roadOverlapRatio } from './BuildingData.js';
import { buildingMaterials, geometriesFromData } from './BuildingGeometry.js';
import {prepareResidentialTileMetadata} from './ResidentialMetadata.js';
import {ResidentialRegistry} from './ResidentialRegistry.js';
export { decodeBuilding } from './BuildingData.js';
const yieldFrame = () => new Promise(r => setTimeout(r, 0));
export class BuildingSystem {
    constructor({ scene, worldSurface, roadSystem, physics = null, lowPerformance = false, fetcher = (...args) => globalThis.fetch(...args), worker = true, cacheLimit = lowPerformance ? 32 : 64, concurrency = 3, lodDebug=false, housingDebug=null, housingContextProvider=null, onProgress=null, overrides=new BuildingOverrideRegistry() }) {
        Object.assign(this, { scene, worldSurface, roadSystem, physics, lowPerformance, fetcher, cacheLimit, concurrency });
        this.lodDebug=lodDebug;
        this.housingDebug=housingDebug;
        this.onProgress=onProgress;
        this.housingContextProvider=housingContextProvider;
        this.housing=new ResidentialRegistry();
        this.residentialCache=new Map();
        this.overrides=overrides;
        this.concurrency = Math.max(1, Math.min(4, Math.floor(concurrency) || 3));
        this.cacheLimit = Math.max(1, Math.min(128, Math.floor(cacheLimit) || 32));
        this.activeRequests = 0;
        this.requestSlots = [];
        this.radius = lowPerformance ? 2 : 3;
        this.blockers = new Map();
        this.loaded = new Map();
        this.cache = new Map();
        this.loading = new Map();
        this.available = new Set();
        this.materials = buildingMaterials();
        this.jobs = new Map();
        this.serial = 0;
        this.epoch = 0;
        this.disposed = false;
        this.metrics = { malformed: 0, conflicts: 0, bytes: 0, tileMs: 0, geometryMs: 0, geometryPeakMs: 0, geometryJobs: 0, failures: 0,workerMs:0,workerPeakMs:0,workerJobs:0,housingMs:0,housingPeakMs:0,housingJobs:0 };
        if (worker && typeof Worker !== 'undefined')
            try {
                this.worker = new Worker(new URL('./BuildingWorker.js', import.meta.url), { type: 'module' });
                this.worker.onmessage = ({ data }) => {
                    const j = this.jobs.get(data.id);
                    if (!j)
                        return;
                    this.jobs.delete(data.id);
                    clearTimeout(j.timeout);
                    data.error ? j.reject(new Error(data.error)) : j.resolve(geometriesFromData(data));
                };
                this.worker.onerror = () => this.failWorker(new Error('Building worker failed'));
            }
            catch (error) {
                console.warn('Building worker unavailable; using yielding fallback:', error);
            }
    }
    failWorker(error) {
        this.worker?.terminate();
        this.worker = null;
        for (const j of this.jobs.values()) {
            clearTimeout(j.timeout);
            j.reject(error);
        }
        this.jobs.clear();
    }
    async init() {
        const r = await this.fetcher('/data/world/regions.json');
        if (!r.ok)
            throw new Error(`Building region index: ${r.status}`);
        this.index = await r.json();
        if (this.index.version !== 1 || !Array.isArray(this.index.regions) || this.index.projection?.id !== 'cityverse-metric-v1')
            throw new Error('Unsupported world region index');
        return this;
    }
    // Region transitions discard every previous geometry, collider and cached tile.
    clearRegion() {
        this.epoch++;
        for (const key of this.loaded.keys())
            this.unload(key);
        for (const { controller } of this.loading.values())
            controller.abort();
        this.loading.clear();
        this.cache.clear();
        this.residentialCache.clear();
        this.housing.clear();
        this.available.clear();
        this.manifest = null;
        this.region = null;
        this.lastKey = null;
    }
    async activate(region) {
        this.clearRegion();
        if (!region?.layers.buildings?.available)
            return;
        const epoch = this.epoch;
        this.region = region.slug;
        this.housing.clear(region.slug);
        this.housingProfile=region.housingProfile??{};
        const url = region.layers.buildings.manifest;
        if (!/^\/data\/world\/[a-z0-9-]+\/buildings\/manifest\.json$/.test(url))
            throw new Error('Unsafe building manifest path');
        const r = await this.fetcher(url);
        if (!r.ok)
            throw new Error(`Building manifest ${region.slug}: ${r.status}`);
        const m = validateManifest(await r.json(), region.slug, this.index.projection);
        if (epoch !== this.epoch || this.disposed)
            return;
        const origin = this.roadSystem?.manifest?.center;
        if (origin && (origin.lat !== m.center.lat || origin.lon !== m.center.lon))
            throw new Error('Building and road origins disagree');
        this.manifest = m;
        this.baseUrl = url.slice(0, url.lastIndexOf('/'));
        this.available = new Set(m.tiles);
    }
    async acquireRequest() {
        if (this.activeRequests < this.concurrency) {
            this.activeRequests++;
            return;
        }
        await new Promise(resolve => this.requestSlots.push(resolve));
    }
    releaseRequest() {
        const next = this.requestSlots.shift();
        if (next)
            next();
        else
            this.activeRequests--;
    }
    async tileData(key) {
        if (!this.available.has(key))
            throw new Error(`Unavailable building tile ${key}`);
        const scoped = `${this.region}:${key}`;
        if (this.cache.has(scoped)) {
            const d = this.cache.get(scoped);
            this.cache.delete(scoped);
            this.cache.set(scoped, d);
            return d;
        }
        if (this.loading.has(scoped))
            return this.loading.get(scoped).promise;
        const controller = new AbortController(), epoch = this.epoch, start = performance.now();
        const promise = (async () => {
            await this.acquireRequest();
            try {
                const r = await this.fetcher(`${this.baseUrl}/tiles/${key}.json`, { signal: controller.signal });
                if (!r.ok)
                    throw new Error(`Building tile ${scoped}: ${r.status}`);
                let d;
                if (r.text) {
                    const text = await r.text();
                    this.metrics.bytes += new TextEncoder().encode(text).byteLength;
                    d = JSON.parse(text);
                }
                else
                    d = await r.json();
                if (`${d.tx}_${d.tz}` !== key || !Number.isInteger(d.tx) || !Number.isInteger(d.tz) || !Array.isArray(d.buildings) || !Array.isArray(d.strings) || d.strings[0] !== null || (d.schemaVersion !== undefined && d.schemaVersion !== 2) || (d.version !== undefined && d.version !== 1))
                    throw new Error(`Malformed building tile ${scoped}`);
                if (epoch !== this.epoch)
                    throw new Error('Stale building region');
                this.cache.set(scoped, d);
                while (this.cache.size > this.cacheLimit) {
                    const oldest=this.cache.keys().next().value;
                    this.cache.delete(oldest);
                    this.residentialCache.delete(oldest);
                }
                this.metrics.tileMs = performance.now() - start;
                this.onProgress?.('first-building-tile');
                return d;
            }
            finally {
                this.releaseRequest();
            }
        })();
        this.loading.set(scoped, { promise, controller });
        try {
            return await promise;
        }
        finally {
            if (this.loading.get(scoped)?.promise === promise)
                this.loading.delete(scoped);
        }
    }
    async prepare(records, lod, options={}) {
        const start = performance.now();
        let geometry;
        options={lowPerformance:this.lowPerformance,lodDebug:this.lodDebug,housingDebug:this.housingDebug,...options};
        if (this.worker)
            try {
                const id = ++this.serial;
                const visualRecords=records.map(b=>{
                    const h=b.housing;
                    return !h?b:{...b,housing:{propertyUse:h.propertyUse,qualityTier:h.qualityTier,finishQuality:h.finishQuality,
                        visualSeed:h.visualSeed,luxuryEligible:h.luxuryEligible,residentialArchetype:h.residentialArchetype,neighborhoodProfile:h.neighborhoodProfile}};
                });
                geometry = await new Promise((resolve, reject) => { const timeout = setTimeout(() => this.failWorker(new Error('Building worker timed out')), 15000); this.jobs.set(id, { resolve, reject, timeout }); this.worker.postMessage({ id, records:visualRecords, lod, options }); });
                this.metrics.workerMs+=geometry.workerMs;
                this.metrics.workerPeakMs=Math.max(this.metrics.workerPeakMs,geometry.workerMs);
                this.metrics.workerJobs++;
            }
            catch (error) {
                this.failWorker(error);
                console.warn('Building preparation fallback:', error);
            }
        if (!geometry) {
            const builder=createBuildingBuilder(options);
            for (let i = 0; i < records.length; i += 16) {
                appendBuildingRecords(builder,records.slice(i,i+16),lod);
                await yieldFrame();
            }
            geometry=geometriesFromData(finishBuildingBuilder(builder));
        }
        const ms = performance.now() - start;
        this.metrics.geometryMs += ms;
        this.metrics.geometryPeakMs = Math.max(this.metrics.geometryPeakMs, ms);
        this.metrics.geometryJobs++;
        return geometry;
    }
    unload(key) {
        const t = this.loaded.get(key);
        if (!t)
            return;
        this.scene.remove(t.group);
        t.group.traverse(o => o.geometry?.dispose());
        if (t.collider)
            this.physics?.world.removeCollider(t.collider, true);
        const removed = new Set(t.records);
        for (const [cell, list] of this.blockers) {
            const rest = list.filter(b => !removed.has(b));
            if (rest.length)
                this.blockers.set(cell, rest);
            else
                this.blockers.delete(cell);
        }
        this.loaded.delete(key);
        this.housing.removeTile(key);
    }
    async install(key, lod, epoch, roads, view=[0,0]) {
        const data = await this.tileData(key);
        if (epoch !== this.epoch)
            return;
        const records = [], decoded = [], conflicts = [];
        let malformed = 0;
        let processed = 0;
        for (const row of data.buildings) {
            const b = decodeBuilding(row, data, (x, z) => this.worldSurface.heightAt(x, z), this.manifest);
            if (!b) {
                malformed++;
                continue;
            }
            decoded.push(b);
            if (++processed % 16 === 0) await yieldFrame();
        }
        if(epoch!==this.epoch||this.disposed)return;
        const housingKey=`${this.region}:${key}`;
        let residential=this.residentialCache.get(housingKey);
        if(!residential) {
            residential=await prepareResidentialTileMetadata(decoded,{region:this.region,tx:data.tx,tz:data.tz,
                housingProfile:this.housingProfile,context:this.housingContextProvider?.({region:this.region,key,data})??null});
            if(epoch!==this.epoch||this.disposed)return;
            this.residentialCache.set(housingKey,residential);
            while(this.residentialCache.size>this.cacheLimit)this.residentialCache.delete(this.residentialCache.keys().next().value);
            this.metrics.housingMs+=residential.buildMs;
            this.metrics.housingPeakMs=Math.max(this.metrics.housingPeakMs,residential.buildMs);
            this.metrics.housingJobs++;
        }
        for(const b of decoded)b.housing=residential.metadata.get(b.id);
        const bounds = decoded.reduce((v, b) => ({
            minX: Math.min(v.minX, b.minX-60), maxX: Math.max(v.maxX, b.maxX+60),
            minZ: Math.min(v.minZ, b.minZ-60), maxZ: Math.max(v.maxZ, b.maxZ+60)
        }), {minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity});
        const candidates = decoded.length ? this.roadSystem?.getRoadEdges(bounds) ?? [] : [];
        const previousLODs=new Map(this.loaded.get(key)?.records.map(b=>[b.id,b.visualLOD])??[]);
        for (const b of decoded) {
            const edges = candidates.filter(e => Math.max(e.a[0], e.b[0]) + e.width / 2 >= b.minX &&
                Math.min(e.a[0], e.b[0]) - e.width / 2 <= b.maxX &&
                Math.max(e.a[1], e.b[1]) + e.width / 2 >= b.minZ &&
                Math.min(e.a[1], e.b[1]) - e.width / 2 <= b.maxZ);
            if (roadOverlapRatio(b, edges) >= 0.25) {
                conflicts.push(b.id);
                continue;
            }
            b.frontage=nearestRoadFront(b,candidates);
            const previous=previousLODs.get(b.id);
            b.visualLOD=architecturalLOD(distanceToBuilding(b,...view),this.lowPerformance,previous);
            records.push(b);
        }
        const overrides=[];
        const procedural=records.filter(b=>{
          if(!this.overrides.has(b.id))return true;
          const object=this.overrides.create(b,{lod:b.visualLOD,worldSurface:this.worldSurface});
          if(object)overrides.push(object);
          return false;
        });
        const geometry = await this.prepare(procedural, lod);
        if (epoch !== this.epoch || this.disposed) {
            geometry.forEach(g => g?.dispose());
            return;
        }
        this.unload(key);
        const group = new THREE.Group();
        group.name = `Buildings:${this.region}:${key}:${lod}`;
        geometry.forEach((g, i) => {
            if (g) {
                const m = new THREE.Mesh(g, this.materials[i]);
                m.receiveShadow = true;
                group.add(m);
            }
        });
        for(const object of overrides)group.add(object);
        this.scene.add(group);
        this.loaded.set(key, { group, records, lod, roads, conflicts, malformed, collider: null, buildStats:geometry.buildStats, lodSignature:records.map(b=>b.visualLOD).join(',') });
        this.housing.installTile(key,records);
        this.onProgress?.('first-building-rendered');
        for (const b of records)
            for (let x = Math.floor(b.minX / 50); x <= Math.floor(b.maxX / 50); x++)
                for (let z = Math.floor(b.minZ / 50); z <= Math.floor(b.maxZ / 50); z++) {
                    const cell = `${x}_${z}`;
                    if (!this.blockers.has(cell))
                        this.blockers.set(cell, []);
                    this.blockers.get(cell).push(b);
                }
    }
    // At most nine tile colliders. One footprint shell batch per nearby tile.
    async syncColliders(tx, tz) {
        for (const [key, t] of this.loaded) {
            const [x, z] = key.split('_').map(Number), near = Math.abs(x - tx) <= 1 && Math.abs(z - tz) <= 1;
            if (!near && t.collider) {
                this.physics?.world.removeCollider(t.collider, true);
                t.collider = null;
            }
            if (near && this.physics && !t.collider) {
                const positions=buildCollisionPositions(t.records);
                const n=positions.length;
                if (n) {
                    t.collider = this.physics.world.createCollider(RAPIER.ColliderDesc.trimesh(positions, Uint32Array.from({ length: n / 3 }, (_, i) => i)).setFriction(0.5));
                    await yieldFrame();
                }
            }
        }
    }
    update(x, z) {
        if (this.disposed)
            return Promise.resolve();
        this.nextPosition = [x, z];
        if (this.updating)
            return this.updating;
        this.updating = this.drain().finally(() => { this.updating = null; });
        return this.updating;
    }
    async drain() {
        while (this.nextPosition && !this.disposed) {
            const [x, z] = this.nextPosition;
            this.nextPosition = null;
            try {
                await this.stream(x, z);
            }
            catch (error) {
                this.lastKey = null;
                this.metrics.failures++;
                this.retryAt = performance.now() + 5000;
                console.error(`Building streaming [${this.region ?? 'regions'}]:`, error);
            }
        }
    }
    async stream(x, z) {
        if (this.retryAt > performance.now())
            return;
        const region = selectRegion(this.index, x, z, this.region);
        if ((region?.slug ?? null) !== this.region || (region?.layers.buildings?.available && !this.manifest)) {
            await this.activate(region);
        }
        if (!this.manifest)
            return;
        const tx = Math.floor(x / 250), tz = Math.floor(z / 250), roads = [...(this.roadSystem?.loaded ?? new Map())].map(([k, g]) => `${k}:${g.uuid ?? ''}`).join(','), stamp = `${tx}_${tz}|${Math.floor(x/30)}_${Math.floor(z/30)}|${roads}|${this.overrides.version}`;
        if (stamp === this.lastKey && performance.now() < (this.retryTilesAt ?? Infinity))
            return;
        this.lastKey = stamp;
        this.retryTilesAt = Infinity;
        const epoch = this.epoch, wanted = [];
        for (let dx = -this.radius; dx <= this.radius; dx++)
            for (let dz = -this.radius; dz <= this.radius; dz++) {
                const key = `${tx + dx}_${tz + dz}`;
                if (this.available.has(key))
                    wanted.push(key);
            }
        const set = new Set(wanted);
        for (const key of this.loaded.keys())
            if (!set.has(key))
                this.unload(key);
        wanted.sort((a, b) => { const distance = k => { const [u, v] = k.split('_').map(Number); return Math.hypot(u - tx, v - tz); }; return distance(a) - distance(b); });
        // A bounded prefetch pool; geometry/GPU and physics installs stay sequential.
        const prefetch=key=>{if(key)void this.tileData(key).catch(()=>{});};
        wanted.slice(0,this.concurrency).forEach(prefetch);
        for (const key of wanted) {
            prefetch(wanted[wanted.indexOf(key)+this.concurrency]);
            if (epoch !== this.epoch || this.disposed)
                return;
            const tile=this.loaded.get(key);
            const signature=tile?.records.map(b=>architecturalLOD(distanceToBuilding(b,x,z),this.lowPerformance,b.visualLOD)).join(',');
            if(tile?.lodSignature===signature&&tile?.roads===roads&&tile?.overrideVersion===this.overrides.version)continue;
            try {
                await this.install(key, 'mixed', epoch, roads, [x,z]);
                if(this.loaded.has(key))this.loaded.get(key).overrideVersion=this.overrides.version;
                const [u,v]=key.split('_').map(Number);
                if(Math.abs(u-tx)<=1&&Math.abs(v-tz)<=1)await this.syncColliders(tx,tz);
                if(wanted.filter(k=>{const [a,b]=k.split('_').map(Number);return Math.abs(a-tx)<=1&&Math.abs(b-tz)<=1;}).every(k=>this.loaded.has(k)))this.onProgress?.('building-near-ring-complete');
            }
            catch (error) {
                this.metrics.failures++;
                this.retryTilesAt = performance.now() + 5000;
                console.warn(`Building geometry skipped [${this.region}:${key}]:`, error);
            }
            await yieldFrame();
        }
        await this.syncColliders(tx, tz);
    }
    blockedPoint(x, z) {
        for (const b of this.blockers.get(`${Math.floor(x / 50)}_${Math.floor(z / 50)}`) ?? [])
            if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && (!b.minHeight || b.baseY + b.minHeight < this.worldSurface.heightAt(x, z) + 1.8) && b.polygons.some(p => pointInRing(x, z, p[0]) && !p.slice(1).some(r => pointInRing(x, z, r))))
                return true;
        return false;
    }
    getBuildings(bounds = null) { return [...this.loaded.values()].flatMap(t => t.records).filter(b => !bounds || b.maxX >= bounds.minX && b.minX <= bounds.maxX && b.maxZ >= bounds.minZ && b.minZ <= bounds.maxZ); }
    getBuildingCount() {
        let count = 0;
        for (const tile of this.loaded.values()) count += tile.records.length;
        return count;
    }
    getHousingStats(){return {...this.housing.getStats(),metadataAverageMs:this.metrics.housingMs/(this.metrics.housingJobs||1),metadataPeakMs:this.metrics.housingPeakMs,metadataJobs:this.metrics.housingJobs};}
    getStats(camera = null) {
        let buildings = 0, drawCalls = 0, triangles = 0, conflicts = 0, malformed = 0, colliders = 0;
        const architecture={lodCounts:{far:0,medium:0,near:0},archetypes:{},wallTriangles:0,roofTriangles:0,windowTriangles:0,detailTriangles:0,
          nearDetailTriangles:0,foundations:0,roadFacingEntrances:0,entrances:0,windows:0,balconies:0,verandas:0,compounds:0,roofFallbacks:0,malformedGeometry:0};
        for (const t of this.loaded.values()) {
            buildings += t.records.length;
            conflicts += t.conflicts.length;
            malformed += t.malformed;
            colliders += Boolean(t.collider);
            if(t.buildStats){
              for(const key of Object.keys(architecture))if(typeof architecture[key]==='number')architecture[key]+=t.buildStats[key]??0;
              for(const [key,value] of Object.entries(t.buildStats.lodCounts))architecture.lodCounts[key]+=value;
              for(const [key,value] of Object.entries(t.buildStats.archetypes))architecture.archetypes[key]=(architecture.archetypes[key]??0)+value;
            }
            t.group.traverse(m=>{if(m.isMesh){drawCalls++;triangles+=(m.geometry.index?.count??m.geometry.attributes.position.count)/3;}});
        }
        let visibleTriangles = triangles, visibleDrawCalls = drawCalls;
        if (camera) {
            visibleTriangles = 0;
            visibleDrawCalls = 0;
            camera.updateMatrixWorld();
            const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
            for (const t of this.loaded.values())
                t.group.traverse(m=>{
                    if (m.isMesh&&frustum.intersectsObject(m)) {
                        visibleDrawCalls++;
                        visibleTriangles += (m.geometry.index?.count??m.geometry.attributes.position.count) / 3;
                    }
                });
        }
        return { ...this.metrics, ...architecture, materialFamilies:this.materials.length,materialBatches:drawCalls, visibleTriangles, visibleDrawCalls, region: this.region, buildings, drawCalls, triangles, conflicts, malformed, colliders, tiles: this.loaded.size, cache: this.cache.size, pending: this.loading.size, geometryAverageMs: this.metrics.geometryMs / (this.metrics.geometryJobs || 1),workerAverageMs:this.metrics.workerMs/(this.metrics.workerJobs||1) };
    }
    dispose() { this.disposed = true; this.nextPosition = null; this.clearRegion(); this.failWorker(new Error('Building system disposed')); this.materials.forEach(m => m.dispose()); }
}
