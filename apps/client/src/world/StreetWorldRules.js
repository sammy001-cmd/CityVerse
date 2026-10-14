import {seedFor,pointInRing} from './BuildingRules.js';
import {compoundTreatment} from './BuildingArchitecture.js';
export const STREET_CELL_SIZE=250;
export function streetLOD(distance,low=false,previous=null){
  const near=low?65:120,medium=low?220:380,h=15;
  if(previous==='near'&&distance<near+h)return previous;
  if(previous==='medium'&&distance>=near-h&&distance<medium+h)return previous;
  if(previous==='far'&&distance>=medium-h)return previous;
  return distance<near?'near':distance<medium?'medium':'far';
}
const pointSegment=(x,z,e)=>{const dx=e.b[0]-e.a[0],dz=e.b[1]-e.a[1],n=dx*dx+dz*dz;
  const t=n?Math.max(0,Math.min(1,((x-e.a[0])*dx+(z-e.a[1])*dz)/n)):0;
  return Math.hypot(x-e.a[0]-dx*t,z-e.a[1]-dz*t);};
export class StreetOccupancy {
  constructor({edges=[],buildings=[],junctions=[],gates=[]}={}){
    this.cells=new Map();this.furniture=[];
    const add=(item,bounds)=>{for(let x=Math.floor(bounds.minX/32);x<=Math.floor(bounds.maxX/32);x++)for(let z=Math.floor(bounds.minZ/32);z<=Math.floor(bounds.maxZ/32);z++){
      const key=`${x}_${z}`;if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(item);}};
    for(const e of edges)add({kind:'road',e},{minX:Math.min(e.a[0],e.b[0])-e.width/2-2,maxX:Math.max(e.a[0],e.b[0])+e.width/2+2,minZ:Math.min(e.a[1],e.b[1])-e.width/2-2,maxZ:Math.max(e.a[1],e.b[1])+e.width/2+2});
    for(const b of buildings)add({kind:'building',b},b);
    for(const j of junctions){const radius=(j.radius??5)+6;add({kind:'junction',j},{minX:j.x-radius,maxX:j.x+radius,minZ:j.z-radius,maxZ:j.z+radius});}
    for(const g of gates)add({kind:'gate',j:{x:g.x,z:g.z,radius:3}},{minX:g.x-4,maxX:g.x+4,minZ:g.z-4,maxZ:g.z+4});
  }
  clear(x,z,r=0.3,{furniture=true}={}){
    const seen=new Set();
    for(let u=Math.floor((x-r)/32);u<=Math.floor((x+r)/32);u++)for(let v=Math.floor((z-r)/32);v<=Math.floor((z+r)/32);v++)for(const item of this.cells.get(`${u}_${v}`)??[]){
      if(seen.has(item))continue;seen.add(item);
      if(item.kind==='road'&&pointSegment(x,z,item.e)<item.e.width/2+r)return false;
      if(['junction','gate'].includes(item.kind)&&Math.hypot(x-item.j.x,z-item.j.z)<(item.j.radius??5)+r+3)return false;
      if(item.kind==='building'){
        const b=item.b;if(x+r<b.minX||x-r>b.maxX||z+r<b.minZ||z-r>b.maxZ)continue;
        if(b.polygons.some(p=>[[x,z],[x+r,z],[x-r,z],[x,z+r],[x,z-r]].some(q=>pointInRing(...q,p[0])&&!p.slice(1).some(h=>pointInRing(...q,h)))))return false;
        if(b.polygons.some(p=>p.some(ring=>ring.some((a,i)=>pointSegment(x,z,{a,b:ring[(i+1)%ring.length]})<r))))return false;
      }
    }
    return !furniture||this.furniture.every(p=>Math.hypot(x-p.x,z-p.z)>=r+p.radius);
  }
  reserve(x,z,r){if(!this.clear(x,z,r))return false;this.furniture.push({x,z,radius:r});return true;}
}
export function roadStreetStyle(edge,density,seed){
  const main=['primary','secondary','tertiary','trunk'].includes(edge.type),urban=density>=12;
  return {drain:seed%5===0?'none':!urban?'earth':main&&seed%3===0?'open_concrete':'shallow',
    walkway:edge.sidewalkWidth>0?'existing_sidewalk':main&&urban?'concrete':urban&&seed%3===0?'compacted_earth':'informal_shoulder',
    poles:!['motorway','motorway_link'].includes(edge.type),lights:main||urban&&seed%4===0,
    vegetation:seed%3!==0};
}
function anchors(edge,spacing,phase,off){
  const dx=edge.b[0]-edge.a[0],dz=edge.b[1]-edge.a[1],length=Math.hypot(dx,dz);if(!length)return [];
  const ux=dx/length,uz=dz/length,start=edge.a[0]*ux+edge.a[1]*uz;
  const first=((phase-start)%spacing+spacing)%spacing,out=[];
  for(let t=first;t<length;t+=spacing)out.push({x:edge.a[0]+ux*t-uz*off,z:edge.a[1]+uz*t+ux*off,angle:Math.atan2(dx,dz)});
  return out;
}
export function wireLinks(poles,low=false){
  const result=[],runs=new Map();
  for(const p of poles){const key=`${p.roadId}:${p.side}`;if(!runs.has(key))runs.set(key,[]);runs.get(key).push(p);}
  for(const run of runs.values()){
    run.sort((a,b)=>a.sequence-b.sequence||a.x-b.x||a.z-b.z);
    for(let i=1;i<run.length;i++){
      const a=run[i-1],b=run[i],length=Math.hypot(a.x-b.x,a.z-b.z);
      if(length<18||length>65||Math.abs(a.y-b.y)>7)continue;
      for(let cable=0;cable<(low?1:2);cable++)for(let segment=0;segment<5;segment++){
        const P=t=>[a.x+(b.x-a.x)*t,a.y+7.3-cable*0.35+(b.y-a.y)*t-Math.sin(Math.PI*t)*Math.min(0.65,length*0.016),a.z+(b.z-a.z)*t];
        result.push(...P(segment/5),...P((segment+1)/5));
      }
    }
  }return result;
}
export function* streetCellSteps({region,key,edges=[],buildings=[],junctions=[],stops=[],worldSurface,low=false,lod='near'}){
  const [cx,cz]=key.split('_').map(Number),x0=cx*250,z0=cz*250;
  const sortedBuildings=buildings.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  const owns=(x,z)=>x>=x0+3&&x<x0+247&&z>=z0+3&&z<z0+247;
  const occupancy=new StreetOccupancy({edges,buildings,junctions}),items=[],strips=[],labels=[],poles=[];
  const gates=buildings.flatMap(b=>b.boundary?.source==='explicit'?b.boundary.gates??[]:[]);
  const add=(kind,p,radius,extra={})=>{if(!owns(p.x,p.z))return false;
    if(['tree','palm','shrub','planter'].includes(kind)&&gates.some(g=>Math.hypot(p.x-g.x,p.z-g.z)<radius+2))return false;
    // Query the rendered footprint as well as the cheap road capsule, including widened bends.
    const rendered=worldSurface.roadSurface?.sampleRendered?.bind(worldSurface.roadSurface);
    if(rendered&&[[0,0],[radius,0],[-radius,0],[0,radius],[0,-radius]].some(([dx,dz])=>rendered(p.x+dx,p.z+dz)?.surface==='road'))return false;
    if(!occupancy.reserve(p.x,p.z,radius))return false;
    const y=worldSurface.heightAt(p.x,p.z);if(!Number.isFinite(y))return false;
    const item={kind,...p,y,radius,...extra};items.push(item);if(kind==='pole')poles.push(item);return true;};
  for(const e of edges.slice().sort((a,b)=>String(a.roadId).localeCompare(String(b.roadId))||(a.sequence??0)-(b.sequence??0)||a.a[0]-b.a[0]||a.a[1]-b.a[1]||a.b[0]-b.b[0]||a.b[1]-b.b[1])){
    yield;
    const seed=seedFor(`${region}:street:${e.roadId}`),style=roadStreetStyle(e,buildings.length,seed),side=seed%2?1:-1;
    const off=(e.width/2+(e.shoulderWidth??0.7)+(e.sidewalkWidth??0)+2.1)*side;
    if(style.poles&&(lod!=='far'||['primary','secondary','trunk'].includes(e.type)))
      for(const p of anchors(e,low?46:38,seed%38,off))if(!poles.some(q=>q.roadId===e.roadId&&Math.hypot(q.x-p.x,q.z-p.z)<24))add('pole',p,0.45,{roadId:e.roadId,sequence:e.sequence??0,side,majorContext:['primary','secondary','trunk'].includes(e.type)});
    if(style.lights)for(const p of anchors(e,low?110:78,(seed>>>5)%78,-off))add('light',p,0.5,{majorContext:['primary','secondary','trunk'].includes(e.type)});
    if(lod==='far')continue;
    if(style.vegetation)for(const p of anchors(e,low?90:54,(seed>>>8)%54,off+side*3.5)){
      const kind=seedFor(`${region}:${e.roadId}:${Math.round(p.x)}:${Math.round(p.z)}`)%11===0?'palm':'tree';add(kind,p,2.1,{scale:0.8+(seed%5)*0.1});
    }
    const dx=e.b[0]-e.a[0],dz=e.b[1]-e.a[1],length=Math.hypot(dx,dz);if(!length)continue;
    for(let t=0;t<length;t+=3){
      const end=Math.min(length,t+3),a={x:e.a[0]+dx*t/length-dz/length*off,z:e.a[1]+dz*t/length+dx/length*off},
        b={x:e.a[0]+dx*end/length-dz/length*off,z:e.a[1]+dz*end/length+dx/length*off};
      if(!owns((a.x+b.x)/2,(a.z+b.z)/2)||!occupancy.clear(a.x,a.z,0.3,{furniture:false})||!occupancy.clear(b.x,b.z,0.3,{furniture:false})||!occupancy.clear((a.x+b.x)/2,(a.z+b.z)/2,0.3,{furniture:false}))continue;
      const ay=worldSurface.heightAt(a.x,a.z),by=worldSurface.heightAt(b.x,b.z);if(!Number.isFinite(ay)||!Number.isFinite(by)||Math.abs(ay-by)>0.9)continue;
      if(style.drain!=='none')strips.push({kind:'drain',variant:style.drain,a:[a.x,ay+0.025,a.z],b:[b.x,by+0.025,b.z],width:0.38,metres:end-t});
      if(style.walkway==='concrete'||style.walkway==='compacted_earth'){
        const wx=-dz/length*side*0.85,wz=dx/length*side*0.85;
        if(occupancy.clear(a.x+wx,a.z+wz,0.6,{furniture:false})&&occupancy.clear(b.x+wx,b.z+wz,0.6,{furniture:false}))strips.push({kind:'walkway',variant:style.walkway,a:[a.x+wx,ay+0.02,a.z+wz],b:[b.x+wx,by+0.02,b.z+wz],width:0.85});
      }
      if(lod==='near'&&!low&&seed%5===0){const vx=-dz/length*side*1.6,vz=dx/length*side*1.6;
        if(occupancy.clear(a.x+vx,a.z+vz,0.5,{furniture:false})&&occupancy.clear(b.x+vx,b.z+vz,0.5,{furniture:false}))strips.push({kind:'verge',variant:'rough_grass',a:[a.x+vx,ay,a.z+vz],b:[b.x+vx,by,b.z+vz],width:0.65});}
    }
    if(lod==='near'&&!low){
      for(const p of anchors(e,160,(seed>>>12)%160,off+side))if(add(e.name?'sign':seed%3===0?'regulatory':'direction',p,0.25,{label:e.name??'',form:e.name?'street_name':seed%3===0?'regulatory_holder':'direction_holder'}))if(e.name)labels.push(e.name);
      for(const p of anchors(e,135,(seed>>>16)%135,off+side*2))if(seed%4===0)add('bench',p,0.9);else if(seed%7===0)add('bin',p,0.35);
      if(['primary','secondary','tertiary'].includes(e.type)&&seed%9===0)for(const p of anchors(e,180,seed%180,off))add('bollard',p,0.2);
      if(seed%13===0)for(const p of anchors(e,210,seed%210,off+side*1.5)){
        const drop=Math.abs(worldSurface.heightAt(p.x,p.z)-worldSurface.heightAt(p.x-dz/length*side*2,p.z+dx/length*side*2));
        if(drop>0.8)add('barrier',p,0.8);
      }
    }
  }
  if(lod!=='far')for(const b of sortedBuildings){
    yield;
    const h=b.housing;if(!h||h.propertyUse===0||!b.frontage||h.visualSeed%5!==0)continue;
    const center=[(b.minX+b.maxX)/2,(b.minZ+b.maxZ)/2],vx=b.frontage.point[0]-center[0],vz=b.frontage.point[1]-center[1],d=Math.hypot(vx,vz);if(!d)continue;
    const p={x:center[0]+vx/d*(Math.min(b.maxX-b.minX,b.maxZ-b.minZ)/2+1.1),z:center[1]+vz/d*(Math.min(b.maxX-b.minX,b.maxZ-b.minZ)/2+1.1),angle:0};
    const recipe=b.streetContext;
    if((recipe?.parkingPotential??h.parkingPotential)||(recipe?.finish??h.finishQuality)>=2)add(lod==='near'&&!low&&(recipe?.finish??h.finishQuality)>=3?'planter':'shrub',p,0.65,{frontage:true});
  }
  if(lod==='near'&&!low)for(const building of sortedBuildings){
    yield;
    const boundary=compoundTreatment(building);if(!boundary)continue;
    const gates=building.boundary.gates??[];
    for(let i=1;i<boundary.points.length;i++){
      const a=boundary.points[i-1],b=boundary.points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length>30)continue;
      for(let t=0;t<length;t+=2.5){const end=Math.min(length,t+2.5),middle=(t+end)/2;
        const x=a[0]+(b[0]-a[0])*middle/length,z=a[1]+(b[1]-a[1])*middle/length;
        if(gates.some(g=>Number.isFinite(g.x)&&Math.hypot(x-g.x,z-g.z)<2))continue;
        const endpointY=[t,end].map(distance=>worldSurface.heightAt(a[0]+(b[0]-a[0])*distance/length,a[1]+(b[1]-a[1])*distance/length));
        add('wall',{x,z,angle:Math.atan2(b[0]-a[0],b[1]-a[1])},(end-t)/2+0.1,{y:Math.min(...endpointY),height:boundary.height+Math.abs(endpointY[0]-endpointY[1]),length:end-t,frontage:true,source:'explicit_boundary'});
      }
    }
    for(const g of gates)if(Number.isFinite(g.x)&&Number.isFinite(g.z))add('gate',{x:g.x,z:g.z,angle:g.angle??0},1.25,{frontage:true,source:'explicit_boundary'});
    const awning=building.boundary.awning;
    if(awning?.source==='explicit'&&Number.isFinite(awning.x)&&Number.isFinite(awning.z))add('awning',{x:awning.x,z:awning.z,angle:awning.angle??0},1.2,{source:'explicit_boundary'});
    const drive=building.boundary.driveway;
    if(drive?.source==='explicit'&&Array.isArray(drive.points))for(let i=1;i<drive.points.length;i++){
      const a=drive.points[i-1],b=drive.points[i];if(!a?.every(Number.isFinite)||!b?.every(Number.isFinite)||Math.hypot(a[0]-b[0],a[1]-b[1])>8)continue;
      if(owns((a[0]+b[0])/2,(a[1]+b[1])/2)&&occupancy.clear(a[0],a[1],1)&&occupancy.clear(b[0],b[1],1))strips.push({kind:'driveway',variant:'source_hint',a:[a[0],worldSurface.heightAt(...a),a[1]],b:[b[0],worldSurface.heightAt(...b),b[1]],width:1.7,frontage:true});
    }
  }
  // Only actual source transport points may create stop structures.
  if(lod==='near'&&!low)for(const stop of stops)if(['osm','public_transport'].includes(stop.source)&&stop.id&&(!stop.region||stop.region===region)){
    const angle=stop.angle??0,source={sourceId:stop.id,source:stop.source,structureSource:'procedural'};
    if(add('shelter',{x:stop.x,z:stop.z,angle},2.1,source))add('sign',{x:stop.x+Math.cos(angle)*2.6,z:stop.z-Math.sin(angle)*2.6,angle},0.25,{...source,form:'public_transport_holder'});
  }
  return {region,key,lod,items,strips,labels,poles,wirePositions:lod==='near'?wireLinks(poles,low):[],
    drainMetres:strips.filter(s=>s.kind==='drain').reduce((s,d)=>s+d.metres,0)};
}

export function generateStreetCell(options){
  const steps=streetCellSteps(options);let result;do{result=steps.next();}while(!result.done);return result.value;
}
export async function generateStreetCellAsync(options,yieldFrame){
  const steps=streetCellSteps(options);let result,workMs=0,sliceMs=0,slicePeakMs=0;
  do{const start=performance.now();result=steps.next();const ms=performance.now()-start;workMs+=ms;sliceMs+=ms;
    slicePeakMs=Math.max(slicePeakMs,sliceMs);if(!result.done&&sliceMs>=4){await yieldFrame();sliceMs=0;}
  }while(!result.done);
  return {...result.value,generationWorkMs:workMs,generationSlicePeakMs:slicePeakMs};
}
