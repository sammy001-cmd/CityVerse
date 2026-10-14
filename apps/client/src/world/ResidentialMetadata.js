import {seedFor} from './BuildingRules.js';
import {footprintArea,interpretBuilding,compoundTreatment} from './BuildingArchitecture.js';

// Versioned Cityverse interpretation, never a real-world valuation or occupancy claim.
export const HOUSING_VERSION=1;
export const PROPERTY_USES=['non_residential','residential','mixed_use'];
export const QUALITY_TIERS=['basic','affordable','standard','upper_mid','premium','luxury'];
export const RESIDENTIAL_ARCHETYPES=['starter_room','self_contained','small_flat','one_bed_flat','two_bed_flat',
  'three_bed_flat','apartment_block','bungalow','semi_detached','detached_house','duplex','terrace_house',
  'gated_estate_house','premium_duplex','luxury_villa','mansion'];
export const NEIGHBORHOOD_PROFILES=['dense_affordable','mixed_residential','middle_income','upper_middle',
  'premium_estate','luxury_low_density','commercial_residential','institutional','industrial'];
const TIER_WEIGHTS=[
  [24,43,24,7,2,0], [12,29,36,17,5,1], [6,20,42,24,7,1],
  [3,12,31,35,16,3], [2,9,22,31,28,8], [2,8,19,28,29,14],
  [14,34,33,15,4,0], [9,24,39,21,6,1], [19,37,30,12,2,0]
];
const institutional=new Set(['school','university','hospital','clinic','government']);
const industrial=new Set(['industrial','warehouse','parking_structure']);
const commercial=new Set(['commercial','mixed_use','market','office','hotel']);
const fraction=(seed,label)=>seedFor(`${seed}:${label}`)/0x100000000;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const aspect=b=>Math.max(b.maxX-b.minX,b.maxZ-b.minZ)/Math.max(1,Math.min(b.maxX-b.minX,b.maxZ-b.minZ));
const gap=(a,b)=>Math.hypot(Math.max(a.minX-b.maxX,b.minX-a.maxX,0),Math.max(a.minZ-b.maxZ,b.minZ-a.maxZ,0));

export function housingSeed(region,buildingId,salt='') {
  return seedFor(`housing:${HOUSING_VERSION}:${region}:${buildingId}:${salt}`);
}
export function propertyUnitId(region,buildingId,index) {
  if(!/^[a-z0-9-]+$/.test(region)||!/^(way|relation):\d+$/.test(buildingId)||!Number.isInteger(index)||index<0)
    throw new Error('Invalid property unit identity');
  return `${region}:${buildingId}:unit:${index}`;
}
function selectWeighted(weights,seed) {
  let remaining=fraction(seed,'tier')*weights.reduce((sum,n)=>sum+n,0);
  for(let i=0;i<weights.length;i++){remaining-=weights[i];if(remaining<0)return i;}
  return weights.length-1;
}
function validWeights(weights) {
  return Array.isArray(weights)&&weights.length===6&&weights.every(n=>Number.isFinite(n)&&n>=0)&&weights.some(n=>n>0);
}
function propertyUse(b,area) {
  if(b.categorySource==='explicit') {
    if(b.category==='mixed_use')return 2;
    if(['residential_low','residential_multi'].includes(b.category))return 1;
    if(b.category!=='generic')return 0;
  }
  // Small generic sheds and enormous generic halls are not speculative homes.
  return area>=24&&area<=1200&&aspect(b)<=4&&Math.min(b.maxX-b.minX,b.maxZ-b.minZ)>=3&&b.height-b.minHeight>=2.5&&b.height<=25?1:0;
}

