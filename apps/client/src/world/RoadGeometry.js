import * as THREE from 'three';
import { roadClass } from './RoadClasses.js';

function batch() { return {positions:[],uvs:[],colors:[],roads:[]}; }
function triangle(out,a,b,c,metadata,color) {
  out.positions.push(...a.position,...b.position,...c.position);
  out.uvs.push(...a.uv,...b.uv,...c.uv); out.roads.push(metadata);
  for(let i=0;i<3;i++) out.colors.push(color.r,color.g,color.b);
}
function quad(out,a,b,c,d,metadata,color) {
  const cross=(b.position[0]-a.position[0])*(c.position[2]-a.position[2])-(b.position[2]-a.position[2])*(c.position[0]-a.position[0]);
  if(cross>0) { triangle(out,a,c,b,metadata,color); triangle(out,a,d,c,metadata,color); }
  else { triangle(out,a,b,c,metadata,color); triangle(out,a,c,d,metadata,color); }
}
function geometry(out) {
  if(!out.positions.length) return null;
  const result=new THREE.BufferGeometry();
  result.setAttribute('position',new THREE.Float32BufferAttribute(out.positions,3));
  result.setAttribute('uv',new THREE.Float32BufferAttribute(out.uvs,2));
  result.setAttribute('color',new THREE.Float32BufferAttribute(out.colors,3));
  result.userData.surfaceRoads=out.roads; result.computeVertexNormals(); return result;
}
function endpointOffset(road,start,roadsByWay) {
  const dx=road.b[0]-road.a[0],dz=road.b[1]-road.a[1],length=Math.hypot(dx,dz);
  const ux=dx/length,uz=dz/length,point=start ? road.a : road.b;
  const other=(roadsByWay.get(road.wayId) ?? []).find((candidate) => candidate!==road &&
    Math.hypot((start ? candidate.b : candidate.a)[0]-point[0],(start ? candidate.b : candidate.a)[1]-point[1])<0.05);
  if(!other) return [-uz,ux];
  const ox=other.b[0]-other.a[0],oz=other.b[1]-other.a[1],ol=Math.hypot(ox,oz);
  const tx=ux+ox/ol,tz=uz+oz/ol,tl=Math.hypot(tx,tz);
  if(tl<1e-6) return [-uz,ux];
  const nx=-tz/tl,nz=tx/tl,denominator=-nx*uz+nz*ux;
  if(Math.abs(denominator)<0.4) return [-uz,ux];
  return [nx/denominator,nz/denominator];
}

