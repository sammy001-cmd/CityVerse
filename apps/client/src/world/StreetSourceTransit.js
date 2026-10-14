import {POIManager} from '../navigation/POIManager.js';

// The existing POI export omits raw stop tags. Only explicit stop kinds or a
// source-named bus/taxi stop qualify; rail stations and motor parks do not.
export function sourceTransitStops(pois,region){
  return pois.filter(p=>p.category==='transport'&&p.source?.provider==='OpenStreetMap'&&
    (['bus_stop','taxi_stop','platform'].includes(p.transportKind)||/\b(bus|taxi) stop\b/i.test(p.name??'')))
    .map(p=>({id:p.id,x:p.x,z:p.z,source:'osm',region}));
}
export class StreetSourceTransit {
  constructor(system){this.system=system;this.pois=new POIManager({maxTiles:16,concurrency:2});}
  async update(x,z){
    const key=`${this.system.region}:${Math.floor(x/250)}:${Math.floor(z/250)}`;
    if(key===this.key||this.running)return;this.key=key;
    this.running=(async()=>{
      await this.pois.init();
      const origin=this.system.buildingSystem.manifest?.projection?.origin;
      if(!origin||origin.lat!==this.pois.manifest.center?.lat||origin.lon!==this.pois.manifest.center?.lon)return;
      const region=this.system.region,r=this.system.low?250:500;
      await this.pois.loadVisible({minX:x-r,maxX:x+r,minZ:z-r,maxZ:z+r});
      if(region===this.system.region)this.system.setTransitStops(sourceTransitStops(this.pois.all(),region));
    })().finally(()=>{this.running=null;});return this.running;
  }
}