// Spatial bins keep local spacing checks bounded; use the whole owning source tile,
// not loaded/rendered neighbours. Sorting, graphics mode and road arrival cannot change it.
function spacingIndex(records) {
  const cells=new Map(),size=40;
  for(const b of records)for(let x=Math.floor(b.minX/size);x<=Math.floor(b.maxX/size);x++)
    for(let z=Math.floor(b.minZ/size);z<=Math.floor(b.maxZ/size);z++){
      const key=`${x}_${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(b);
    }
  return b=>{
    let nearest=40;const seen=new Set();
    for(let x=Math.floor((b.minX-40)/size);x<=Math.floor((b.maxX+40)/size);x++)
      for(let z=Math.floor((b.minZ-40)/size);z<=Math.floor((b.maxZ+40)/size);z++)
        for(const other of cells.get(`${x}_${z}`)??[]){
          if(other.id===b.id||seen.has(other.id))continue;seen.add(other.id);nearest=Math.min(nearest,gap(b,other));
        }
    return nearest;
  };
}
function roadSignals(b,context) {
  // Only an explicitly canonical snapshot may affect persistent assignments.
  // Live streamed frontage remains a separate architectural-placement signal.
  if(context?.source!=='canonical')return {known:false,quiet:null,accessible:null,majorSetback:null};
  const centre=[(b.minX+b.maxX)/2,(b.minZ+b.maxZ)/2];let local=Infinity,major=Infinity;
  for(const e of context.roadEdges??[]) {
    if(!e?.a?.every(Number.isFinite)||!e?.b?.every(Number.isFinite))continue;
    const dx=e.b[0]-e.a[0],dz=e.b[1]-e.a[1],length=dx*dx+dz*dz;if(!length)continue;
    const t=clamp(((centre[0]-e.a[0])*dx+(centre[1]-e.a[1])*dz)/length,0,1);
    const distance=Math.max(0,Math.hypot(centre[0]-e.a[0]-dx*t,centre[1]-e.a[1]-dz*t)-(e.width??0)/2);
    const type=e.roadType??e.type;
    if(['motorway','trunk','primary','secondary'].includes(type))major=Math.min(major,distance);
    else if(['residential','living_street','service','unclassified','tertiary'].includes(type))local=Math.min(local,distance);
  }
  return {known:true,quiet:major>=35,accessible:local<100||major<80,majorSetback:Number.isFinite(major)?Math.round(major):null};
}
function neighborhood(features,context) {
  if(features.industrialShare>0.3)return 8;
  const institutions=context?.source==='canonical'?(context.pois??[]).filter(p=>institutional.has(p.category)).length:0;
  if(features.institutionalShare>0.25||institutions>=3)return 7;
  if(features.commercialShare>0.25)return 6;
  if(features.coverage>0.23||features.count>=100)return 0;
  if(features.count<=25&&features.medianArea>=260&&features.coverage<0.16)return 5;
  if(features.count<=45&&features.medianArea>=160&&features.coverage<0.22)return 4;
  if(features.medianArea>=130&&features.count<70)return 3;
  if(features.medianArea>=85&&features.count<90)return 2;
  return 1;
}

export function luxuryEligibility(b,features) {
  return b.category!=='residential_multi'&&!['apartments','terrace','semidetached_house'].includes(b.tags?.building)&&b.polygons.length===1&&
    features.area>=260&&features.area<=1200&&features.floors<=3&&aspect(b)<3&&
    features.spacing>=8&&features.coverage<0.23&&features.edgeClearance>=12&&b.minHeight===0&&
    features.road.quiet!==false&&features.road.accessible!==false;
}
function unitArchetype(area,seed) {
  if(area<25)return 0;
  if(area<38)return 1;
  if(area<52)return 2;
  if(area<68)return 3;
  if(area<94)return 4;
  return seed%3===0?4:5;
}
function residentialForm(b,f,tier,seed) {
  if(b.polygons.length>1||b.tags?.building==='apartments'||b.category==='residential_multi'||b.category==='mixed_use')return 6;
  if(b.tags?.building==='terrace')return 11;
  if(b.tags?.building==='semidetached_house')return 8;
  if(tier===5)return f.area>=520?15:14;
  if(tier===4)return f.floors>=2?13:f.compoundKnown?12:9;
  if(f.floors>=3)return 6;
  if(f.floors===2&&f.area>=110)return seed%3===0?6:10;
  if(tier>=3&&f.area>=145&&f.spacing>=5)return 9;
  if(f.area>=85&&f.floors===1)return tier<=1&&seed%3===0?1:7;
  return unitArchetype(f.usableArea,seed);
}
function unitCount(archetype,f,tier,seed) {
  const capacity=Math.max(1,Math.floor(f.usableArea/18));
  if([9,12,13,14,15].includes(archetype))return 1;
  if(archetype===10)return Math.min(capacity,seed%3===0?2:1);
  if(archetype===8)return Math.min(capacity,2);
  if(archetype===11)return Math.min(capacity,clamp(Math.floor(f.area/65),2,8));
  if(archetype===6)return Math.min(256,capacity,Math.max(2,Math.floor(f.usableArea/(tier<=1?40:70))));
  if(archetype===1&&f.usableArea>=65)return Math.min(8,capacity,Math.max(2,Math.floor(f.usableArea/30)));
  return 1;
}

function* residentialTileSteps(records,{region,tx=0,tz=0,tileSize=250,housingProfile={},context=null}={}) {
  if(!/^[a-z0-9-]+$/.test(region??''))throw new Error('Housing requires a stable region identity');
  const nearest=spacingIndex(records),areas=records.map(footprintArea);
  const ordered=areas.slice().sort((a,b)=>a-b),count=records.length;
  const features={count,coverage:areas.reduce((sum,n)=>sum+n,0)/(tileSize*tileSize),medianArea:ordered[Math.floor(count/2)]??0,
    industrialShare:records.filter(b=>b.categorySource==='explicit'&&industrial.has(b.category)).length/Math.max(1,count),
    institutionalShare:records.filter(b=>b.categorySource==='explicit'&&institutional.has(b.category)).length/Math.max(1,count),
    commercialShare:records.filter(b=>b.categorySource==='explicit'&&commercial.has(b.category)).length/Math.max(1,count)};
  const profile=neighborhood(features,context),weights=validWeights(housingProfile.tierWeights?.[NEIGHBORHOOD_PROFILES[profile]])?
    housingProfile.tierWeights[NEIGHBORHOOD_PROFILES[profile]]:TIER_WEIGHTS[profile];
  const metadata=new Map();
  for(let i=0;i<records.length;i++) {
    const b=records[i],area=areas[i],use=propertyUse(b,area),seed=housingSeed(region,b.id,housingProfile.seedSalt??'');
    if(!use){metadata.set(b.id,{version:HOUSING_VERSION,source:'cityverse_procedural',region,propertyUse:0,
      neighborhoodProfile:profile,qualityTier:null,residentialArchetype:null,estimatedUnits:0,starterCandidate:false});yield;continue;}
    const floors=interpretBuilding({...b,housing:undefined}).floors,occupiedFloors=use===2?Math.max(0,floors-1):floors;
    const f={...features,area,floors,usableArea:area*occupiedFloors*0.74,spacing:nearest(b),road:roadSignals(b,context),
      edgeClearance:Math.min(b.minX-tx*tileSize,(tx+1)*tileSize-b.maxX,b.minZ-tz*tileSize,(tz+1)*tileSize-b.maxZ),
      compoundKnown:Boolean(compoundTreatment(b))};
    const luxuryEligible=use===1&&luxuryEligibility(b,f);
    const premiumEligible=use===1&&area>=145&&area<=1200&&floors<=3&&f.spacing>=5&&f.edgeClearance>=8&&f.road.quiet!==false;
    let tier=selectWeighted(weights,seed);
    if(tier===5&&!luxuryEligible)tier=premiumEligible?4:3;
    if(tier===4&&!premiumEligible)tier=3;
    if(area<65)tier=Math.min(2,tier);
    const form=residentialForm(b,f,tier,seed),units=occupiedFloors&&f.usableArea>=18?unitCount(form,f,tier,seed):0;
    const dwelling=unitArchetype(units?f.usableArea/units:0,seed),rentBand=clamp(tier-(units>1?1:0),0,5);
    const compoundPotential=premiumEligible&&f.spacing>=5,parkingPotential=area>=100&&f.spacing>=5&&f.edgeClearance>=8;
    const starter=units>0&&tier<=1&&rentBand<=1&&dwelling<=4&&b.minHeight===0&&b.height>=2.8&&f.usableArea/units>=18&&f.road.accessible!==false;
    metadata.set(b.id,{version:HOUSING_VERSION,source:'cityverse_procedural',region,propertyUse:use,
      residentialArchetype:form,unitArchetype:units===1&&[7,8,9,10,11,12,13,14,15].includes(form)?form:dwelling,
      footprintArea:Math.round(area),
      qualityTier:tier,neighborhoodProfile:profile,estimatedUnits:units,estimatedUnitArea:Math.round(units?f.usableArea/units:0),
      rentBand,valueBand:clamp(tier+(area>=300&&units>1?1:0),0,5),finishQuality:clamp(tier+(fraction(seed,'finish')<0.22?-1:fraction(seed,'finish')>0.82?1:0),0,5),
      hasCompound:f.compoundKnown,hasParking:false,hasGate:false,compoundPotential,parkingPotential,gatePotential:compoundPotential&&tier>=3,
      luxuryEligible,starterCandidate:starter,interiorTemplateId:`housing-v1/${RESIDENTIAL_ARCHETYPES[form]}`,
      proceduralConfidence:b.categorySource==='explicit'?0.7:f.road.known?0.5:0.4,
      visualSeed:seed,contextSource:f.road.known?'canonical_context':'source_tile_geometry'});
    yield;
  }
  return {metadata,features,profile};
}

export function createResidentialTileMetadata(records,options) {
  const start=performance.now(),steps=residentialTileSteps(records,options);let result;
  do{result=steps.next();}while(!result.done);
  return {...result.value,buildMs:performance.now()-start};
}
export async function prepareResidentialTileMetadata(records,options) {
  const start=performance.now(),steps=residentialTileSteps(records,options);let result,workMs=0,sliceStart=start;
  do{
    const before=performance.now();result=steps.next();workMs+=performance.now()-before;
    if(!result.done&&performance.now()-sliceStart>=4){await new Promise(resolve=>setTimeout(resolve,0));sliceStart=performance.now();}
  }while(!result.done);
  return {...result.value,buildMs:workMs,elapsedMs:performance.now()-start};
}

// No tier/name labels are returned to Street World. These are future generation inputs,
// not permission to draw an inferred parcel, gate, driveway or parking space.
export function residentialStreetInputs(housing) {
  if(!housing||housing.propertyUse===0)return null;
  return {seed:housing.visualSeed,finish:housing.finishQuality,frontagePalette:housing.finishQuality>=3?'light_render':'muted_render',
    canopyProbability:[0.12,0.15,0.18,0.25,0.32,0.4][housing.finishQuality],
    landscapingPotential:housing.parkingPotential,parkingPotential:housing.parkingPotential,
    localBoundaryPotential:housing.compoundPotential,gatePotential:housing.gatePotential,
    requiresBoundaryData:!housing.hasCompound};
}
