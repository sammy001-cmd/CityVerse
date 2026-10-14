import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {generateStreetCellAsync,streetLOD,wireLinks} from './StreetWorldRules.js';
const yieldFrame=()=>new Promise(r=>typeof requestAnimationFrame==='function'?requestAnimationFrame(r):setTimeout(r,0));
const box=(w,h,d,x=0,y=h/2,z=0)=>new THREE.BoxGeometry(w,h,d).translate(x,y,z);
const cylinder=(r,h,y=h/2)=>new THREE.CylinderGeometry(r*0.75,r,h,6).translate(0,y,0);
export class StreetWorldSystem {
  constructor({scene,roadSystem,buildingSystem,worldSurface,physics=null,lowPerformance=false,stops=[],onProgress=null}){
    Object.assign(this,{scene,roadSystem,buildingSystem,worldSurface,physics,stops,onProgress});
    this.low=lowPerformance;this.radius=this.low?1:2;this.cacheLimit=this.low?16:32;
    this.loaded=new Map();this.cache=new Map();this.colliders=new Map();this.region=null;this.epoch=0;this.revision=null;
    this.inputVersion=0;
    this.metrics={generationMs:0,generationPeakMs:0,jobs:0,bakeMs:0,bakePeakMs:0,generationSlicePeakMs:0};
    this.material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.95});
    this.surfaceMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide});
    this.wireMaterial=new THREE.LineBasicMaterial({color:0x262b29});
    this.labelTexture=null;this.labelMaterial=new THREE.MeshBasicMaterial({transparent:true,side:THREE.DoubleSide});
    this.assets={pole:mergeGeometries([cylinder(0.16,8),box(1.8,0.1,0.12,0,7.4)]),
      light:mergeGeometries([cylinder(0.1,6.5),box(1.25,0.08,0.08,0.6,6.2),box(0.5,0.13,0.28,1.1,6.15)]),
      trunk:cylinder(0.21,3),tree:new THREE.IcosahedronGeometry(1.65,this.low?0:1).scale(1,0.9,1).translate(0,4.1,0),
      palm:mergeGeometries([cylinder(0.17,5.4),new THREE.ConeGeometry(1.7,0.6,6).translate(0,5.7,0)]),
      shrub:new THREE.IcosahedronGeometry(0.65,0).scale(1,0.6,1).translate(0,0.35,0),
      sign:mergeGeometries([cylinder(0.05,2.7),box(1.6,0.48,0.07,0,2.4)]),
      regulatory:mergeGeometries([cylinder(0.05,2.5),new THREE.CylinderGeometry(0.28,0.28,0.06,8).rotateX(Math.PI/2).translate(0,2.3,0)]),
      direction:mergeGeometries([cylinder(0.05,2.7),box(1.35,0.38,0.07,0,2.4),new THREE.ConeGeometry(0.26,0.35,3).rotateZ(-Math.PI/2).scale(1,1,0.15).translate(0.8,2.4,0)]),
      bench:mergeGeometries([box(1.7,0.12,0.48,0,0.5),box(1.7,0.5,0.09,0,0.86,0.23),box(0.1,0.5,0.4,-0.6),box(0.1,0.5,0.4,0.6)]),
      bin:box(0.42,0.72,0.42),shelter:mergeGeometries([box(3.5,0.15,2,0,2.7),box(0.12,2.7,0.12,-1.5,1.35,-0.7),box(0.12,2.7,0.12,1.5,1.35,-0.7),box(2.5,0.15,0.6,0,0.5)]),
      gate:box(2.4,1.4,0.1),wall:box(0.14,1,1),bollard:cylinder(0.085,0.8),planter:box(0.8,0.45,0.8),
      barrier:mergeGeometries([box(1.5,0.12,0.12,0,1),cylinder(0.055,1.05).translate(-0.6,0,0),cylinder(0.055,1.05).translate(0.6,0,0)]),
      awning:box(2,0.12,1.1,0,2.3)};
    this.meshes=new Map();this.group=new THREE.Group();this.group.name='StreetWorld';scene.add(this.group);
  }
  inputs(){
    const names=new Map([...this.roadSystem.tileData.values()].flatMap(t=>t.roads.filter(r=>r.name).map(r=>[r.wayId,r.name])));
    return {edges:this.roadSystem.getRoadEdges().map(e=>({...e,name:names.get(e.roadId)??null})),
      buildings:this.buildingSystem.getBuildings().map(b=>({...b,streetContext:this.buildingSystem.housing?.getStreetInputs(b.id)})),junctions:[...this.roadSystem.tileData.values()].flatMap(t=>t.junctions??[])};
  }
  update(x,z){
    if(this.disposed)return Promise.resolve();this.next=[x,z];
    this.transitFeed?.update(x,z)?.catch(error=>console.warn('Optional source transit data unavailable:',error));
    if(this.running)return this.running;
    this.running=this.drain().finally(()=>{this.running=null;});return this.running;
  }
  async drain(){
    while(this.next&&!this.disposed){const [x,z]=this.next;this.next=null;
      const region=this.buildingSystem.region;if(!region||this.buildingSystem.manifest===null)return;
      if(region!==this.region){this.clear();this.region=region;}
      const cx=Math.floor(x/250),cz=Math.floor(z/250),revision=[...this.roadSystem.loaded].map(([k,g])=>`${k}:${g.uuid}`).join('|')+';'+[...this.buildingSystem.loaded].map(([k,t])=>`${k}:${t.records.length}:${t.conflicts.length}`).join('|')+':'+this.inputVersion;
      const stamp=`${region}:${Math.floor(x/30)}:${Math.floor(z/30)}:${revision}`;if(stamp===this.lastStamp)return;this.lastStamp=stamp;
      const input=this.inputs(),wanted=[];
      for(let u=cx-this.radius;u<=cx+this.radius;u++)for(let v=cz-this.radius;v<=cz+this.radius;v++){
        const key=`${u}_${v}`;if(this.buildingSystem.available.has(key)&&!this.buildingSystem.loaded.has(key))continue;
        const distance=Math.hypot(Math.max(u*250-x,0,x-(u+1)*250),Math.max(v*250-z,0,z-(v+1)*250));
        wanted.push({key,distance,lod:streetLOD(distance,this.low,this.loaded.get(key)?.lod)});
      }
      const keys=new Set(wanted.map(t=>t.key));for(const key of this.loaded.keys())if(!keys.has(key))this.loaded.delete(key);
      wanted.sort((a,b)=>a.distance-b.distance||a.key.localeCompare(b.key));
      const epoch=this.epoch;
      for(const cell of wanted){
        if(this.disposed||epoch!==this.epoch)return;
        const cacheKey=`${region}:${cell.key}:${cell.lod}:${revision}`;
        if(this.loaded.get(cell.key)?.cacheKey===cacheKey)continue;
        let data=this.cache.get(cacheKey);
        if(!data){
          const [u,v]=cell.key.split('_').map(Number),bounds={minX:u*250-12,maxX:(u+1)*250+12,minZ:v*250-12,maxZ:(v+1)*250+12};
          const intersects=b=>b.maxX>=bounds.minX&&b.minX<=bounds.maxX&&b.maxZ>=bounds.minZ&&b.minZ<=bounds.maxZ;
          data=await generateStreetCellAsync({region,key:cell.key,lod:cell.lod,low:this.low,worldSurface:this.worldSurface,
            edges:input.edges.filter(e=>intersects({minX:Math.min(...[e.a[0],e.b[0]]),maxX:Math.max(e.a[0],e.b[0]),minZ:Math.min(e.a[1],e.b[1]),maxZ:Math.max(e.a[1],e.b[1])})),
            buildings:input.buildings.filter(intersects),junctions:input.junctions,stops:this.stops},yieldFrame);
          await this.prepareSurface(data);
          if(this.disposed||epoch!==this.epoch)return;
          this.cache.set(cacheKey,data);while(this.cache.size>this.cacheLimit)this.cache.delete(this.cache.keys().next().value);
          const ms=data.generationWorkMs+data.surfaceWorkMs;this.metrics.generationSlicePeakMs=Math.max(this.metrics.generationSlicePeakMs,data.generationSlicePeakMs,data.surfaceSlicePeakMs);this.metrics.generationMs+=ms;this.metrics.generationPeakMs=Math.max(this.metrics.generationPeakMs,ms);this.metrics.jobs++;
        }
        this.loaded.set(cell.key,{...data,cacheKey});await this.bake(x,z);this.onProgress?.('street-first-cell');await yieldFrame();
      }
      await this.bake(x,z);
    }
  }
  async bake(x,z){
    const epoch=this.epoch;
    let workMs=0,sliceStart=performance.now(),slicePeakMs=0,sliceWorkMs=0;
    const checkpoint=()=>{const ms=performance.now()-sliceStart;workMs+=ms;sliceWorkMs+=ms;slicePeakMs=Math.max(slicePeakMs,sliceWorkMs);if(sliceWorkMs>=4){sliceWorkMs=0;return yieldFrame();}return null;};
    const near=this.low?65:120,medium=this.low?220:380;
    const items=[...this.loaded.values()].flatMap(c=>c.items).filter(p=>{
      const d=Math.hypot(p.x-x,p.z-z);
      if(['pole','light'].includes(p.kind))return d<medium||p.majorContext;
      if(['tree','palm','shrub'].includes(p.kind))return d<medium;
      return d<near;
    }),poles=items.filter(i=>i.kind==='pole'&&Math.hypot(i.x-x,i.z-z)<near);
    this.activeItems=items;
    const kinds={pole:[],light:[],trunk:[],tree:[],palm:[],shrub:[],sign:[],regulatory:[],direction:[],bench:[],bin:[],shelter:[],gate:[],wall:[],bollard:[],barrier:[],planter:[],awning:[]};
    for(const item of items){if(item.kind==='tree'){kinds.trunk.push(item);kinds.tree.push(item);}else kinds[item.kind]?.push(item);if(item.kind==='planter')kinds.shrub.push({...item,y:item.y+0.45});}
    const dummy=new THREE.Object3D(),color=new THREE.Color(),colors={pole:0x777468,light:0x929a91,trunk:0x65543d,tree:0x536b43,palm:0x60754a,shrub:0x657949,sign:0x6f847d,regulatory:0xc4c7ba,direction:0x7a8b81,bench:0x857765,bin:0x5e766d,shelter:0x777e76,gate:0x717c73,wall:0xb0a58b,bollard:0x727d74,barrier:0x8b9385,planter:0xa99d84,awning:0x788977};
    for(const [kind,list] of Object.entries(kinds)){
      let mesh=this.meshes.get(kind);
      if(!mesh||mesh.instanceMatrix.count<list.length){if(mesh){this.group.remove(mesh);mesh.dispose();}mesh=new THREE.InstancedMesh(this.assets[kind],this.material,Math.max(16,list.length*2));mesh.castShadow=!this.low;mesh.receiveShadow=true;this.group.add(mesh);this.meshes.set(kind,mesh);}
      mesh.count=list.length;mesh.visible=list.length>0;
      list.forEach((p,i)=>{dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(0,p.angle??0,0);dummy.scale.setScalar(p.scale??1);if(kind==='wall')dummy.scale.set(1,p.height,p.length);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);mesh.setColorAt(i,color.setHex(colors[kind]));});
      mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();
      {const pause=checkpoint();if(pause)await pause;sliceStart=performance.now();}
      if(this.disposed||epoch!==this.epoch)return;
    }
    const position=[],tints=[];
    for(const cell of this.loaded.values()){position.push(...cell.surfacePosition);tints.push(...cell.surfaceColor);}
    this.replaceGeometry('surface',position,this.surfaceMaterial,tints);{const pause=checkpoint();if(pause)await pause;sliceStart=performance.now();}
    if(this.disposed||epoch!==this.epoch)return;
    const wires=wireLinks(poles,this.low);this.replaceGeometry('wires',wires,this.wireMaterial,null,true);
    this.updateLabels(items.filter(i=>i.label));{const pause=checkpoint();if(pause)await pause;sliceStart=performance.now();}
    if(this.disposed||epoch!==this.epoch)return;
    const wanted=new Map();
    if(this.physics?.createStreetCollider)for(const p of items)if(['pole','light','shelter','gate','wall','barrier','bollard'].includes(p.kind)&&Math.hypot(p.x-x,p.z-z)<(this.low?35:60)){
      const key=`${this.region}:${p.kind}:${p.x.toFixed(2)}:${p.z.toFixed(2)}`;wanted.set(key,p);
      if(!this.colliders.has(key))this.colliders.set(key,{collider:this.physics.createStreetCollider(p),item:p});
    }
    for(const [key,value] of this.colliders)if(!wanted.has(key)){for(const collider of [value.collider].flat())this.physics.world.removeCollider(collider,true);this.colliders.delete(key);}
    {const pause=checkpoint();if(pause)await pause;sliceStart=performance.now();}this.metrics.bakeMs+=workMs;this.metrics.bakePeakMs=Math.max(this.metrics.bakePeakMs,slicePeakMs);
  }
  async prepareSurface(cell){
    const position=[],tints=[];let workMs=0,sliceStart=performance.now(),slicePeakMs=0;
    const tri=(a,b,c,hex)=>{position.push(...a,...b,...c);const color=new THREE.Color(hex);for(let i=0;i<3;i++)tints.push(color.r,color.g,color.b);};
    const quad=(a,b,c,d,hex)=>{tri(a,c,b,hex);tri(a,d,c,hex);};
    for(const strip of cell.strips){
      if(performance.now()-sliceStart>=4){const ms=performance.now()-sliceStart;workMs+=ms;slicePeakMs=Math.max(slicePeakMs,ms);await yieldFrame();sliceStart=performance.now();}
      const [a,b]=[strip.a,strip.b],dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);if(!length)continue;
      const P=(p,offset,lift)=>{const px=p[0]-dz/length*offset,pz=p[2]+dx/length*offset;return [px,this.worldSurface.heightAt(px,pz)+lift,pz];};
      const w=strip.width/2,colour=strip.kind==='verge'?0x737e59:strip.kind==='driveway'?0xa39f90:strip.kind==='walkway'?(strip.variant==='concrete'?0x9b9c8e:0x9b8665):strip.variant==='earth'?0x82725b:0x66736d;
      quad(P(a,-w,0.03),P(b,-w,0.03),P(b,w,0.03),P(a,w,0.03),colour);
      if(strip.kind==='drain'&&strip.variant==='open_concrete'&&!this.low)for(const side of [-1,1])quad(P(a,side*w,0.04),P(b,side*w,0.04),P(b,side*w,0.16),P(a,side*w,0.16),0x9b9f94);
    }
    const ms=performance.now()-sliceStart;cell.surfaceWorkMs=workMs+ms;cell.surfaceSlicePeakMs=Math.max(slicePeakMs,ms);
    cell.surfacePosition=position;cell.surfaceColor=tints;
  }
  updateLabels(items){
    if(typeof document==='undefined'||!items.length){const old=this.meshes.get('labels');if(old)old.visible=false;return;}
    const names=[...new Set(items.map(i=>i.label))].sort(),signature=names.join('|');
    if(signature!==this.labelNames){this.labelNames=signature;const canvas=document.createElement('canvas');canvas.width=512;canvas.height=Math.max(64,names.length*64);const c=canvas.getContext('2d');c.fillStyle='#344e49';c.fillRect(0,0,canvas.width,canvas.height);c.fillStyle='#eceade';c.font='bold 24px sans-serif';c.textAlign='center';names.forEach((n,i)=>c.fillText(n,256,i*64+40,490));this.labelTexture?.dispose();this.labelTexture=new THREE.CanvasTexture(canvas);this.labelTexture.colorSpace=THREE.SRGBColorSpace;this.labelMaterial.map=this.labelTexture;this.labelMaterial.needsUpdate=true;}
    const positions=[],uv=[],v=new THREE.Vector3();
    for(const p of items){const row=names.indexOf(p.label),top=1-row/names.length,bottom=1-(row+1)/names.length;
      const points=[[-0.77,2.18,0.045],[0.77,2.18,0.045],[0.77,2.62,0.045],[-0.77,2.62,0.045]].map(q=>{v.set(...q).applyAxisAngle(new THREE.Vector3(0,1,0),p.angle??0).add(new THREE.Vector3(p.x,p.y,p.z));return v.toArray();});
      positions.push(...points[0],...points[1],...points[2],...points[0],...points[2],...points[3]);uv.push(0,bottom,1,bottom,1,top,0,bottom,1,top,0,top);
    }
    const mesh=this.replaceGeometry('labels',positions,this.labelMaterial);mesh.geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  }
  replaceGeometry(key,positions,material,colors=null,lines=false){
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));if(colors)geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));if(!lines)geometry.computeVertexNormals();geometry.computeBoundingSphere();
    let mesh=this.meshes.get(key);if(mesh){mesh.geometry.dispose();mesh.geometry=geometry;}else{mesh=lines?new THREE.LineSegments(geometry,material):new THREE.Mesh(geometry,material);this.meshes.set(key,mesh);this.group.add(mesh);}mesh.visible=positions.length>0;return mesh;
  }
  blockedPoint(x,z,y=null){return [...this.colliders.values()].some(({item:p})=>{const dx=x-p.x,dz=z-p.z,c=Math.cos(p.angle??0),s=Math.sin(p.angle??0);
    const height=p.kind==='pole'?8:p.kind==='light'?6.5:p.kind==='bollard'?0.8:p.kind==='barrier'?1.05:p.kind==='wall'?p.height:p.kind==='gate'?1.4:2.8;if(y!==null&&y>p.y+height)return false;
    if(p.kind==='wall')return Math.abs(c*dx-s*dz)<0.08&&Math.abs(s*dx+c*dz)<p.length/2;
    if(p.kind==='gate')return Math.abs(c*dx-s*dz)<1.2&&Math.abs(s*dx+c*dz)<0.08;
    if(p.kind==='barrier')return Math.abs(c*dx-s*dz)<0.75&&Math.abs(s*dx+c*dz)<0.09;
    if(p.kind==='shelter')return [-1.5,1.5].some(px=>Math.hypot(c*dx-s*dz-px,s*dx+c*dz+0.7)<0.1);
    if(p.kind==='bollard')return Math.hypot(dx,dz)<0.1;
    return Math.hypot(dx,dz)<(['pole','light'].includes(p.kind)?0.18:p.radius);});}
  getStats(camera=null){
    const items=this.activeItems??[],counts={};for(const p of items)counts[p.kind]=(counts[p.kind]??0)+1;
    let triangles=0,drawCalls=0;const frustum=camera?new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)):null;
    for(const mesh of this.meshes.values())if(mesh.visible&&(!frustum||frustum.intersectsObject(mesh))){drawCalls++;if(!mesh.isLineSegments)triangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3*(mesh.isInstancedMesh?mesh.count:1);}
    return {region:this.region,cells:this.loaded.size,cache:this.cache.size,poles:counts.pole??0,lights:counts.light??0,trees:(counts.tree??0)+(counts.palm??0),shrubs:counts.shrub??0,signs:(counts.sign??0)+(counts.regulatory??0)+(counts.direction??0),walls:counts.wall??0,
      shelters:counts.shelter??0,frontage:items.filter(p=>p.frontage).length,gates:counts.gate??0,bollards:counts.bollard??0,barriers:counts.barrier??0,planters:counts.planter??0,awnings:counts.awning??0,wireSegments:(this.meshes.get('wires')?.geometry.attributes.position.count??0)/2,
      drainMetres:[...this.loaded.values()].reduce((sum,c)=>sum+c.drainMetres,0),triangles,drawCalls,colliders:[...this.colliders.values()].reduce((n,v)=>n+[v.collider].flat().length,0),
      generationAverageMs:this.metrics.generationMs/(this.metrics.jobs||1),generationPeakMs:this.metrics.generationPeakMs,bakePeakMs:this.metrics.bakePeakMs,generationSlicePeakMs:this.metrics.generationSlicePeakMs};
  }
  invalidate(){this.inputVersion++;this.cache.clear();this.lastStamp=null;}
  setTransitStops(stops){this.stops=stops.filter(p=>p.id&&['osm','public_transport'].includes(p.source)&&Number.isFinite(p.x)&&Number.isFinite(p.z));this.invalidate();}
  clear(){this.epoch++;this.activeItems=[];this.loaded.clear();this.cache.clear();this.lastStamp=null;for(const v of this.colliders.values())for(const collider of [v.collider].flat())this.physics?.world.removeCollider(collider,true);this.colliders.clear();for(const m of this.meshes.values())m.visible=false;}
  dispose(){this.disposed=true;this.clear();this.scene.remove(this.group);for(const [key,m] of this.meshes)if(!this.assets[key])m.geometry.dispose();for(const g of Object.values(this.assets))g.dispose();this.material.dispose();this.surfaceMaterial.dispose();this.wireMaterial.dispose();this.labelMaterial.dispose();this.labelTexture?.dispose();}
}
