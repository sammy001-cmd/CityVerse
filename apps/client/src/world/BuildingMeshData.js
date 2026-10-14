// Pure numeric preparation. Safe in workers: no Three.js objects, scenes or materials.
import earcut from 'three/src/extras/lib/earcut.js';
import {interpretBuilding,facadeEdges,entranceFacade,windowLayout,signedArea,compoundTreatment} from './BuildingArchitecture.js';

const linear=c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;
const colors=new Map();
function rgb(hex){if(!colors.has(hex))colors.set(hex,[linear((hex>>>16&255)/255),linear((hex>>>8&255)/255),linear((hex&255)/255)]);return colors.get(hex);}
export function createBuildingBuilder(options={}) {
  return {options,batches:[{position:[],normal:[],color:[]},{position:[],normal:[],color:[]}],
    stats:{lodCounts:{far:0,medium:0,near:0},archetypes:{},wallTriangles:0,roofTriangles:0,windowTriangles:0,detailTriangles:0,
      nearDetailTriangles:0,foundations:0,roadFacingEntrances:0,entrances:0,windows:0,balconies:0,verandas:0,compounds:0,roofFallbacks:0,malformedGeometry:0}};
}
function tri(builder,batch,part,a,b,c,color,up=false) {
  let ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
  let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,n=Math.hypot(nx,ny,nz);if(!Number.isFinite(n)||n<1e-7)return;
  if(up&&ny<0){[b,c]=[c,b];nx=-nx;ny=-ny;nz=-nz;}
  const target=builder.batches[batch],tint=rgb(color);target.position.push(...a,...b,...c);
  for(let i=0;i<3;i++){target.normal.push(nx/n,ny/n,nz/n);target.color.push(...tint);}
  builder.stats[`${part}Triangles`]++;
  if(builder.currentLOD==='near'&&['window','detail'].includes(part))builder.stats.nearDetailTriangles++;
}
function quad(builder,batch,part,a,b,c,d,color,up=false){tri(builder,batch,part,a,b,c,color,up);tri(builder,batch,part,a,c,d,color,up);}
function cap(builder,rings,height,color,batch=1,part='roof') {
  const points=rings.flat(),holes=[];let offset=rings[0].length;
  for(const ring of rings.slice(1)){holes.push(offset);offset+=ring.length;}
  const indices=earcut(points.flat(),holes,2);if(!indices.length)throw new Error('Cannot triangulate building roof');
  for(let i=0;i<indices.length;i+=3)tri(builder,batch,part,...indices.slice(i,i+3).map(j=>[points[j][0],height,points[j][1]]),color,true);
}
function rectangle(rings) {
  if(rings.length!==1||rings[0].length!==4)return null;
  const [a,b,c,d]=rings[0],u=[b[0]-a[0],b[1]-a[1]],v=[d[0]-a[0],d[1]-a[1]],du=Math.hypot(...u),dv=Math.hypot(...v);
  if(du<1||dv<1||Math.abs((u[0]*v[0]+u[1]*v[1])/(du*dv))>0.07||Math.hypot(c[0]-b[0]-d[0]+a[0],c[1]-b[1]-d[1]+a[1])>0.65)return null;
  return dv>du?[b,c,d,a]:[a,b,c,d];
}
function convex(ring) {
  let sign=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],c=ring[(i+2)%ring.length],cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);if(Math.abs(cross)<1e-7)continue;if(sign&&cross*sign<0)return false;sign=Math.sign(cross);}return !!sign;
}
function roofPlan(b,rings,style,lod) {
  if(lod==='far'||style.roof==='flat'||style.roof==='other')return {kind:'flat',eave:b.baseY+b.height};
  const corners=rectangle(rings);
  if(corners)return {kind:style.roof,eave:b.baseY+style.eaveHeight,corners};
  if(rings.length===1&&convex(rings[0])&&rings[0].length<=12&&['hipped','pyramidal'].includes(style.roof))return {kind:'pyramidal',eave:b.baseY+style.eaveHeight};
  return {kind:'flat',eave:b.baseY+b.height,fallback:true};
}
function pitchedRoof(builder,b,rings,plan,style,lod) {
  const top=b.baseY+b.height,P=p=>[p[0],plan.eave,p[1]];
  if(plan.kind==='flat'){cap(builder,rings,top,style.roofColor);return;}
  const sourceRing=plan.corners??rings[0],edges=facadeEdges(sourceRing);
  const overhang=builder.options.lowPerformance?0.04:0.1;
  const ring=sourceRing.map((p,i)=>{const a=edges[(i+edges.length-1)%edges.length].outward,c=edges[i].outward,f=Math.min(0.2,overhang/Math.max(0.5,1+a[0]*c[0]+a[1]*c[1]));return [p[0]+(a[0]+c[0])*f,p[1]+(a[1]+c[1])*f];});
  if(plan.kind==='pyramidal') {
    const centre=[ring.reduce((s,p)=>s+p[0],0)/ring.length,top,ring.reduce((s,p)=>s+p[1],0)/ring.length];
    for(let i=0;i<ring.length;i++)tri(builder,1,'roof',P(ring[i]),P(ring[(i+1)%ring.length]),centre,style.roofColor,true);
    return;
  }
  const [a,c,d,e]=ring,m=[(a[0]+e[0])/2,(a[1]+e[1])/2],n=[(c[0]+d[0])/2,(c[1]+d[1])/2];
  if(plan.kind==='shed') {
    const high=p=>[p[0],top,p[1]];quad(builder,1,'roof',P(a),P(c),high(d),high(e),style.roofColor,true);
    tri(builder,0,'wall',P(c),P(d),high(d),style.wall);tri(builder,0,'wall',P(e),P(a),high(e),style.wall);
    quad(builder,0,'wall',P(d),P(e),high(e),high(d),style.wall);return;
  }
  const hip=plan.kind==='hipped'?0.22:0,R=f=>[m[0]+(n[0]-m[0])*f,top,m[1]+(n[1]-m[1])*f];
  quad(builder,1,'roof',P(a),P(c),R(1-hip),R(hip),style.roofColor,true);
  quad(builder,1,'roof',P(e),R(hip),R(1-hip),P(d),style.roofColor,true);
  tri(builder,hip?1:0,hip?'roof':'wall',P(a),R(hip),P(e),hip?style.roofColor:style.wall,true);
  tri(builder,hip?1:0,hip?'roof':'wall',P(c),P(d),R(1-hip),hip?style.roofColor:style.wall,true);
}
function edgePoint(edge,t,y,offset=0.025){return [edge.a[0]+edge.along[0]*t+edge.outward[0]*offset,y,edge.a[1]+edge.along[1]*t+edge.outward[1]*offset];}
function panel(builder,edge,t,width,y,height,color,part='detail',offset=0.025){const P=(u,v)=>edgePoint(edge,u,v,offset);quad(builder,0,part,P(t-width/2,y),P(t-width/2,y+height),P(t+width/2,y+height),P(t+width/2,y),color);}
function slab(builder,edge,from,to,y,depth,color) {
  const P=(t,h,o)=>edgePoint(edge,t,h,o),a=P(from,y,0),b=P(to,y,0),c=P(to,y,depth),d=P(from,y,depth);
  quad(builder,0,'detail',a,b,c,d,color,true);
  quad(builder,0,'detail',P(from,y-0.1,depth),P(from,y,depth),P(to,y,depth),P(to,y-0.1,depth),color);
}
function facade(builder,b,rings,plan,style,lod,low) {
  if(lod==='far')return;
  // No window detail on courtyard rings; keep their topology without extra clutter.
  const edges=facadeEdges(rings[0]),entrance=entranceFacade(b,rings[0]),top=plan.eave;
  let chosen=edges;
  if(lod==='medium') {
    const front=entrance?.index??edges.reduce((a,c)=>c.length>a.length?c:a).index;
    chosen=edges.filter(e=>e.index===front||(!low&&e.index===(front+1)%edges.length));
  }
  for(const edge of chosen) {
    let windows=windowLayout(edge,{...style,eaveHeight:top-b.baseY},b,lod,low);
    if(lod==='near'&&entrance?.index===edge.index&&edge.length>=5) {
      const ground=windows.find(w=>w.floor===0);
      if(ground)windows=windows.filter(w=>w.floor!==0).concat([0.23,0.77].map(f=>({...ground,t:edge.length*f,width:Math.min(1.05,edge.length*0.18)})));
    }
    for(const w of windows) {
    if(lod==='near'&&entrance?.index===edge.index&&w.floor===0&&Math.abs(w.t-edge.length/2)<1)continue;
    if(lod==='near'&&!low)panel(builder,edge,w.t,w.width+0.18,w.y-0.09,w.height+0.18,style.frame,'window',0.03);
    panel(builder,edge,w.t,w.width,w.y,w.height,style.window,'window',0.036);
    if(lod==='near'&&!low)panel(builder,edge,w.t,0.045,w.y,w.height,0x718486,'window',0.043);
    builder.stats.windows++;
    }
  }
  if(lod!=='near'||!entrance||b.minHeight>0)return;
  const floor=b.baseY+0.035,doorHeight=Math.min(2.15,top-floor-0.15);if(doorHeight<1.6)return;
  panel(builder,entrance,entrance.length/2,1.2,floor-0.025,doorHeight+0.1,style.frame);
  panel(builder,entrance,entrance.length/2,1.05,floor,doorHeight,0x4b5351,'detail',0.043);
  builder.stats.entrances++;if(entrance.roadFacing)builder.stats.roadFacingEntrances++;
  const floorGap=b.baseY-b.foundationBottom;
  if(floorGap>0.12&&floorGap<0.85&&!low) {
    const count=Math.min(3,Math.ceil(floorGap/0.25));for(let i=0;i<count;i++)slab(builder,entrance,entrance.length/2-0.75,entrance.length/2+0.75,b.foundationBottom+(i+1)*floorGap/count,(count-i)*0.24,0x92988f);
  }
  if(low)return;
  if(style.commercialFront&&entrance.length>5) {
    const width=Math.min(8,entrance.length-1.4),y=floor+0.12;
    const openings=Math.max(2,Math.floor(width/2));
    for(let i=0;i<openings;i++)panel(builder,entrance,(entrance.length-width)/2+(i+0.5)*width/openings,width/openings-0.12,y,Math.min(1.95,top-y-0.5),i%2?0x51646a:0x616b69,'detail',0.045);
    // Blank sign band and awning. There are no invented business names.
    panel(builder,entrance,entrance.length/2,width,Math.min(top-0.4,floor+2.4),0.25,style.accent,'detail',0.05);
    slab(builder,entrance,(entrance.length-width)/2,(entrance.length+width)/2,Math.min(top-0.1,floor+2.35),0.6,style.roofColor);
  } else if(style.balcony&&top-floor>5.5) {
    const y=floor+(top-floor)/style.floors,width=Math.min(3.6,entrance.length*0.5);slab(builder,entrance,(entrance.length-width)/2,(entrance.length+width)/2,y,0.65,style.wall);
    panel(builder,entrance,entrance.length/2,width,y+0.55,0.1,0x707974,'detail',0.65);builder.stats.balconies++;
  } else if(style.veranda) {
    const width=Math.min(3.2,entrance.length*0.5);slab(builder,entrance,(entrance.length-width)/2,(entrance.length+width)/2,Math.min(top-0.15,floor+2.25),0.75,style.roofColor);builder.stats.verandas++;
  }
  const boundary=compoundTreatment(b);
  if(boundary){for(let i=1;i<boundary.points.length;i++){const a=boundary.points[i-1],c=boundary.points[i];quad(builder,0,'detail',[a[0],b.baseY,a[1]],[a[0],b.baseY+boundary.height,a[1]],[c[0],b.baseY+boundary.height,c[1]],[c[0],b.baseY,c[1]],style.wall);}builder.stats.compounds++;}
}
function validRecord(b) {
  return b&&Number.isFinite(b.height)&&b.height>0&&Number.isFinite(b.baseY)&&Number.isFinite(b.foundationBottom)&&
    Number.isFinite(b.minHeight)&&Array.isArray(b.polygons)&&b.polygons.length&&b.polygons.every(p=>Array.isArray(p)&&p.length&&p.every(r=>Array.isArray(r)&&r.length>=3&&r.every(v=>Array.isArray(v)&&v.length===2&&v.every(Number.isFinite))&&Math.abs(signedArea(r))>=1));
}
const HOUSING_TINTS=[0xa5bbb0,0xbdcabb,0x88a8b6,0xaaa2ca,0xd1ba80,0x78bcae];
const ARCHETYPE_TINTS=[0xb6c8a0,0x8cbdab,0x81b6c6,0x91a5ca,0xa6a0ce,0xb58fc0,0xc58eaa,0xd3a2a2,
  0xd3ad8e,0xd0bb87,0xc1c686,0x9db985,0x71b899,0x66b0b1,0x929bc1,0xd5c8a3];