export class RoadGeometry {
  constructor({surface,roadOffset=0.055,crownHeight=0.015,maxProfileSegmentLength=2,lowPerformance=false}) {
    Object.assign(this,{surface,roadOffset,crownHeight,maxProfileSegmentLength,lowPerformance});
  }
  build(roads) {
    const batches={asphalt:batch(),shoulders:batch(),blend:batch(),curbs:batch(),sidewalks:batch(),markings:batch()};
    const roadsByWay=new Map(),edges=[];
    for(const road of this.connectedRoads ?? roads) { if(!roadsByWay.has(road.wayId)) roadsByWay.set(road.wayId,[]); roadsByWay.get(road.wayId).push(road); }
    for(const road of roads) {
      const style=roadClass(road),half=style.width/2;
      const dx=road.b[0]-road.a[0],dz=road.b[1]-road.a[1],length=Math.hypot(dx,dz);
      if(length<0.05) continue;
      const normal=[-dz/length,dx/length];
      const profile=this.surface.profileFor(road) ?? this.surface.prepareRoad(road);
      const metadata={wayId:road.wayId,type:road.type};
      const asphalt=new THREE.Color(style.asphaltColor),shoulder=new THREE.Color('#746d60');
      const terrainColor=new THREE.Color('#ffffff'),concrete=new THREE.Color('#aba698'),paint=new THREE.Color('#e9e1c3');
      const segments=Math.max(1,Math.ceil(length/this.maxProfileSegmentLength));
      const startOffset=endpointOffset(road,true,roadsByWay),endOffset=endpointOffset(road,false,roadsByWay);
      const heights=new Map();
      const edge=half+style.shoulder,walkEdge=edge+style.sidewalkWidth,outer=walkEdge+style.blend;
      const point=(t,lateral,level='road') => {
        const offset=t===0 ? startOffset : t===1 ? endOffset : normal;
        const x=road.a[0]+dx*t+offset[0]*lateral,z=road.a[1]+dz*t+offset[1]*lateral;
        if(!heights.has(t)) heights.set(t,this.surface.profileHeight(profile,t)+this.roadOffset);
        const base=heights.get(t);
        let y=base+this.crownHeight*Math.max(0,1-Math.abs(lateral)/half);
        if(level==='walk') y=base+style.curbHeight;
        if(level==='outer') y=this.surface.terrainY(x,z);
        return {position:[x,y,z],uv:[t*length/4,lateral/Math.max(style.width,1)]};
      };
      const strip=(out,t0,t1,l0,l1,level,color) => quad(out,point(t0,l0,level),point(t0,l1,level),point(t1,l1,level),point(t1,l0,level),metadata,color);
      for(let i=0;i<segments;i++) {
        const t0=i/segments,t1=(i+1)/segments;
        strip(batches.asphalt,t0,t1,-half,0,'road',asphalt); strip(batches.asphalt,t0,t1,0,half,'road',asphalt);
        for(const side of [-1,1]) {
          strip(batches.shoulders,t0,t1,side*half,side*edge,'road',shoulder);
          const sidewalkSide=style.sidewalk && (road.sidewalk!=='left' && road.sidewalk!=='right' ||
            road.sidewalk==='left' && side===1 || road.sidewalk==='right' && side===-1);
          const end=sidewalkSide ? walkEdge : edge;
          if(sidewalkSide) {
            quad(batches.curbs,point(t0,side*edge),point(t0,side*edge,'walk'),point(t1,side*edge,'walk'),point(t1,side*edge),metadata,concrete);
            strip(batches.sidewalks,t0,t1,side*edge,side*walkEdge,'walk',concrete);
          }
          // Sloped earth connects an engineered edge to unchanged terrain.
          const outside=end+style.blend;
          quad(batches.blend,point(t0,side*end,sidewalkSide ? 'walk' : 'road'),point(t0,side*outside,'outer'),
            point(t1,side*outside,'outer'),point(t1,side*end,sidewalkSide ? 'walk' : 'road'),metadata,terrainColor);
        }
      }
      const mark=(lateral,start,end,width=0.1) => {
        // Split at profile sections so paint never bridges a hill as a flat quad.
        const breaks=[start,...Array.from({length:segments-1},(_,i) => (i+1)*length/segments).filter((d) => d>start && d<end),end];
        for(let i=0;i<breaks.length-1;i++) {
          const a=point(breaks[i]/length,lateral-width/2),b=point(breaks[i]/length,lateral+width/2);
          const c=point(breaks[i+1]/length,lateral+width/2),d=point(breaks[i+1]/length,lateral-width/2);
          for(const p of [a,b,c,d]) p.position[1]+=0.008;
          quad(batches.markings,a,b,c,d,metadata,paint);
        }
      };
      // Dash phase follows projected centerline distance rather than segment seq.
      const phase=((road.a[0]*dx/length+road.a[1]*dz/length)%8+8)%8;
      if(style.center==='solid') mark(0,0,length);
      if(style.center==='broken') for(let start=-phase;start<length;start+=8) {
        const a=Math.max(0,start),b=Math.min(length,start+3); if(b>a) mark(0,a,b);
      }
      if(style.edge && !this.lowPerformance) { mark(-half+0.18,0,length,0.12); mark(half-0.18,0,length,0.12); }
      edges.push({roadId:road.wayId,sequence:road.seq,type:road.type,width:style.width,laneWidth:style.laneWidth,
        shoulderWidth:style.shoulder,sidewalkWidth:style.sidewalkWidth,curbHeight:style.curbHeight,
        a:road.a.slice(),b:road.b.slice(),left:normal,right:normal.map((v) => -v),
        sections:Array.from({length:segments+1},(_,i) => {
          const t=i/segments; return {t,left:point(t,half).position,right:point(t,-half).position,
            setbackLeft:point(t,outer,'outer').position,setbackRight:point(t,-outer,'outer').position};
        })});
    }
    return {...Object.fromEntries(Object.entries(batches).map(([key,value]) => [key,geometry(value)])),edges};
  }
}
