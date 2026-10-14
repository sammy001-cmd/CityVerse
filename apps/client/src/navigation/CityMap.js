import './CityMap.css';
import {RegionMapData,mapRegionAt} from './RegionMapData.js';
import {MAP_PALETTE as P,CATEGORY_COLORS,CATEGORY_GLYPHS,CATEGORY_GROUPS,roadStyle,categoryLabel,mapBearing,destinationDistance,formatDistance,LabelLayout} from './MapDesign.js';

export class CityMap {
  constructor(options={}){
    this.options=options;this.data=new RegionMapData(options);this.low=Boolean(options.lowPerformance);
    this.player={x:0,z:0,heading:0,driving:false,...options.playerPosition};
    this.centerX=this.player.x;this.centerZ=this.player.z;this.metersPerPixel=2;this.minZoom=0.25;this.maxZoom=200;
    this.opened=false;this.follow=false;this.pointers=new Map();this.markers=[];this.searchVersion=0;this.selectionVersion=0;
    this.metrics={firstOpenMs:null,firstPaintAt:null,firstBasemapPaintAt:null,firstDetailPaintAt:null,dataReadyMs:null,renderPeakMs:0,renders:0};
  }
  async init({deferData=false}={}){
    if(this.destroyed)return false;if(!this.root)this.createDOM();
    if(deferData)return true;
    await this.loadRegion();return true;
  }
  async loadRegion(){
    if(this.loadingRegion)return this.loadingRegion;
    const position={...this.player},start=performance.now();
    this.loadingRegion=(async()=>{
      try{await this.data.activate(position.x,position.z);
        const region=this.data.region;this.regionName.textContent=region?.displayName??'Your location';
        this.input.placeholder=region?`Search ${region.displayName}…`:'Search places…';
        this.root.setAttribute('aria-label',`CityVerse map · ${region?.displayName??'your location'}`);
        this.root.querySelector('[data-action="city"]').disabled=!this.data.manifest;
        if(!this.data.manifest)this.message('Map coverage is unavailable here. Your location is still shown.');
        else if(this.data.failures)this.message('Some map layers are unavailable. You can still explore.');
        this.metrics.dataReadyMs=performance.now()-start;
        if(this.opened&&this.input.value.trim())void this.runSearch(++this.searchVersion);
      }catch{this.message('Map data is unavailable. Your location remains available. Reopen to retry.');}
      finally{this.invalidate();this.viewportChanged();}
    })();
    try{await this.loadingRegion;}finally{this.loadingRegion=null;}
    const next=this.data.index&&mapRegionAt(this.data.index.regions,this.player.x,this.player.z);
    if(next?.slug!==this.data.region?.slug&&this.opened)return this.loadRegion();
  }
  async open(position={}){
    if(this.destroyed)return;if(this.opened){this.setPlayerPosition(position.x,position.z,position.heading,position.driving);return;}
    if(!this.root)this.createDOM();this.previousFocus=document.activeElement;this.previousOverflow=document.body.style.overflow;
    this.opened=true;this.root.hidden=false;document.body.style.overflow='hidden';this.openStart=performance.now();
    this.player={...this.player,...position};this.centerX=this.player.x;this.centerZ=this.player.z;this.metersPerPixel=2;this.follow=false;this.updateFollowButton();
    this.input.value='';this.results.hidden=true;this.searchVersion++;
    const region=this.data.index&&mapRegionAt(this.data.index.regions,this.player.x,this.player.z);
    if(this.selected&&this.data.index&&this.selected.region!==region?.slug){this.selected=null;this.selectedDistance=null;this.details.hidden=true;this.selectionVersion++;}
    this.resize();this.closeButton.focus();this.invalidate();await this.loadRegion();if(this.opened)this.viewportChanged();
  }
  close(){
    if(!this.opened)return;this.opened=false;this.root.hidden=true;this.pointers.clear();document.body.style.overflow=this.previousOverflow;
    for(const timer of [this.streamTimer,this.searchTimer,this.liveTimer,this.messageTimer])clearTimeout(timer);
    this.liveTimer=null;this.searchVersion++;this.selectionVersion++;this.data.cache?.retainQueued(new Set());
    if(this.frame)cancelAnimationFrame(this.frame);this.frame=null;this.previousFocus?.focus();
  }
  isOpen(){return this.opened;}
  toggle(position){return this.opened?this.close():this.open(position);}
  destroy(){this.close();this.destroyed=true;this.events?.abort();this.observer?.disconnect();this.data.dispose();this.root?.remove();}
  setPlayerPosition(x,z,heading=0,driving=false){
    if(!Number.isFinite(x)||!Number.isFinite(z))return;
    if(this.player.x===x&&this.player.z===z&&this.player.heading===heading&&this.player.driving===driving)return;
    this.player={x,z,heading,driving};if(!this.opened)return;
    if(this.follow){this.centerX=x;this.centerZ=z;}
    const region=this.data.index&&mapRegionAt(this.data.index.regions,x,z);
    if(this.data.index&&region?.slug!==this.data.region?.slug&&!this.loadingRegion){this.searchVersion++;this.selectionVersion++;this.selected=null;this.results.hidden=true;this.details.hidden=true;void this.loadRegion();}
    if(this.selectedDistance)this.selectedDistance.textContent=`${formatDistance(destinationDistance(this.player,this.selected))} away · straight line`;
    // The game supplies position updates; one coalesced redraw, at most 10 Hz.
    const wait=Math.max(0,100-(performance.now()-(this.lastLiveRender??0)));
    const refresh=()=>{this.liveTimer=null;this.lastLiveRender=performance.now();this.invalidate();if(this.follow&&(!this.lastStreamPosition||Math.hypot(this.player.x-this.lastStreamPosition.x,this.player.z-this.lastStreamPosition.z)>60)){this.lastStreamPosition={x:this.player.x,z:this.player.z};void this.stream();}};
    if(!wait)refresh();else if(!this.liveTimer)this.liveTimer=setTimeout(refresh,wait);
  }
  setDestination(destination){this.destination=destination;this.invalidate();}
  worldToScreen(x,z){return {x:this.width/2+(x-this.centerX)/this.metersPerPixel,y:this.height/2+(z-this.centerZ)/this.metersPerPixel};}
  screenToWorld(x,y){return {x:this.centerX+(x-this.width/2)*this.metersPerPixel,z:this.centerZ+(y-this.height/2)*this.metersPerPixel};}
  bounds(){const x=this.width*this.metersPerPixel/2,z=this.height*this.metersPerPixel/2;return {minX:this.centerX-x,maxX:this.centerX+x,minZ:this.centerZ-z,maxZ:this.centerZ+z};}
  fitCity(){const b=this.data.manifest?.bounds;if(!b)return;this.follow=false;this.updateFollowButton();this.centerX=(b.minX+b.maxX)/2;this.centerZ=(b.minZ+b.maxZ)/2;this.metersPerPixel=Math.max((b.maxX-b.minX)/Math.max(1,this.width-60),(b.maxZ-b.minZ)/Math.max(1,this.height-240));this.maxZoom=Math.max(200,this.metersPerPixel*2);this.viewportChanged();}
  recenter(){this.centerX=this.player.x;this.centerZ=this.player.z;this.metersPerPixel=Math.min(2,this.metersPerPixel);this.viewportChanged();}
  toggleFollow(){this.follow=!this.follow;if(this.follow)this.recenter();this.updateFollowButton();}
  updateFollowButton(){const b=this.root?.querySelector('[data-action="follow"]');if(b){b.setAttribute('aria-pressed',String(this.follow));b.textContent=this.follow?'Following':'Follow';}if(this.mode)this.mode.textContent=this.follow?'Following your location':'Explore freely';}
  zoom(factor,x=this.width/2,y=this.height/2){const anchor=this.screenToWorld(x,y);this.metersPerPixel=Math.max(this.minZoom,Math.min(this.maxZoom,this.metersPerPixel*factor));const after=this.screenToWorld(x,y);this.centerX+=anchor.x-after.x;this.centerZ+=anchor.z-after.z;this.viewportChanged();}
  resize(){if(!this.opened)return;this.width=this.root.clientWidth;this.height=this.root.clientHeight;this.dpr=Math.min(window.devicePixelRatio||1,this.low?1:1.5);this.canvas.width=Math.round(this.width*this.dpr);this.canvas.height=Math.round(this.height*this.dpr);this.viewportChanged();}
  invalidate(){if(!this.opened||this.frame||this.destroyed)return;this.frame=requestAnimationFrame(()=>{this.frame=null;this.render();});}
  viewportChanged(){this.invalidate();clearTimeout(this.streamTimer);if(this.opened)this.streamTimer=setTimeout(()=>void this.stream(),120);}
  async stream(){if(!this.opened||!this.data.manifest)return;const epoch=this.data.epoch;const results=await this.data.stream(this.bounds(),this.metersPerPixel,()=>this.invalidate());if(this.opened&&epoch===this.data.epoch&&results?.some(r=>r.status==='rejected'))this.message('Some nearby map details could not load. Overview and your location remain available.');}

