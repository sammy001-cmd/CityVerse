import './CityMap.css';
import { POIManager, TileCache, visibleTileKeys } from './POIManager.js';

const label = (value) => String(value).replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const COLORS = { hospital: '#ff829b', clinic: '#ff829b', pharmacy: '#ff829b', food: '#ffbd75',
  bank: '#a69aff', atm: '#a69aff', fuel: '#ffd875', school: '#82baff', university: '#82baff',
  park: '#76d6a5', sports: '#76d6a5', police: '#82baff', fire_station: '#ff829b' };
const GLYPHS = { hospital: '+', clinic: '+', pharmacy: '+', food: 'F', bank: '$', atm: '$', fuel: 'F',
  school: 'S', university: 'U', hotel: 'H', supermarket: 'S', mall: 'M', police: 'P', fire_station: '+',
  park: 'P', sports: 'S', government: 'G', transport: 'T', place_of_worship: 'W', landmark: 'L' };

export class CityMap {
  constructor(options = {}) {
    this.options = options;
    this.baseUrl = options.roadBaseUrl ?? '/data/city-map-roads';
    this.poiManager = new POIManager({ baseUrl: options.poiBaseUrl });
    this.centerX = 0; this.centerZ = 0; this.metersPerPixel = 50;
    this.player = { x: 0, z: 0, heading: 0 };
    this.pointers = new Map(); this.markers = []; this.opened = false;
    this.searchVersion = 0; this.selectionVersion = 0;
    this.minZoom = 0.25; this.maxZoom = 200;
  }

  async init() {
    if (this.destroyed) return false;
    if (!this.root) this.createDOM();
    if (!this.initializing) this.initializing = (async () => {
      const response = await fetch(`${this.baseUrl}/manifest.json`);
      if (!response.ok) throw new Error('Road manifest unavailable');
      this.manifest = await response.json();
      this.roadKeys = new Set(this.manifest.detailTileKeys);
      this.roads = new TileCache({ keys: this.roadKeys, maxTiles: 96, concurrency: 6,
        url: (key) => { const [tx, tz] = key.split('_');
          return `${this.baseUrl}/${this.manifest.detailTilePath.replace('{tx}', tx).replace('{tz}', tz)}`; } });
      this.styles = new Map(this.manifest.roadClasses.map(({ id, type }) => {
        const family = type.replace('_link', '');
        const rank = ['motorway', 'trunk'].includes(family) ? 0 : family === 'primary' ? 1 :
          family === 'secondary' ? 2 : family === 'tertiary' ? 3 : ['residential', 'unclassified'].includes(family) ? 4 : 5;
        return [id, { rank, color: ['#bd9b71', '#9d9da1', '#71879b', '#516b81', '#354b60', '#283d50'][rank],
          width: [3.2, 2.6, 2.1, 1.6, 1.2, 0.8][rank] }];
      }));
      const points = [...this.roadKeys].map((key) => key.split('_').map(Number));
      const size = this.manifest.tileSize;
      this.cityBounds = { minX: Math.min(...points.map((p) => p[0])) * size,
        maxX: (Math.max(...points.map((p) => p[0])) + 1) * size,
        minZ: Math.min(...points.map((p) => p[1])) * size,
        maxZ: (Math.max(...points.map((p) => p[1])) + 1) * size };
      this.attribution.textContent = this.manifest.attribution ?? '© OpenStreetMap contributors';
      const results = await Promise.allSettled([
        fetch(`${this.baseUrl}/${this.manifest.overview}`).then(async (r) => {
          if (!r.ok) throw new Error('Road overview unavailable'); this.overview = await r.json();
        }), this.poiManager.init()
      ]);
      if (results.some((r) => r.status === 'rejected')) this.message('Some map data is unavailable. You can still explore.');
      if (this.poiManager.manifest) this.createFilters();
      return true;
    })().catch(() => { this.message('Map data could not load. Close and reopen to retry.'); this.initializing = null; return false; });
    return this.initializing;
  }

