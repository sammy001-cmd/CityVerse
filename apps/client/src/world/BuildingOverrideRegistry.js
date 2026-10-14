// Empty hook. No landmarks or models are registered by this phase.
export class BuildingOverrideRegistry {
  constructor(){this.entries=new Map();this.version=0;}
  register(osmId,factory){if(!/^(way|relation):\d+$/.test(osmId)||typeof factory!=='function')throw new Error('Override requires a full OSM ID and factory');this.entries.set(osmId,factory);this.version++;return ()=>this.unregister(osmId);}
  unregister(osmId){if(this.entries.delete(osmId))this.version++;}
  has(osmId){return this.entries.has(osmId);}
  create(record,context){return this.entries.get(record.id)?.(record,context)??null;}
}
