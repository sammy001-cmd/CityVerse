// Procedural interpretation only. These rules never alter OSM source fields.
export const ARCHETYPES = ['bungalow','low_rise','multi_storey','roadside_commercial',
  'office_institutional','school_block','industrial','worship','generic'];
export const DETAIL_RANGES = {normal:{near:95,medium:285,hysteresis:18},low:{near:45,medium:170,hysteresis:12}};
export const WALL_PALETTE = [0xd6cbb1,0xba9f78,0x929b96,0xa7b29a,0xc3ad72,0x849ba5,0xb19270,0x91998d];
const ROOF_PALETTE = [0x8c5145,0x667679,0x796457,0x557465,0x8e9290];
const FINISH_PALETTES = [[2,6,1,7],[1,2,4,7],[0,1,3,4,5],[0,3,4,5],[0,2,3,5],[0,2,4,5]];
export function signedArea(ring) {return ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];},0)/2;}
export function footprintArea(b) {return b.polygons.reduce((sum,p)=>sum+Math.abs(signedArea(p[0]))-p.slice(1).reduce((s,r)=>s+Math.abs(signedArea(r)),0),0);}
export function distanceToBuilding(b,x,z) {return Math.hypot(Math.max(b.minX-x,0,x-b.maxX),Math.max(b.minZ-z,0,z-b.maxZ));}
export function architecturalLOD(distance,low=false,previous=null) {
  const {near,medium,hysteresis:h}=DETAIL_RANGES[low?'low':'normal'];
  if(previous==='near'&&distance<near+h)return 'near';
  if(previous==='medium'&&distance>=near-h&&distance<medium+h)return 'medium';
  if(previous==='far'&&distance>=medium-h)return 'far';
  return distance<near?'near':distance<medium?'medium':'far';
}
export function nearestRoadFront(b,edges=[]) {
  const centre=[(b.minX+b.maxX)/2,(b.minZ+b.maxZ)/2];let best=null;
  for(const edge of edges) {
    const roadType=edge.roadType??edge.type??'unknown';
    if(['motorway','motorway_link'].includes(roadType))continue;
    const dx=edge.b[0]-edge.a[0],dz=edge.b[1]-edge.a[1],n=dx*dx+dz*dz;if(!n)continue;
    const t=Math.max(0,Math.min(1,((centre[0]-edge.a[0])*dx+(centre[1]-edge.a[1])*dz)/n));
    const point=[edge.a[0]+dx*t,edge.a[1]+dz*t],distance=Math.hypot(point[0]-centre[0],point[1]-centre[1]);
    if(distance<=60&&(!best||distance<best.distance))best={point,distance,roadId:edge.roadId,roadType,width:edge.width};
  }
  return best;
}
export function chooseArchetype(b) {
  const area=footprintArea(b),aspect=Math.max(b.maxX-b.minX,b.maxZ-b.minZ)/Math.max(1,Math.min(b.maxX-b.minX,b.maxZ-b.minZ));
  if(b.categorySource==='explicit') {
    if(['commercial','mixed_use','market'].includes(b.category))return 'roadside_commercial';
    if(['industrial','warehouse','parking_structure'].includes(b.category))return 'industrial';
    if(['school','university'].includes(b.category))return 'school_block';
    if(b.category==='place_of_worship')return 'worship';
    if(['office','hospital','clinic','hotel','government'].includes(b.category))return 'office_institutional';
    if(b.category==='residential_multi')return 'multi_storey';
    if(b.category==='residential_low')return b.height>5.8||b.levels>=2?'low_rise':'bungalow';
  }
  if(b.height>=9||b.levels>=3)return area>650?'office_institutional':'multi_storey';
  if(area>850&&aspect>2.1)return 'industrial';
  if(area>550&&aspect>1.8)return 'school_block';
  // Stable potential shop-house form. Availability of streamed roads must not
  // change the building's core identity, palette or roof between sessions.
  if(area>35&&area<650&&aspect<3.5&&b.seed%7===0)return 'roadside_commercial';
  if(b.height>5.8||b.levels>=2)return 'low_rise';
  if(area<320&&b.height<=5.8)return 'bungalow';
  return 'generic';
}
export function interpretBuilding(b) {
  const archetype=chooseArchetype(b),seed=b.seed>>>0;
  const housing=b.housing?.propertyUse>0?b.housing:null;
  let wall=WALL_PALETTE[seed%WALL_PALETTE.length];
  if(b.tags?.['building:material']==='concrete'||seed%19===0)wall=0x9c9f99;
  if(housing&&b.tags?.['building:material']!=='concrete') {
    const palette=FINISH_PALETTES[housing.finishQuality];
    if(palette)wall=WALL_PALETTE[palette[housing.visualSeed%palette.length]];
  }
  let roof=b.roof;
  if(b.roofSource!=='explicit') {
    if(['office_institutional','multi_storey','roadside_commercial'].includes(archetype))roof=seed%4?'flat':'hipped';
    else if(archetype==='industrial')roof=seed%4===0?'shed':'gable';
    else roof=['hipped','hipped','gable','hipped','pyramidal','flat'][seed%6];
    if(housing?.qualityTier>=4&&housing.luxuryEligible)roof=housing.visualSeed%3===0?'flat':'hipped';
  }
  const available=b.height-b.minHeight;
  // Source height is always the total top envelope; inferred height remains Phase A's value.
  const roofRise=roof==='flat'?0:Math.min(2.1,available*0.27,Math.max(0.25,available-b.levels*2.65));
  const eaveHeight=b.height-roofRise;
  const explicitFloors=b.heightSource==='explicit_levels'||Number(b.tags?.['building:levels'])>0;
  const floors=Math.max(1,Math.min(80,Math.floor(explicitFloors?b.levels:Math.min(b.levels,Math.max(1,(eaveHeight-b.minHeight)/2.65)))));
  return {source:'procedural',archetype,wall,roof,roofColor:roof==='flat'?0x8c908a:ROOF_PALETTE[(seed>>>5)%ROOF_PALETTE.length],
    accent:seed%13===0?0x698e89:0x9b9e94,window:0x34484e,frame:0xb9c1bb,
    floors,roofRise,eaveHeight,windowScale:housing?.finishQuality>=4?1.16:1,
    balcony:floors>=2&&(archetype==='multi_storey'&&seed%5===0||housing?.qualityTier>=3&&housing.visualSeed%4===0),
    veranda:['bungalow','low_rise'].includes(archetype)&&(seed%6===0||housing?.finishQuality>=3&&housing.visualSeed%5===0),
    commercialFront:archetype==='roadside_commercial'&&(b.categorySource==='explicit'||
      b.frontage&&b.frontage.distance<28&&!['footway','path','cycleway','steps'].includes(b.frontage.roadType))};
}
export function compoundTreatment(b) {
  // Building footprints alone do not establish a parcel or a safe boundary.
  // A future source adapter can supply a surveyed/explicit local boundary.
  if(b.boundary?.source!=='explicit'||!Array.isArray(b.boundary.points))return null;
  if(b.boundary.points.length<2||b.boundary.points.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||
    p[0]<b.minX-8||p[0]>b.maxX+8||p[1]<b.minZ-8||p[1]>b.maxZ+8))return null;
  return {source:'explicit-boundary',points:b.boundary.points,height:Math.min(1.6,Math.max(0.5,b.boundary.height??0.8))};
}
export function facadeEdges(ring) {
  const sign=signedArea(ring)>0?1:-1;
  return ring.map((a,i)=>{const b=ring[(i+1)%ring.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const along=[(b[0]-a[0])/length,(b[1]-a[1])/length];
    return {index:i,a,b,length,along,outward:[along[1]*sign,-along[0]*sign],midpoint:[(a[0]+b[0])/2,(a[1]+b[1])/2]};});
}
export function entranceFacade(b,ring) {
  const edges=facadeEdges(ring).filter(e=>e.length>=2.4);if(!edges.length)return null;
  if(b.frontage) {
    const candidates=edges.filter(e=>{const v=[b.frontage.point[0]-e.midpoint[0],b.frontage.point[1]-e.midpoint[1]];return v[0]*e.outward[0]+v[1]*e.outward[1]>0;});
    candidates.sort((a,c)=>Math.hypot(a.midpoint[0]-b.frontage.point[0],a.midpoint[1]-b.frontage.point[1])-Math.hypot(c.midpoint[0]-b.frontage.point[0],c.midpoint[1]-b.frontage.point[1]));
    if(candidates.length)return {...candidates[0],roadFacing:true};
  }
  edges.sort((a,c)=>c.length-a.length||a.index-c.index);return {...edges[0],roadFacing:false};
}
export function windowLayout(edge,style,b,lod,low=false) {
  if(lod==='far'||edge.length<3.2)return [];
  const spacing=style.archetype==='industrial'?5.5:style.archetype==='school_block'?3.4:3.1;
  const cols=Math.min(low?5:10,Math.floor((edge.length-1.2)/spacing));if(!cols)return [];
  const occupiedTop=b.baseY+(lod==='far'?b.height:style.eaveHeight),floorHeight=Math.min(3.5,(occupiedTop-b.baseY-b.minHeight)/style.floors);
  const rows=Math.min(low?3:8,style.floors);
  const windows=[];for(let row=0;row<rows;row++)for(let col=0;col<cols;col++) {
    const floor=rows===1?0:Math.round(row*(style.floors-1)/(rows-1));
    const width=Math.min((style.archetype==='industrial'?1.6:1.25)*(style.windowScale??1),edge.length/(cols+1)*0.55),y=b.baseY+b.minHeight+floor*floorHeight+Math.min(1.05,floorHeight*0.35),height=Math.min(1.3,floorHeight*0.42);
    if(y+height>occupiedTop-0.2)continue;
    windows.push({t:(col+1)*edge.length/(cols+1),width,y,height,floor});
  }
  return windows;
}
