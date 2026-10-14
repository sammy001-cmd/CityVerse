// Area landmarks have no building row. Reuse the override registry with source
// geometry, while leaving ordinary building tile/collider ownership untouched.
export class LandmarkSites {
  get worldSurface(){return this._worldSurface;}
  set worldSurface(surface){this._worldSurface=surface;for(const id of this.loaded?.keys()??[])this.unload(id);}
  constructor({scene,registry,overrides,worldSurface,lowPerformance=false}){
    Object.assign(this,{scene,registry,overrides,worldSurface,lowPerformance});this.loaded=new Map();this.generationMs=0;
  }
  update(x,z){
    for(const identity of this.registry.all()){
      if(!identity.siteRings)continue;
      const distance=Math.hypot(x-identity.x,z-identity.z);
      const lod=distance>(this.lowPerformance?400:650)?'far':distance>180?'medium':'near';
      const active=distance<(this.lowPerformance?850:1100)&&this.worldSurface.coverageAt(identity.x,identity.z).valid;
      const old=this.loaded.get(identity.id);
      if(old&&(!active||old.userData.landmark.lod!==lod))this.unload(identity.id);
      if(!active||this.loaded.has(identity.id))continue;
      const start=performance.now();
      const object=this.overrides.create({id:identity.source.identity},{region:identity.region,lod,worldSurface:this.worldSurface});
      this.generationMs+=performance.now()-start;
      if(object){this.scene.add(object);this.loaded.set(identity.id,object);}
    }
  }
  unload(id){const object=this.loaded.get(id);if(!object)return;this.scene.remove(object);const materials=new Set();object.traverse(o=>{o.geometry?.dispose();if(o.material)materials.add(o.material);});for(const m of materials)m.dispose();this.loaded.delete(id);}
  dispose(){for(const id of this.loaded.keys())this.unload(id);}
}
