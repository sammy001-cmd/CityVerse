// Bounded, deduplicated tile loader shared by the map and POIs.
export class TileCache {
  constructor({ keys, url, maxTiles = 96, concurrency = 6 }) {
    Object.assign(this, { keys, url, maxTiles, concurrency });
    this.tiles = new Map(); this.pending = new Map(); this.queue = [];
    this.active = 0; this.failures = new Map();
  }
  get(key) {
    const tile = this.tiles.get(key);
    if (tile) { this.tiles.delete(key); this.tiles.set(key, tile); }
    return tile;
  }
  load(key) {
    if (!this.keys.has(key)) return Promise.resolve(null);
    const tile = this.get(key);
    if (tile) return Promise.resolve(tile);
    if (this.pending.has(key)) return this.pending.get(key);
    if (Date.now() - (this.failures.get(key) ?? 0) < 30000) return Promise.resolve(null);
    const promise = new Promise((resolve, reject) => this.queue.push({ key, resolve, reject }));
    this.pending.set(key, promise); this.pump(); return promise;
  }
  retainQueued(keys) {
    this.queue = this.queue.filter((job) => {
      if (keys.has(job.key)) return true;
      this.pending.delete(job.key); job.resolve(null); return false;
    });
  }
  pump() {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift(); this.active++;
      (async () => {
        try {
          const response = await fetch(this.url(job.key));
          if (!response.ok) throw new Error(`Tile ${job.key} failed (${response.status})`);
          const tile = await response.json(); this.tiles.set(job.key, tile);
          while (this.tiles.size > this.maxTiles) this.tiles.delete(this.tiles.keys().next().value);
          job.resolve(tile);
        } catch (error) { this.failures.set(job.key, Date.now()); job.reject(error); }
        finally { this.pending.delete(job.key); this.active--; this.pump(); }
      })();
    }
  }
}
export function visibleTileKeys(bounds, size, existing, margin = 1) {
  const keys = [];
  for (const key of existing) {
    const [tx, tz] = key.split('_').map(Number);
    if (tx >= Math.floor(bounds.minX / size) - margin && tx <= Math.floor(bounds.maxX / size) + margin &&
        tz >= Math.floor(bounds.minZ / size) - margin && tz <= Math.floor(bounds.maxZ / size) + margin) keys.push(key);
  }
  const cx = (bounds.minX + bounds.maxX) / (2 * size), cz = (bounds.minZ + bounds.maxZ) / (2 * size);
  return keys.sort((a, b) => {
    const [ax, az] = a.split('_').map(Number), [bx, bz] = b.split('_').map(Number);
    return Math.hypot(ax - cx, az - cz) - Math.hypot(bx - cx, bz - cz);
  });
}
export class POIManager {
  constructor({ baseUrl = '/data/poi-tiles', maxTiles = 96, concurrency = 6 } = {}) {
    Object.assign(this, { baseUrl, maxTiles, concurrency }); this.manifest = null;
  }
  async init() {
    if (!this.initializing) this.initializing = (async () => {
      const response = await fetch(`${this.baseUrl}/manifest.json`);
      if (!response.ok) throw new Error(`POI manifest failed (${response.status})`);
      this.manifest = await response.json(); this.keys = new Set(this.manifest.tiles);
      this.cache = new TileCache({ keys: this.keys, maxTiles: this.maxTiles,
        concurrency: this.concurrency, url: (key) => `${this.baseUrl}/${key}.json` });
      this.tiles = this.cache.tiles; return this;
    })().catch((error) => { this.initializing = null; throw error; });
    return this.initializing;
  }
  async loadTile(tx, tz) {
    await this.init(); return this.cache.load(tz === undefined ? String(tx) : `${tx}_${tz}`);
  }
  async loadVisible(bounds, onTile = () => {}) {
    await this.init();
    const keys = visibleTileKeys(bounds, this.manifest.tileSize, this.keys);
    this.cache.retainQueued(new Set([...keys, ...(this.fullKeys ?? [])]));
    return Promise.allSettled(keys.map((key) => this.cache.load(key).then((tile) => {
      if (tile) onTile(tile); return tile;
    })));
  }
  getVisible(bounds, categories) {
    const filter = categories ? new Set(typeof categories === 'string' ? [categories] : categories) : null;
    if (this.cache) {
      for (const key of visibleTileKeys(bounds, this.manifest.tileSize, this.keys, 0)) this.cache.get(key);
    }
    return this.all().filter((p) => p.x >= bounds.minX && p.x <= bounds.maxX && p.z >= bounds.minZ &&
      p.z <= bounds.maxZ && (!filter || filter.has(p.category)));
  }
  async loadSearchIndex() {
    await this.init();
    if (!this.searchIndexPromise) this.searchIndexPromise = (async () => {
      const response = await fetch(`${this.baseUrl}/${this.manifest.searchIndex ?? 'search-index.json'}`);
      if (!response.ok) throw new Error(`POI search failed (${response.status})`);
      const index = await response.json();
      return index.pois.map(([id, name, category, x, z, tileKey]) => ({ id, name, category, x, z, tileKey }));
    })().catch((error) => { this.searchIndexPromise = null; throw error; });
    return this.searchIndexPromise;
  }
  async search(query, limit = 20) {
    const text = String(query ?? '').trim().toLowerCase(); if (!text) return [];
    const options = typeof limit === 'object' ? limit : { limit };
    const index = await this.loadSearchIndex();
    return index.filter((p) => !options.category || p.category === options.category).map((poi) => {
      const name = poi.name.toLowerCase();
      const score = name === text ? 4 : name.startsWith(text) ? 3 : name.includes(text) ? 2 :
        poi.category.replaceAll('_', ' ').includes(text) ? 1 : 0;
      return { poi, score };
    }).filter((e) => e.score).sort((a, b) => b.score - a.score || a.poi.name.localeCompare(b.poi.name))
      .slice(0, Math.max(0, options.limit ?? 20)).map((e) => e.poi);
  }
  async getFullPOI(result) {
    this.fullKeys ??= new Set(); this.fullKeys.add(result.tileKey);
    try { const tile = await this.loadTile(result.tileKey); return tile?.pois.find((p) => p.id === result.id) ?? null; }
    finally { this.fullKeys.delete(result.tileKey); }
  }
  // Explicit maintenance API only; normal runtime never uses it.
  async loadAll() {
    await this.init(); await Promise.allSettled([...this.keys].map((key) => this.loadTile(key))); return this;
  }
  all() { return [...(this.tiles?.values() ?? [])].flatMap((tile) => tile.pois ?? []); }
  get(id) { return this.all().find((p) => p.id === id) ?? null; }
  byCategory(category) { return this.all().filter((p) => p.category === category); }
  categoryCounts() { return { ...this.manifest?.categories }; }
  nearest(x, z, { category = null, maxDistance = Infinity, limit = 10 } = {}) {
    return (category ? this.byCategory(category) : this.all()).map((poi) => ({ poi, distance: Math.hypot(poi.x-x, poi.z-z) }))
      .filter((e) => e.distance <= maxDistance).sort((a,b) => a.distance-b.distance).slice(0,limit);
  }
}
