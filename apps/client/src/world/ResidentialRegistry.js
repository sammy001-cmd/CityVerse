import {PROPERTY_USES,QUALITY_TIERS,RESIDENTIAL_ARCHETYPES,NEIGHBORHOOD_PROFILES,propertyUnitId,residentialStreetInputs} from './ResidentialMetadata.js';

// Loaded-world catalog only. No ownership, offers, prices, allocation or interiors.
export class ResidentialRegistry {
  constructor(){this.region=null;this.records=new Map();this.tileIds=new Map();}
  clear(region=null){this.region=region;this.records.clear();this.tileIds.clear();}
  removeTile(key){for(const id of this.tileIds.get(key)??[])this.records.delete(id);this.tileIds.delete(key);}
  installTile(key,records){
    this.removeTile(key);const ids=[];
    for(const b of records)if(b.housing){this.records.set(b.id,b);ids.push(b.id);}
    this.tileIds.set(key,ids);
  }
  getHousingMetadata(buildingId){return this.records.get(buildingId)?.housing??null;}
  getHousingTier(buildingId){return this.getHousingMetadata(buildingId)?.qualityTier??null;}
  getStreetInputs(buildingId){return residentialStreetInputs(this.getHousingMetadata(buildingId));}
  getPropertyUnits(buildingId){
    const housing=this.getHousingMetadata(buildingId);if(!housing)return [];
    return Array.from({length:housing.estimatedUnits},(_,index)=>this.unit(housing,buildingId,index));
  }
  unit(housing,buildingId,index){
    return {id:propertyUnitId(housing.region,buildingId,index),buildingId,region:housing.region,index,
      source:'cityverse_procedural',residentialArchetype:housing.unitArchetype,qualityTier:housing.qualityTier,
      rentBand:housing.rentBand,valueBand:housing.valueBand,estimatedArea:housing.estimatedUnitArea,
      interiorTemplateId:`housing-v1/${RESIDENTIAL_ARCHETYPES[housing.unitArchetype]}`,
      starterCandidate:housing.starterCandidate,state:'unassigned',availability:'unknown'};
  }
  getRentBand(unitId){
    if(typeof unitId!=='string')return null;
    const match=unitId.match(/^([a-z0-9-]+):((?:way|relation):\d+):unit:(0|[1-9]\d*)$/);
    if(!match)return null;
    const h=this.getHousingMetadata(match[2]),index=Number(match[3]);
    return h?.region===match[1]&&Number.isSafeInteger(index)&&index<h.estimatedUnits?h.rentBand:null;
  }
  getStarterHousingCandidates(region=this.region,{limit=128}={}){
    return this.candidates({region,maxRentBand:1,starterOnly:true,limit});
  }
  getRentalCandidates(bounds=null,{maxRentBand=5,limit=128}={}){
    return this.candidates({region:this.region,bounds,maxRentBand,limit});
  }
  candidates({region,bounds=null,maxRentBand=5,starterOnly=false,limit=128}){
    if(!Number.isFinite(limit)||limit<=0||!Number.isFinite(maxRentBand))return [];
    const result=[],cap=Math.min(4096,Math.floor(limit));
    // Stable ordering is independent of request completion/streaming insertion order.
    for(const b of [...this.records.values()].sort((a,c)=>a.id.localeCompare(c.id))) {
      const h=b.housing;
      if(h.region!==region||!h.estimatedUnits||h.rentBand>maxRentBand||starterOnly&&!h.starterCandidate)continue;
      if(bounds&&(b.maxX<bounds.minX||b.minX>bounds.maxX||b.maxZ<bounds.minZ||b.minZ>bounds.maxZ))continue;
      for(let i=0;i<h.estimatedUnits&&result.length<cap;i++)result.push(this.unit(h,b.id,i));
      if(result.length>=cap)break;
    }
    return result;
  }
  getStats(){
    const stats={region:this.region,scope:'loaded_buildings',buildings:this.records.size,residentialBuildings:0,mixedUseBuildings:0,
      estimatedResidentialUnits:0,multiUnitBuildings:0,starterCandidateBuildings:0,starterCandidateUnits:0,
      tiers:Object.fromEntries(QUALITY_TIERS.map(k=>[k,0])),archetypes:{},neighborhoods:{},
      largestBuilding:null,largestUnitCount:0,largestUnitBuilding:null};
    for(const b of this.records.values()) {
      const h=b.housing,profile=NEIGHBORHOOD_PROFILES[h.neighborhoodProfile];
      stats.neighborhoods[profile]=(stats.neighborhoods[profile]??0)+1;
      if(PROPERTY_USES[h.propertyUse]==='non_residential')continue;
      if(h.propertyUse===2)stats.mixedUseBuildings++;else stats.residentialBuildings++;
      stats.estimatedResidentialUnits+=h.estimatedUnits;
      stats.multiUnitBuildings+=Number(h.estimatedUnits>1);
      stats.starterCandidateBuildings+=Number(h.starterCandidate);
      if(h.starterCandidate)stats.starterCandidateUnits+=h.estimatedUnits;
      const tier=QUALITY_TIERS[h.qualityTier],form=RESIDENTIAL_ARCHETYPES[h.residentialArchetype];
      stats.tiers[tier]++;stats.archetypes[form]=(stats.archetypes[form]??0)+1;
      if(h.estimatedUnits>stats.largestUnitCount||h.estimatedUnits===stats.largestUnitCount&&h.estimatedUnits>0&&b.id<stats.largestUnitBuilding){stats.largestUnitCount=h.estimatedUnits;stats.largestUnitBuilding=b.id;}
      const area=h.footprintArea;
      if(!stats.largestBuilding||area>stats.largestBuilding.footprintArea||area===stats.largestBuilding.footprintArea&&b.id<stats.largestBuilding.id)
        stats.largestBuilding={id:b.id,footprintArea:area,units:h.estimatedUnits};
    }
    const total=stats.residentialBuildings+stats.mixedUseBuildings;
    stats.tierProportions=Object.fromEntries(Object.entries(stats.tiers).map(([k,n])=>[k,total?n/total:0]));
    return stats;
  }
}