  async open({ x = 0, z = 0, heading = 0 } = {}) {
    if (this.destroyed) return;
    if (this.opened) { this.setPlayerPosition(x, z, heading); return; }
    if (!this.root) this.createDOM();
    this.previousFocus = document.activeElement;
    this.opened = true; this.root.hidden = false;
    this.previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    this.setPlayerPosition(x, z, heading); this.resize(); this.closeButton.focus();
    const ready = await this.init();
    if (!this.opened || this.destroyed) return;
    if (ready && !this.fitted) { this.fitCity(); this.fitted = true; }
    this.viewportChanged();
  }
  close() {
    if (!this.opened) return;
    this.opened = false; this.root.hidden = true; this.pointers.clear();
    document.body.style.overflow = this.previousOverflow;
    clearTimeout(this.streamTimer); clearTimeout(this.searchTimer);
    this.searchVersion++; this.selectionVersion++;
    this.roads?.retainQueued(new Set()); this.poiManager.cache?.retainQueued(new Set());
    if (this.frame) cancelAnimationFrame(this.frame); this.frame = null;
    this.previousFocus?.focus();
  }
  toggle(options) { return this.isOpen() ? this.close() : this.open(options); }
  isOpen() { return this.opened; }
  setPlayerPosition(x, z, heading = 0) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.player = { x, z, heading }; this.invalidate();
  }
  destroy() {
    this.close(); this.destroyed = true; this.events?.abort(); this.observer?.disconnect();
    clearTimeout(this.messageTimer); this.root?.remove(); this.roads?.tiles.clear(); this.poiManager.tiles?.clear();
  }
  worldToScreen(x, z) { return { x: this.width / 2 + (x-this.centerX)/this.metersPerPixel,
    y: this.height / 2 + (z-this.centerZ)/this.metersPerPixel }; }
  screenToWorld(x, y) { return { x: this.centerX + (x-this.width/2)*this.metersPerPixel,
    z: this.centerZ + (y-this.height/2)*this.metersPerPixel }; }
  bounds() {
    const x = this.width*this.metersPerPixel/2, z = this.height*this.metersPerPixel/2;
    return { minX: this.centerX-x, maxX: this.centerX+x, minZ: this.centerZ-z, maxZ: this.centerZ+z };
  }
  fitCity() {
    const b = this.cityBounds; this.centerX = (b.minX+b.maxX)/2; this.centerZ = (b.minZ+b.maxZ)/2;
    this.metersPerPixel = Math.max((b.maxX-b.minX)/Math.max(1,this.width-48),
      (b.maxZ-b.minZ)/Math.max(1,this.height-180));
    this.maxZoom = Math.max(200, this.metersPerPixel*2);
  }
  zoom(factor, x = this.width/2, y = this.height/2) {
    const anchor = this.screenToWorld(x,y);
    this.metersPerPixel = Math.max(this.minZoom, Math.min(this.maxZoom, this.metersPerPixel*factor));
    const after = this.screenToWorld(x,y); this.centerX += anchor.x-after.x; this.centerZ += anchor.z-after.z;
    this.viewportChanged();
  }
  resize() {
    if (!this.opened) return;
    this.width = this.root.clientWidth; this.height = this.root.clientHeight;
    const low = this.options.lowPerformance ?? new URLSearchParams(location.search).has('low');
    this.dpr = Math.min(window.devicePixelRatio || 1, low ? 1 : 1.5);
    this.canvas.width = Math.round(this.width*this.dpr); this.canvas.height = Math.round(this.height*this.dpr);
    this.viewportChanged();
  }
  invalidate() {
    if (!this.opened || this.frame || this.destroyed) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; this.render(); });
  }
  viewportChanged() {
    this.invalidate(); clearTimeout(this.streamTimer);
    this.streamTimer = setTimeout(() => this.stream(), 100);
  }
  async stream() {
    if (!this.opened || !this.manifest) return;
    const bounds = this.bounds();
    // The pixel-area limit also protects very large desktop displays.
    const keys = this.metersPerPixel <= 8 ? visibleTileKeys(bounds, this.manifest.tileSize, this.roadKeys) : [];
    const wanted = new Set(keys.length <= 96 ? keys : []);
    this.roads.retainQueued(wanted);
    for (const key of wanted) this.roads.load(key).then(() => this.invalidate()).catch(() => this.message('Some streets could not load. Overview remains available.'));
    if (this.metersPerPixel <= 3 && this.poiManager.manifest) {
      const poiKeys = visibleTileKeys(bounds, this.poiManager.manifest.tileSize, this.poiManager.keys);
      if (poiKeys.length <= 96) {
        const results = await this.poiManager.loadVisible(bounds, () => this.invalidate());
        if (results.some((r) => r.status === 'rejected')) this.message('Some places could not load.');
      } else this.poiManager.cache.retainQueued(new Set(this.poiManager.fullKeys ?? []));
    } else this.poiManager.cache?.retainQueued(new Set(this.poiManager.fullKeys ?? []));
  }

  createDOM() {
    this.events = new AbortController(); const signal = this.events.signal;
    this.root = document.createElement('section'); this.root.className = 'city-map'; this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'true'); this.root.setAttribute('aria-label', 'Ibadan City Map');
    this.root.innerHTML = `<canvas aria-label="Ibadan map: drag to pan, use zoom controls to explore"></canvas>
      <div class="city-map-toolbar"><div class="city-map-brand">CITYVERSE <span>Ibadan</span></div>
      <input type="search" placeholder="Search Ibadan..." aria-label="Search Ibadan" autocomplete="off">
      <button class="city-map-close" aria-label="Close city map" title="Close city map">×</button></div>
      <div class="city-map-filters" aria-label="Place categories"></div>
      <div class="city-map-results" aria-label="Search results" hidden></div>
      <div class="city-map-details" aria-label="Place details" hidden></div>
      <div class="city-map-controls"><button data-action="in" aria-label="Zoom in" title="Zoom in">+</button>
      <button data-action="out" aria-label="Zoom out" title="Zoom out">−</button>
      <button data-action="player" aria-label="Recenter on player" title="Your location">◎</button>
      <button data-action="city" aria-label="Fit whole city" title="Whole city">↗</button></div>
      <div class="city-map-message" role="status" hidden></div>
      <div class="city-map-scale"></div><a class="city-map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>`;
    document.body.append(this.root);
    this.canvas = this.root.querySelector('canvas'); this.ctx = this.canvas.getContext('2d');
    this.input = this.root.querySelector('input'); this.results = this.root.querySelector('.city-map-results');
    this.details = this.root.querySelector('.city-map-details'); this.filters = this.root.querySelector('.city-map-filters');
    this.attribution = this.root.querySelector('.city-map-attribution'); this.status = this.root.querySelector('.city-map-message');
    this.scale = this.root.querySelector('.city-map-scale'); this.closeButton = this.root.querySelector('.city-map-close');
    this.closeButton.addEventListener('click', () => this.close(), { signal });
    this.root.querySelector('.city-map-controls').addEventListener('click', (event) => {
      const action = event.target.closest('button')?.dataset.action;
      if (action === 'in') this.zoom(0.65); if (action === 'out') this.zoom(1/0.65);
      if (action === 'city' && this.cityBounds) { this.fitCity(); this.viewportChanged(); }
      if (action === 'player') { this.centerX = this.player.x; this.centerZ = this.player.z;
        this.metersPerPixel = Math.min(2,this.metersPerPixel); this.viewportChanged(); }
    }, { signal });
    this.input.addEventListener('input', () => {
      clearTimeout(this.searchTimer); const version = ++this.searchVersion;
      if (!this.input.value.trim()) { this.results.hidden = true; this.results.replaceChildren(); return; }
      this.searchTimer = setTimeout(() => this.runSearch(version), 180);
    }, { signal });
    window.addEventListener('keydown', (event) => {
      if (!this.opened) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this.close(); }
      if (event.key === 'Tab') {
        const nodes = [...this.root.querySelectorAll('button,input,a')].filter((node) => node.getClientRects().length);
        const first = nodes[0], last = nodes[nodes.length-1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }, { signal, capture: true });
    // Keep map input from reaching the game's keyboard handlers.
    this.root.addEventListener('keydown', (e) => e.stopPropagation(), { signal });
    this.root.addEventListener('keyup', (e) => e.stopPropagation(), { signal });
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault(); const p = this.localPoint(event);
      this.zoom(Math.exp(Math.max(-200,Math.min(200,event.deltaY))*0.002),p.x,p.y);
    }, { signal, passive: false });
    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      this.canvas.setPointerCapture(event.pointerId); const p = this.localPoint(event);
      this.pointers.set(event.pointerId,p);
      if (this.pointers.size === 1) this.tap = { ...p, moved: false };
      else if (this.tap) this.tap.moved = true;
    }, { signal });
    this.canvas.addEventListener('pointermove', (event) => this.pointerMove(event), { signal });
    const end = (event) => {
      if (!this.pointers.has(event.pointerId)) return;
      const p = this.localPoint(event);
      if (event.type === 'pointerup' && this.pointers.size === 1 && this.tap && !this.tap.moved && Math.hypot(p.x-this.tap.x,p.y-this.tap.y)<8) this.hitTest(p);
      this.pointers.delete(event.pointerId);
      if (!this.pointers.size) this.tap = null;
    };
    for (const type of ['pointerup','pointercancel','lostpointercapture']) this.canvas.addEventListener(type,end,{signal});
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(this.root);
  }
  localPoint(event) { const r = this.canvas.getBoundingClientRect(); return { x: event.clientX-r.left, y: event.clientY-r.top }; }
  pointerMove(event) {
    const old = this.pointers.get(event.pointerId); if (!old) return;
    const p = this.localPoint(event);
    if (this.tap && Math.hypot(p.x-this.tap.x,p.y-this.tap.y)>6) this.tap.moved = true;
    const before = [...this.pointers.values()]; this.pointers.set(event.pointerId,p);
    const after = [...this.pointers.values()];
    if (before.length === 1) { this.centerX -= (p.x-old.x)*this.metersPerPixel; this.centerZ -= (p.y-old.y)*this.metersPerPixel; }
    else {
      const midpoint = (a) => ({ x: (a[0].x+a[1].x)/2, y: (a[0].y+a[1].y)/2 });
      const m1 = midpoint(before), m2 = midpoint(after), anchor = this.screenToWorld(m1.x,m1.y);
      const d1 = Math.hypot(before[0].x-before[1].x,before[0].y-before[1].y);
      const d2 = Math.hypot(after[0].x-after[1].x,after[0].y-after[1].y);
      if (d2 > 0 && d1 > 0) this.metersPerPixel = Math.max(this.minZoom,Math.min(this.maxZoom,this.metersPerPixel*d1/d2));
      const world = this.screenToWorld(m2.x,m2.y); this.centerX += anchor.x-world.x; this.centerZ += anchor.z-world.z;
    }
    this.viewportChanged();
  }
  createFilters() {
    this.filters.replaceChildren();
    const categories = Object.keys(this.poiManager.manifest.categories).sort();
    const common = ['hospital','food','bank','fuel','hotel','school'];
    const choose = (category) => {
      this.category = category; this.filters.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed',String(b.dataset.category === (category ?? ''))));
      this.invalidate();
    };
    for (const category of [null,...common.filter((c) => categories.includes(c))]) {
      const b = document.createElement('button'); b.textContent = category ? label(category) : 'All';
      b.dataset.category = category ?? ''; b.setAttribute('aria-pressed',String(!category));
      b.addEventListener('click',() => choose(category),{signal:this.events.signal}); this.filters.append(b);
    }
    const more = document.createElement('select'); more.setAttribute('aria-label','More place categories');
    const initial = document.createElement('option'); initial.value = ''; initial.textContent = 'More categories'; more.append(initial);
    for (const c of categories) { const option = document.createElement('option'); option.value = c; option.textContent = label(c); more.append(option); }
    more.addEventListener('change',() => choose(more.value || null),{signal:this.events.signal}); this.filters.append(more);
  }
  async runSearch(version) {
    try {
      const matches = await this.poiManager.search(this.input.value,20);
      if (version !== this.searchVersion || !this.opened) return;
      this.results.replaceChildren(); this.results.hidden = false;
      if (!matches.length) this.results.textContent = 'No places found.';
      for (const poi of matches) {
        const button = document.createElement('button'), name = document.createElement('strong'), category = document.createElement('span');
        name.textContent = poi.name; category.textContent = label(poi.category); button.append(name,category);
        button.addEventListener('click',() => this.selectSearchResult(poi),{signal:this.events.signal}); this.results.append(button);
      }
      this.invalidate();
    } catch { if (version === this.searchVersion) this.message('Search is unavailable. Please try again.'); }
  }
  async selectSearchResult(result) {
    const version = ++this.selectionVersion; this.searchVersion++; this.results.hidden = true;
    this.centerX = result.x; this.centerZ = result.z; this.metersPerPixel = 1;
    this.selected = result; this.details.hidden = true; this.viewportChanged();
    try {
      const poi = await this.poiManager.getFullPOI(result);
      if (version !== this.selectionVersion || !this.opened) return;
      if (poi) this.selectPOI(poi); else this.message('Place details are unavailable.');
    } catch { if (version === this.selectionVersion) this.message('Place details could not load.'); }
  }
  hitTest(p) {
    let nearest = null, distance = 22;
    for (const marker of this.markers) { const d = Math.hypot(marker.x-p.x,marker.y-p.y); if (d<distance) { nearest = marker.poi; distance=d; } }
    if (nearest) { this.selectionVersion++; this.selectPOI(nearest); }
  }
  selectPOI(poi) {
    this.selected = poi; this.details.replaceChildren(); this.details.hidden = false;
    const close = document.createElement('button'); close.className = 'city-map-details-close'; close.textContent = '×'; close.setAttribute('aria-label','Close place details');
    close.addEventListener('click',() => { this.details.hidden=true; this.selected=null; this.invalidate(); },{signal:this.events.signal});
    const title = document.createElement('h2'); title.textContent=poi.name; this.details.append(close,title);
    for (const [key,value] of [['Category',label(poi.category)],['Address',poi.address],['Opening hours',poi.openingHours],['Phone',poi.phone],['Brand',poi.brand]]) {
      if (!value) continue; const p=document.createElement('p'), small=document.createElement('small'); small.textContent=key; p.append(small,document.createTextNode(value)); this.details.append(p);
    }
    if (poi.website) {
      try { const url=new URL(poi.website); if (['https:','http:'].includes(url.protocol)) {
        const a=document.createElement('a'); a.href=url.href; a.textContent='Visit website'; a.target='_blank'; a.rel='noopener noreferrer'; this.details.append(a);
      } } catch { /* Ignore invalid source URLs. */ }
    }
    const destination=document.createElement('button'); destination.className='city-map-destination'; destination.textContent='SET DESTINATION';
    destination.addEventListener('click',() => {
      window.dispatchEvent(new CustomEvent('cityverse:set-destination',{detail:{poi}})); this.options.onSetDestination?.(poi);
    },{signal:this.events.signal}); this.details.append(destination); this.invalidate();
  }
  message(text) {
    if (this.destroyed) return; this.status.textContent=text; this.status.hidden=false;
    clearTimeout(this.messageTimer); this.messageTimer=setTimeout(() => { this.status.hidden=true; },5000);
  }

  render() {
    const ctx=this.ctx, m=this.metersPerPixel; ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
    ctx.fillStyle='#0b1625'; ctx.fillRect(0,0,this.width,this.height);
    const bounds=this.bounds(); this.labelNames=new Set(); this.labelCells=new Set(); this.labelCount=0;
    if (this.overview) this.drawRoads(this.overview,0,0,bounds,false);
    if (m<=8 && this.roads) {
      for (const key of visibleTileKeys(bounds,this.manifest.tileSize,this.roadKeys,0)) {
        const tile=this.roads.get(key); if (!tile) continue;
        const [tx,tz]=key.split('_').map(Number); this.drawRoads(tile,tx*this.manifest.tileSize,tz*this.manifest.tileSize,bounds,true);
      }
    }
    this.markers=[];
    if (m<=3) for (const poi of this.poiManager.getVisible(bounds,this.category ? [this.category] : null)) this.drawPOI(poi);
    if (this.selected && !this.markers.some((p) => p.poi.id===this.selected.id)) this.drawPOI(this.selected);
    const player=this.worldToScreen(this.player.x,this.player.z);
    ctx.save(); ctx.translate(player.x,player.y); ctx.fillStyle='#64e5ff'; ctx.strokeStyle='#082335'; ctx.lineWidth=2;
    if (Number.isFinite(this.player.heading)) {
      ctx.rotate(-this.player.heading); ctx.beginPath(); ctx.moveTo(0,-15); ctx.lineTo(10,11); ctx.lineTo(0,6); ctx.lineTo(-10,11); ctx.closePath();
    } else { ctx.beginPath(); ctx.arc(0,0,7,0,Math.PI*2); }
    ctx.fill(); ctx.stroke(); ctx.restore();
    const distance=100*m, power=10**Math.floor(Math.log10(distance));
    const scale=[1,2,5,10].map((n) => n*power).find((n) => n>=distance/2) ?? power;
    this.scale.style.width=`${scale/m}px`; this.scale.textContent=scale>=1000 ? `${scale/1000} km` : `${Math.round(scale)} m`;
  }
  drawRoads(tile,ox,oz,bounds,detail) {
    const ctx=this.ctx,m=this.metersPerPixel,offsetX=this.width/2+(ox-this.centerX)/m,offsetY=this.height/2+(oz-this.centerZ)/m;
    // Batch strokes by class to reduce canvas state changes and draw calls.
    for (const [id,style] of this.styles) {
      if (detail && m>2 && style.rank>3) continue;
      ctx.strokeStyle=style.color; ctx.lineWidth=style.width; ctx.lineCap='round'; ctx.beginPath();
      for (const road of tile.roads) {
        if (road[4]!==id) continue;
        if (Math.max(road[0],road[2])+ox<bounds.minX || Math.min(road[0],road[2])+ox>bounds.maxX ||
          Math.max(road[1],road[3])+oz<bounds.minZ || Math.min(road[1],road[3])+oz>bounds.maxZ) continue;
        ctx.moveTo(offsetX+road[0]/m,offsetY+road[1]/m); ctx.lineTo(offsetX+road[2]/m,offsetY+road[3]/m);
      }
      ctx.stroke();
    }
    if (!detail || m>1.5 || this.labelCount>=32) return;
    ctx.font='11px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle';
    for (const r of tile.roads) {
      if (this.labelCount>=32) break;
      const name=tile.names[r[5]]; if (!name || this.labelNames.has(name)) continue;
      const x=offsetX+(r[0]+r[2])/(2*m),y=offsetY+(r[1]+r[3])/(2*m);
      if (x<30 || y<140 || x>this.width-30 || y>this.height-30 || Math.hypot(r[2]-r[0],r[3]-r[1])/m<ctx.measureText(name).width+16) continue;
      const cell=`${Math.floor(x/140)}_${Math.floor(y/45)}`; if (this.labelCells.has(cell)) continue;
      this.labelCells.add(cell); this.labelNames.add(name); this.labelCount++;
      ctx.lineWidth=3; ctx.strokeStyle='#0b1625'; ctx.strokeText(name,x,y); ctx.fillStyle='#a8b8c9'; ctx.fillText(name,x,y);
    }
  }
  drawPOI(poi) {
    const p=this.worldToScreen(poi.x,poi.z); if (p.x<-20 || p.y<-20 || p.x>this.width+20 || p.y>this.height+20) return;
    const ctx=this.ctx, selected=poi.id===this.selected?.id;
    ctx.beginPath(); ctx.arc(p.x,p.y,selected ? 12 : 9,0,Math.PI*2); ctx.fillStyle=COLORS[poi.category] ?? '#8bd1cf'; ctx.fill();
    ctx.lineWidth=selected ? 3 : 2; ctx.strokeStyle=selected ? '#fff' : '#0b1625'; ctx.stroke();
    ctx.fillStyle='#122032'; ctx.font='bold 10px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(GLYPHS[poi.category] ?? '•',p.x,p.y);
    this.markers.push({x:p.x,y:p.y,poi});
  }
}
export default CityMap;
