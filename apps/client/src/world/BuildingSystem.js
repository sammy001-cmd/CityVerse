import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { selectLOD, pointInRing } from './BuildingRules.js';
import { decodeBuilding, selectRegion, validateManifest, roadOverlapRatio } from './BuildingData.js';
import { buildingMaterials, buildBuildingGeometry } from './BuildingGeometry.js';
import { unpackGeometry } from './RoadWorldTransfer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
export { decodeBuilding } from './BuildingData.js';
const yieldFrame = () => new Promise(r => setTimeout(r, 0));
export class BuildingSystem {
    constructor({ scene, worldSurface, roadSystem, physics = null, lowPerformance = false, fetcher = (...args) => globalThis.fetch(...args), worker = true, cacheLimit = lowPerformance ? 32 : 64, concurrency = 3 }) {
        Object.assign(this, { scene, worldSurface, roadSystem, physics, lowPerformance, fetcher, cacheLimit, concurrency });
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
        this.metrics = { malformed: 0, conflicts: 0, bytes: 0, tileMs: 0, geometryMs: 0, geometryPeakMs: 0, geometryJobs: 0, failures: 0 };
        if (worker && typeof Worker !== 'undefined')
            try {
                this.worker = new Worker(new URL('./BuildingWorker.js', import.meta.url), { type: 'module' });
                this.worker.onmessage = ({ data }) => {
                    const j = this.jobs.get(data.id);
                    if (!j)
                        return;
                    this.jobs.delete(data.id);
                    clearTimeout(j.timeout);
                    data.error ? j.reject(new Error(data.error)) : j.resolve(data.geometry.map(g => g ? unpackGeometry(g) : null));
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
                while (this.cache.size > this.cacheLimit)
                    this.cache.delete(this.cache.keys().next().value);
                this.metrics.tileMs = performance.now() - start;
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
    async prepare(records, lod) {
        const start = performance.now();
        let geometry;
        if (this.worker)
            try {
                const id = ++this.serial;
                geometry = await new Promise((resolve, reject) => { const timeout = setTimeout(() => this.failWorker(new Error('Building worker timed out')), 15000); this.jobs.set(id, { resolve, reject, timeout }); this.worker.postMessage({ id, records, lod }); });
            }
            catch (error) {
                this.failWorker(error);
                console.warn('Building preparation fallback:', error);
            }
        if (!geometry) {
            const pieces = [[], []];
            for (let i = 0; i < records.length; i += 16) {
                buildBuildingGeometry(records.slice(i, i + 16), lod).forEach((g, j) => {
                    if (g)
                        pieces[j].push(g);
                });
                await yieldFrame();
            }
            geometry = pieces.map(list => {
                if (!list.length)
                    return null;
                const g = mergeGeometries(list);
                list.forEach(p => p.dispose());
                return g;
            });
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
    }
    async install(key, lod, epoch, roads) {
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
        const bounds = decoded.reduce((v, b) => ({
            minX: Math.min(v.minX, b.minX), maxX: Math.max(v.maxX, b.maxX),
            minZ: Math.min(v.minZ, b.minZ), maxZ: Math.max(v.maxZ, b.maxZ)
        }), {minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity});
        const candidates = decoded.length ? this.roadSystem?.getRoadEdges(bounds) ?? [] : [];
        for (const b of decoded) {
            const edges = candidates.filter(e => Math.max(e.a[0], e.b[0]) + e.width / 2 >= b.minX &&
                Math.min(e.a[0], e.b[0]) - e.width / 2 <= b.maxX &&
                Math.max(e.a[1], e.b[1]) + e.width / 2 >= b.minZ &&
                Math.min(e.a[1], e.b[1]) - e.width / 2 <= b.maxZ);
            if (roadOverlapRatio(b, edges) >= 0.25) {
                conflicts.push(b.id);
                continue;
            }
            records.push(b);
        }
        const geometry = await this.prepare(records, lod);
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
        this.scene.add(group);
        this.loaded.set(key, { group, records, lod, roads, conflicts, malformed, collider: null });
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
                const arrays = t.group.children.map(m => m.geometry.attributes.position.array), n = arrays.reduce((s, a) => s + a.length, 0);
                if (n) {
                    const positions = new Float32Array(n);
                    let offset = 0;
                    for (const a of arrays) {
                        positions.set(a, offset);
                        offset += a.length;
                    }
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
        const tx = Math.floor(x / 250), tz = Math.floor(z / 250), roads = [...(this.roadSystem?.loaded ?? new Map())].map(([k, g]) => `${k}:${g.uuid ?? ''}`).join(','), stamp = `${tx}_${tz}|${roads}`;
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
        let cursor = 0;
        const failures = new Set();
        await Promise.all(Array.from({ length: this.concurrency }, async () => {
            while (cursor < wanted.length && epoch === this.epoch) {
                const key = wanted[cursor++];
                try {
                    await this.tileData(key);
                }
                catch (error) {
                    failures.add(key);
                    this.metrics.failures++;
                    this.retryTilesAt = performance.now() + 5000;
                    console.warn(`Building tile skipped [${this.region}:${key}]:`, error);
                }
            }
        }));
        for (const key of wanted) {
            if (epoch !== this.epoch || this.disposed)
                return;
            if (failures.has(key))
                continue;
            const [u, v] = key.split('_').map(Number), distance = Math.hypot(Math.max(u * 250 - x, 0, x - (u + 1) * 250), Math.max(v * 250 - z, 0, z - (v + 1) * 250)), lod = this.lowPerformance ? 'far' : selectLOD(distance);
            if (this.loaded.get(key)?.lod === lod && this.loaded.get(key)?.roads === roads)
                continue;
            try {
                await this.install(key, lod, epoch, roads);
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
    getStats(camera = null) {
        let buildings = 0, drawCalls = 0, triangles = 0, conflicts = 0, malformed = 0, colliders = 0;
        for (const t of this.loaded.values()) {
            buildings += t.records.length;
            conflicts += t.conflicts.length;
            malformed += t.malformed;
            colliders += Boolean(t.collider);
            for (const m of t.group.children) {
                drawCalls++;
                triangles += m.geometry.attributes.position.count / 3;
            }
        }
        let visibleTriangles = triangles, visibleDrawCalls = drawCalls;
        if (camera) {
            visibleTriangles = 0;
            visibleDrawCalls = 0;
            camera.updateMatrixWorld();
            const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
            for (const t of this.loaded.values())
                for (const m of t.group.children)
                    if (frustum.intersectsObject(m)) {
                        visibleDrawCalls++;
                        visibleTriangles += m.geometry.attributes.position.count / 3;
                    }
        }
        return { ...this.metrics, visibleTriangles, visibleDrawCalls, region: this.region, buildings, drawCalls, triangles, conflicts, malformed, colliders, tiles: this.loaded.size, cache: this.cache.size, pending: this.loading.size, geometryAverageMs: this.metrics.geometryMs / (this.metrics.geometryJobs || 1) };
    }
    dispose() { this.disposed = true; this.nextPosition = null; this.clearRegion(); this.failWorker(new Error('Building system disposed')); this.materials.forEach(m => m.dispose()); }
}
