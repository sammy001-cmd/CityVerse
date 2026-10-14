import { landmarkIdentity } from './LandmarkIdentity.js';
export class LandmarkRegistry {
  constructor(){this.records=new Map();this.region=null;}
  install(region,records){this.records.clear();this.region=region;for(const p of records){if(p.region!==region||!p.id||!p.name||!Number.isFinite(p.x)||!Number.isFinite(p.z)||p.source?.provider!=='OpenStreetMap'&&!p.source?.verified)continue;this.records.set(p.id,{...p,modelOverrideId:p.modelOverrideId??null,labelPriority:p.labelPriority??p.importance??1});}}
  all(){return [...this.records.values()].map(landmarkIdentity);}
  get(id){const record=this.records.get(id);return record?landmarkIdentity(record):null;}
  clear(){this.records.clear();this.region=null;}
}