  createDOM(){
    this.events=new AbortController();const signal=this.events.signal;
    this.root=document.createElement('section');this.root.className='city-map';this.root.hidden=true;this.root.setAttribute('role','dialog');this.root.setAttribute('aria-modal','true');this.root.setAttribute('aria-label','CityVerse explorer');
    this.root.innerHTML=`<canvas aria-label="Map: drag to pan, pinch or use controls to zoom"></canvas>
      <div class="city-map-toolbar"><div class="city-map-brand">CITYVERSE<span class="city-map-region">City map</span></div>
        <div class="city-map-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Search places…" aria-label="Search places, roads and neighborhoods" autocomplete="off"></div>
        <button class="city-map-close" aria-label="Close city map">×</button></div>
      <div class="city-map-filters" aria-label="Nearby categories"><span class="city-map-nearby">Nearby</span></div>
      <div class="city-map-results" role="region" aria-label="Search results" hidden></div>
      <div class="city-map-details" role="region" aria-label="Place details" hidden></div>
      <div class="city-map-controls"><button data-action="in" aria-label="Zoom in">+</button><button data-action="out" aria-label="Zoom out">−</button><button data-action="player" aria-label="Recenter on your location">◎</button><button data-action="follow" aria-pressed="false">Follow</button><button data-action="city">Explore city</button></div>
      <div class="city-map-north" aria-label="North is up">↑<small>N</small></div><div class="city-map-mode">Explore freely</div>
      <div class="city-map-message" role="status" hidden></div><div class="city-map-scale"></div>
      <a class="city-map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>`;
    document.body.append(this.root);this.canvas=this.root.querySelector('canvas');this.ctx=this.canvas.getContext('2d');if(!this.ctx)throw Error('Map canvas unavailable');
    for(const [key,selector] of Object.entries({input:'input',results:'.city-map-results',details:'.city-map-details',filters:'.city-map-filters',status:'.city-map-message',scale:'.city-map-scale',mode:'.city-map-mode',regionName:'.city-map-region',closeButton:'.city-map-close'}))this[key]=this.root.querySelector(selector);
    this.closeButton.addEventListener('click',()=>this.close(),{signal});
    this.root.querySelector('.city-map-controls').addEventListener('click',event=>{const action=event.target.closest('button')?.dataset.action;if(action==='in')this.zoom(0.65);if(action==='out')this.zoom(1/0.65);if(action==='player')this.recenter();if(action==='follow')this.toggleFollow();if(action==='city')this.fitCity();},{signal});
    this.createFilters();this.input.addEventListener('input',()=>{clearTimeout(this.searchTimer);const version=++this.searchVersion;if(!this.input.value.trim()){this.results.hidden=true;this.results.replaceChildren();return;}this.searchTimer=setTimeout(()=>void this.runSearch(version),180);},{signal});
    window.addEventListener('keydown',event=>{if(!this.opened)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();this.close();}if(event.key==='Tab'){const nodes=[...this.root.querySelectorAll('button,input,a,select')].filter(n=>n.getClientRects().length&&!n.disabled),first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}},{signal,capture:true});
    for(const type of ['keydown','keyup'])this.root.addEventListener(type,e=>e.stopPropagation(),{signal});
    this.canvas.addEventListener('wheel',event=>{event.preventDefault();const p=this.localPoint(event);this.zoom(Math.exp(Math.max(-200,Math.min(200,event.deltaY))*0.002),p.x,p.y);},{signal,passive:false});
    this.canvas.addEventListener('pointerdown',event=>{if(event.button!==0)return;this.canvas.setPointerCapture(event.pointerId);const p=this.localPoint(event);this.pointers.set(event.pointerId,p);if(this.pointers.size===1)this.tap={...p,moved:false};else if(this.tap)this.tap.moved=true;},{signal});
    this.canvas.addEventListener('pointermove',e=>this.pointerMove(e),{signal});
    const end=event=>{if(!this.pointers.has(event.pointerId))return;const p=this.localPoint(event);if(event.type==='pointerup'&&this.pointers.size===1&&this.tap&&!this.tap.moved&&Math.hypot(p.x-this.tap.x,p.y-this.tap.y)<8)this.hitTest(p);this.pointers.delete(event.pointerId);if(!this.pointers.size)this.tap=null;};
    for(const type of ['pointerup','pointercancel','lostpointercapture'])this.canvas.addEventListener(type,end,{signal});
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(this.root);
  }
  localPoint(event){const r=this.canvas.getBoundingClientRect();return {x:event.clientX-r.left,y:event.clientY-r.top};}
  pointerMove(event){
    const old=this.pointers.get(event.pointerId);if(!old)return;const p=this.localPoint(event);if(this.tap&&Math.hypot(p.x-this.tap.x,p.y-this.tap.y)>6)this.tap.moved=true;
    const before=[...this.pointers.values()];this.pointers.set(event.pointerId,p);const after=[...this.pointers.values()];
    this.follow=false;this.updateFollowButton();
    if(before.length===1){this.centerX-=(p.x-old.x)*this.metersPerPixel;this.centerZ-=(p.y-old.y)*this.metersPerPixel;}
    else{const midpoint=a=>({x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2}),m1=midpoint(before),m2=midpoint(after),anchor=this.screenToWorld(m1.x,m1.y),d1=Math.hypot(before[0].x-before[1].x,before[0].y-before[1].y),d2=Math.hypot(after[0].x-after[1].x,after[0].y-after[1].y);if(d1&&d2)this.metersPerPixel=Math.max(this.minZoom,Math.min(this.maxZoom,this.metersPerPixel*d1/d2));const world=this.screenToWorld(m2.x,m2.y);this.centerX+=anchor.x-world.x;this.centerZ+=anchor.z-world.z;}
    this.viewportChanged();
  }
  createFilters(){
    for(const name of ['All',...Object.keys(CATEGORY_GROUPS)]){const b=document.createElement('button');b.textContent=name;b.dataset.category=name;b.setAttribute('aria-pressed',String(name==='All'));b.addEventListener('click',()=>this.chooseCategory(name==='All'?null:CATEGORY_GROUPS[name],name),{signal:this.events.signal});this.filters.append(b);}
    const more=document.createElement('select');more.setAttribute('aria-label','More nearby categories');
    for(const [value,title] of [['','More'],['hotel','Hotels'],['bank','Banks'],['university','Universities'],['park','Parks'],['sports','Sports'],['landmark','Landmarks'],['transport','Transport'],['market','Markets']]){const o=document.createElement('option');o.value=value;o.textContent=title;more.append(o);}
    more.addEventListener('change',()=>this.chooseCategory(more.value?[more.value]:null,'More'),{signal:this.events.signal});this.filters.append(more);
  }
  chooseCategory(categories,name){this.categories=categories;this.filters.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category===name)));this.invalidate();}
  async runSearch(version){try{const matches=await this.data.search(this.input.value,20);if(version!==this.searchVersion||!this.opened)return;this.results.replaceChildren();this.results.hidden=false;
      if(!matches.length){const p=document.createElement('p');p.textContent='No places found in this region.';this.results.append(p);}
      for(const place of matches){const b=document.createElement('button'),icon=document.createElement('i'),name=document.createElement('strong'),category=document.createElement('span');icon.textContent=CATEGORY_GLYPHS[place.category]??'↗';name.textContent=place.name;category.textContent=`${categoryLabel(place.category)} · ${formatDistance(destinationDistance(this.player,place))}`;b.append(icon,name,category);b.addEventListener('click',()=>void this.selectSearchResult(place),{signal:this.events.signal});this.results.append(b);}
    }catch{if(version===this.searchVersion&&this.opened)this.message('Search is temporarily unavailable. You can still explore the map.');}}
  async selectSearchResult(result){const version=++this.selectionVersion;this.searchVersion++;this.results.hidden=true;this.follow=false;this.updateFollowButton();this.centerX=result.x;this.centerZ=result.z;this.metersPerPixel=1.5;this.selectPOI(result);this.viewportChanged();try{const place=await this.data.details(result);if(version===this.selectionVersion&&this.opened&&place)this.selectPOI(place);}catch{if(version===this.selectionVersion&&this.opened)this.message('Extra place details could not load. Location remains available.');}}
  hitTest(p){let closest=null,distance=24;for(const m of this.markers){const d=Math.hypot(m.x-p.x,m.y-p.y);if(d<distance){distance=d;closest=m.poi;}}if(closest){this.selectionVersion++;this.selectPOI(closest);}}
  selectPOI(place){
    this.selected=place;this.details.replaceChildren();this.details.hidden=false;
    const close=document.createElement('button');close.className='city-map-details-close';close.textContent='×';close.setAttribute('aria-label','Close place details');close.addEventListener('click',()=>{this.selected=null;this.selectedDistance=null;this.details.hidden=true;this.invalidate();},{signal:this.events.signal});
    const category=document.createElement('small');category.className='city-map-kicker';category.textContent=categoryLabel(place.category);
    const title=document.createElement('h2');title.textContent=place.name;this.selectedDistance=document.createElement('p');this.selectedDistance.className='city-map-distance';this.selectedDistance.textContent=`${formatDistance(destinationDistance(this.player,place))} away · straight line`;
    this.details.append(close,category,title,this.selectedDistance);
    for(const [label,value] of [['Address',place.address],['Opening hours',place.openingHours],['Phone',place.phone]])if(value){const p=document.createElement('p'),small=document.createElement('small');small.textContent=label;p.append(small,document.createTextNode(value));this.details.append(p);}
    const source=document.createElement('small');source.textContent=place.source?.provider??'OpenStreetMap · map index';this.details.append(source);
    if(/^https?:\/\//i.test(place.website??'')){const link=document.createElement('a');link.href=place.website;link.textContent='Website';link.target='_blank';link.rel='noopener noreferrer';this.details.append(link);}
    const actions=document.createElement('div');actions.className='city-map-detail-actions';const dest=document.createElement('button');dest.className='city-map-destination';dest.textContent='Set destination';dest.addEventListener('click',()=>{const destination={id:place.id,x:place.x,z:place.z,region:place.region??this.data.region?.slug,name:place.name,category:place.category};this.setDestination(destination);window.dispatchEvent(new CustomEvent('cityverse:set-destination',{detail:{poi:destination,destination}}));this.options.onSetDestination?.(destination);this.close();},{signal:this.events.signal});
    const center=document.createElement('button');center.textContent='Center map';center.addEventListener('click',()=>{this.follow=false;this.updateFollowButton();this.centerX=place.x;this.centerZ=place.z;this.viewportChanged();},{signal:this.events.signal});actions.append(dest,center);this.details.append(actions);this.invalidate();
  }
  message(text){if(this.destroyed||!this.status)return;this.status.textContent=text;this.status.hidden=false;clearTimeout(this.messageTimer);this.messageTimer=setTimeout(()=>this.status.hidden=true,7000);}

  render(){
    const start=performance.now(),ctx=this.ctx,m=this.metersPerPixel;ctx.setTransform(this.dpr,0,0,this.dpr,0,0);ctx.fillStyle=P.land;ctx.fillRect(0,0,this.width,this.height);
    const b=this.bounds(),manifest=this.data.manifest,overview=this.data.overview,tiles=this.data.visible(b);
    this.layout=new LabelLayout(this.low?32:48);this.markers=[];this.markerCells=new Set();this.roadLabels=new Map();
    if(overview)this.drawContext(overview,0,0,b);for(const t of tiles)this.drawContext(t,t.tx*manifest.tileSize,t.tz*manifest.tileSize,b);
    if(overview)this.drawRoads(overview,0,0,b,false);for(const t of tiles)this.drawRoads(t,t.tx*manifest.tileSize,t.tz*manifest.tileSize,b,true);
    const places=new Map();for(const p of overview?.places??[])places.set(p.id,p);for(const t of tiles)for(const p of t.places)places.set(p.id,p);
    for(const p of [...places.values()].sort((a,b)=>(b.placeType==='city')-(a.placeType==='city')||(b.importance??0)-(a.importance??0))){if(m>14&&!['city','town','suburb'].includes(p.placeType))continue;this.drawLabel(p.name,p.x,p.z,14,p.placeType==='city');}
    const candidates=new Map();for(const p of this.data.registry.all())if(m<45||p.importance>=3)candidates.set(p.id,p);if(m<=5)for(const t of tiles)for(const p of t.pois)candidates.set(p.id,p);
    if(this.selected)candidates.set(this.selected.id,this.selected);
    const sorted=[...candidates.values()].sort((a,b)=>Number(b.id===this.selected?.id)-Number(a.id===this.selected?.id)||(b.labelPriority??b.importance??1)-(a.labelPriority??a.importance??1)||destinationDistance(this.player,a)-destinationDistance(this.player,b));
    for(const p of sorted){if(this.categories&&!this.categories.includes(p.category)&&p.id!==this.selected?.id)continue;if(this.markers.length>=(this.low?45:85)&&p.id!==this.selected?.id)continue;this.drawPOI(p);}
    if(this.destination&&this.destination.region===this.data.region?.slug)this.drawDestination(this.destination);
    for(const label of [...this.roadLabels.values()].sort((a,b)=>a.rank-b.rank||b.length-a.length))this.drawLabel(label.name,label.x,label.z,11);
    const p=this.worldToScreen(this.player.x,this.player.z);ctx.save();ctx.translate(p.x,p.y);ctx.fillStyle=P.player;ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.rotate(mapBearing(this.player.heading,this.player.driving));ctx.beginPath();ctx.moveTo(0,-15);ctx.lineTo(10,11);ctx.lineTo(0,6);ctx.lineTo(-10,11);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
    const distance=100*m,power=10**Math.floor(Math.log10(distance)),scale=[1,2,5,10].map(n=>n*power).find(n=>n>=distance/2)??power;this.scale.style.width=`${scale/m}px`;this.scale.textContent=formatDistance(scale);
    if(this.metrics.firstOpenMs===null){this.metrics.firstPaintAt=performance.now();this.metrics.firstOpenMs=this.metrics.firstPaintAt-this.openStart;}if(overview&&this.metrics.firstBasemapPaintAt===null)this.metrics.firstBasemapPaintAt=performance.now();if(tiles.length&&this.metrics.firstDetailPaintAt===null)this.metrics.firstDetailPaintAt=performance.now();this.metrics.renderPeakMs=Math.max(this.metrics.renderPeakMs,performance.now()-start);this.metrics.renders++;
  }
  drawContext(tile,ox,oz,bounds){
    const ctx=this.ctx,m=this.metersPerPixel,kinds=this.data.manifest?.areaKinds??[];
    for(const [kind,id,name,rings] of tile.areas??[]){const ring=rings[0];if(!ring?.length)continue;let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;for(const [x,z] of ring){minX=Math.min(minX,x+ox);maxX=Math.max(maxX,x+ox);minZ=Math.min(minZ,z+oz);maxZ=Math.max(maxZ,z+oz);}if(maxX<bounds.minX||minX>bounds.maxX||maxZ<bounds.minZ||minZ>bounds.maxZ)continue;
      ctx.fillStyle=P[kinds[kind]]??P.residential;ctx.beginPath();for(const r of rings){r.forEach(([x,z],i)=>{const p=this.worldToScreen(x+ox,z+oz);if(!i)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);});ctx.closePath();}ctx.fill('evenodd');
    }
    ctx.strokeStyle=P.river;ctx.lineWidth=Math.max(1.4,Math.min(5,3/m));ctx.lineCap='round';ctx.beginPath();for(const r of tile.rivers??[]){if(Math.max(r[0],r[2])+ox<bounds.minX||Math.min(r[0],r[2])+ox>bounds.maxX||Math.max(r[1],r[3])+oz<bounds.minZ||Math.min(r[1],r[3])+oz>bounds.maxZ)continue;const a=this.worldToScreen(r[0]+ox,r[1]+oz),b=this.worldToScreen(r[2]+ox,r[3]+oz);ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}ctx.stroke();
  }
  drawRoads(tile,ox,oz,bounds,detail){
    const ctx=this.ctx,m=this.metersPerPixel,classes=this.data.manifest?.roadClasses??[];
    const groups=new Map();for(const r of tile.roads??[]){if(Math.max(r[0],r[2])+ox<bounds.minX||Math.min(r[0],r[2])+ox>bounds.maxX||Math.max(r[1],r[3])+oz<bounds.minZ||Math.min(r[1],r[3])+oz>bounds.maxZ)continue;const type=classes[r[4]]?.type,style=roadStyle(type);if(detail&&m>3&&style.rank>4)continue;if(!groups.has(r[4]))groups.set(r[4],[]);groups.get(r[4]).push(r);}
    for(const [id,roads] of [...groups].sort(([a],[b])=>roadStyle(classes[b]?.type).rank-roadStyle(classes[a]?.type).rank)){
      const style=roadStyle(classes[id]?.type);for(const outline of [true,false]){ctx.strokeStyle=outline?P.roadOutline:style.color;ctx.lineWidth=style.width+(outline?1.4:0);ctx.lineCap='round';ctx.beginPath();for(const r of roads){const a=this.worldToScreen(r[0]+ox,r[1]+oz),b=this.worldToScreen(r[2]+ox,r[3]+oz);ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}ctx.stroke();}
    }
    for(const [id,roads] of groups){const style=roadStyle(classes[id]?.type);if(m>18&&style.rank>1||m>6&&style.rank>3||m>2&&style.rank>4)continue;for(const r of roads){const name=tile.names[r[5]];if(!name)continue;const length=Math.hypot(r[2]-r[0],r[3]-r[1])/m;if(length<45)continue;const previous=this.roadLabels.get(name);if(!previous||previous.length<length)this.roadLabels.set(name,{name,x:(r[0]+r[2])/2+ox,z:(r[1]+r[3])/2+oz,length,rank:style.rank});}}
  }
  drawLabel(text,x,z,fontSize=11,bold=false,offset=0){const p=this.worldToScreen(x,z),ctx=this.ctx,name=String(text).slice(0,66);p.y+=offset;if(p.x<45||p.y<145||p.x>this.width-100||p.y>this.height-40)return false;ctx.font=`${bold?'700':'500'} ${fontSize}px system-ui`;const width=ctx.measureText(name).width;if(!this.layout.reserve(name,p.x,p.y,width,fontSize+3))return false;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=4;ctx.strokeStyle=P.land;ctx.strokeText(name,p.x,p.y);ctx.fillStyle=bold?P.ink:P.muted;ctx.fillText(name,p.x,p.y);return true;}
  drawPOI(place){const p=this.worldToScreen(place.x,place.z);if(p.x<20||p.y<130||p.x>this.width-20||p.y>this.height-30)return;const selected=place.id===this.selected?.id,important=this.data.registry.records.has(place.id),cell=`${Math.floor(p.x/28)}:${Math.floor(p.y/28)}`;if(!selected&&(this.markerCells.has(cell)||this.layout.intersects({x:p.x-11,y:p.y-11,w:22,h:22})))return;this.markerCells.add(cell);this.layout.block(p.x,p.y,selected?26:20,selected?26:20);
    const ctx=this.ctx;ctx.beginPath();ctx.arc(p.x,p.y,selected?12:important?9:7,0,Math.PI*2);ctx.fillStyle=CATEGORY_COLORS[place.category]??'#667c73';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=selected?3:2;ctx.stroke();ctx.fillStyle='#fff';ctx.font='bold 10px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(CATEGORY_GLYPHS[place.category]??'•',p.x,p.y);this.markers.push({x:p.x,y:p.y,poi:place});if(selected||important||this.metersPerPixel<1.5)this.drawLabel(place.name,place.x,place.z,11,important,26);
  }
  drawDestination(place){const p=this.worldToScreen(place.x,place.z),ctx=this.ctx;if(p.x<0||p.y<0||p.x>this.width||p.y>this.height)return;ctx.fillStyle=P.destination;ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(p.x,p.y+12);ctx.bezierCurveTo(p.x-20,p.y-8,p.x+20,p.y-8,p.x,p.y+12);ctx.fill();ctx.stroke();this.drawLabel(place.name,place.x,place.z,11,true,-18);}
  getStats(){return {...this.data.getStats(),...this.metrics,labels:this.layout?.boxes.length??0,labelLimit:this.low?32:48,pois:this.markers.length,follow:this.follow,mpp:this.metersPerPixel,player:{...this.player},destination:this.destination??null,opened:this.opened};}
}
export default CityMap;