function housingTint(b,mode){
  const h=b.housing;if(!h||h.propertyUse===0)return 0x93989b;
  if(mode==='archetype')return ARCHETYPE_TINTS[h.residentialArchetype];
  if(mode==='neighborhood')return [0xacb99b,0xbec7b2,0x8fabb9,0xb0a4bf,0xccb681,0x79bcb1,0xcba28c,0x9daab9,0x909697][h.neighborhoodProfile];
  return HOUSING_TINTS[h.qualityTier];
}
export function appendBuildingRecords(builder,records,lod='far') {
  const {lowPerformance=false,lodDebug=false,housingDebug=null}=builder.options;
  for(const b of records) {
    if(!validRecord(b)){builder.stats.malformedGeometry++;continue;}
    const level=b.visualLOD??lod;builder.currentLOD=level;const style=interpretBuilding(b);
    if(lodDebug)style.wall={near:0xe07869,medium:0xd6bb68,far:0x7fabb7}[level];
    if(housingDebug)style.wall=housingTint(b,housingDebug);
    const before=builder.batches.map(g=>g.position.length),statsBefore={...builder.stats,lodCounts:{...builder.stats.lodCounts},archetypes:{...builder.stats.archetypes}};
    try {
      for(const rings of b.polygons) {
        const plan=roofPlan(b,rings,style,level),bottom=b.minHeight?b.baseY+b.minHeight:b.foundationBottom-0.2;
        if(plan.fallback)builder.stats.roofFallbacks++;
        for(const ring of rings)for(const edge of facadeEdges(ring)) {
          const P=(p,y)=>[p[0],y,p[1]];
          const plinth=level!=='far'&&!b.minHeight?Math.min(plan.eave,b.baseY+0.18):bottom;
          if(plinth>bottom)quad(builder,0,'wall',P(edge.a,bottom),P(edge.a,plinth),P(edge.b,plinth),P(edge.b,bottom),0x9c9f94);
          quad(builder,0,'wall',P(edge.a,plinth),P(edge.a,plan.eave),P(edge.b,plan.eave),P(edge.b,plinth),style.wall);
          // A 12 cm eave strip gives an overhang/fascia impression without widening the footprint.
          if(level==='near'&&!lowPerformance&&plan.kind!=='flat')panel(builder,edge,edge.length/2,edge.length,plan.eave-0.08,0.12,0x666d66,'detail',0.12);
        }
        pitchedRoof(builder,b,rings,plan,style,level);facade(builder,b,rings,plan,style,level,lowPerformance);
      }
      builder.stats.lodCounts[level]++;builder.stats.archetypes[style.archetype]=(builder.stats.archetypes[style.archetype]??0)+1;
      if(level!=='far'&&!b.minHeight)builder.stats.foundations++;
    } catch {
      builder.batches.forEach((g,i)=>{g.position.length=before[i];g.normal.length=before[i];g.color.length=before[i];});
      builder.stats=statsBefore;builder.stats.malformedGeometry++;
      // A valid source shell can still render when optional architecture fails.
      for(const rings of b.polygons) {
        for(const ring of rings)for(const e of facadeEdges(ring))quad(builder,0,'wall',[e.a[0],b.foundationBottom-0.2,e.a[1]],[e.a[0],b.baseY+b.height,e.a[1]],[e.b[0],b.baseY+b.height,e.b[1]],[e.b[0],b.foundationBottom-0.2,e.b[1]],style.wall);
        cap(builder,rings,b.baseY+b.height,style.roofColor);
      }
      builder.stats.lodCounts.far++;builder.stats.archetypes.generic=(builder.stats.archetypes.generic??0)+1;
    }
  }
}
export function finishBuildingBuilder(builder) {
  return {geometry:builder.batches.map((b,i)=>b.position.length?{attributes:{position:{array:new Float32Array(b.position),itemSize:3},normal:{array:new Float32Array(b.normal),itemSize:3},color:{array:new Float32Array(b.color),itemSize:3}},userData:{part:i}}:null),stats:builder.stats};
}
export function buildBuildingData(records,lod='far',options={}) {const b=createBuildingBuilder(options);appendBuildingRecords(b,records,lod);return finishBuildingBuilder(b);}
export function buildCollisionPositions(records) {
  // Decorative windows/canopies/steps never become vehicle collision geometry.
  const recordsWithoutLOD=records.map(b=>({...b,visualLOD:'far'})),data=buildBuildingData(recordsWithoutLOD,'far');
  const arrays=data.geometry.filter(Boolean).map(g=>g.attributes.position.array),out=new Float32Array(arrays.reduce((s,a)=>s+a.length,0));
  let offset=0;for(const a of arrays){out.set(a,offset);offset+=a.length;}return out;
}
