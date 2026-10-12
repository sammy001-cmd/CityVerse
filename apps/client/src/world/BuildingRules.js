export const FAMILIES = ['residential_low','residential_multi','commercial','mixed_use','office','school','university','hospital','clinic','hotel','industrial','warehouse','government','place_of_worship','market','generic'];
export function seedFor(id) { let n=2166136261; for(const c of String(id)) n=Math.imul(n^c.charCodeAt(0),16777619); return n>>>0; }
export function classify(t={}) {
  const a=t.amenity, b=t.building;
  const semantic={school:'school',kindergarten:'school',college:'university',university:'university',hospital:'hospital',clinic:'clinic',doctors:'clinic',place_of_worship:'place_of_worship',marketplace:'market',townhall:'government',courthouse:'government'};
  if(semantic[a]) return {family:semantic[a],verified:true};
  if(t.healthcare && t.healthcare!=='no') return {family:t.healthcare==='hospital'?'hospital':'clinic',verified:true};
  if(t.tourism==='hotel' || t.tourism==='guest_house') return {family:'hotel',verified:true};
  if(t.office) return {family:t.office==='government'?'government':'office',verified:true};
  if(t.government) return {family:'government',verified:true};
  if(t.school && t.school!=='no') return {family:'school',verified:true};
  if(t.shop && t.shop!=='no') return {family:['apartments','residential'].includes(b)?'mixed_use':'commercial',verified:true};
  const types={house:'residential_low',detached:'residential_low',semidetached_house:'residential_low',terrace:'residential_low',bungalow:'residential_low',residential:'residential_low',apartments:'residential_multi',mixed_use:'mixed_use',commercial:'commercial',retail:'commercial',industrial:'industrial',warehouse:'warehouse',school:'school',university:'university',hospital:'hospital',hotel:'hotel',office:'office',church:'place_of_worship',mosque:'place_of_worship',government:'government'};
  return {family:types[b]??'generic',verified:!!types[b]};
}
export function metres(v) {
  if(v===undefined) return null;
  const m=String(v).trim().match(/^(\d+(?:\.\d+)?)\s*(m|ft|')?$/i);
  const n=m?Number(m[1])*(m[2] && m[2].toLowerCase()!=='m'?0.3048:1):NaN;
  return n>0 && n<=300?n:null;
}
export function inferHeight(tags,family,seed) {
  const floor=['industrial','warehouse'].includes(family)?5.5:['commercial','office','school','university','hospital','market'].includes(family)?3.6:3.1;
  const levels=Number(tags['building:levels']); const explicit=metres(tags.height);
  const validLevels=Number.isFinite(levels)&&levels>0&&levels<=80;
  const defaults={residential_multi:3,office:3,hotel:3,hospital:3,university:2,mixed_use:2};
  const storeys=validLevels?levels:explicit?Math.max(1,Math.floor(explicit/floor)):(defaults[family]??1);
  // Storeys describe occupied floors; allow a modest roof above low-rise walls.
  const roofAllowance=tags['roof:shape']==='flat'||storeys>=3?0:1.5;
  const h=explicit??(storeys*floor+roofAllowance+(validLevels?0:((seed%1000)/1000)*0.8));
  return {height:Math.round(Math.min(300,h)*10)/10,levels:storeys,source:explicit?'height':validLevels?'levels':'inferred',minHeight:Math.min(metres(tags.min_height)??0,Math.min(300,h)-0.2)};
}
export function project(lon,lat,center={lat:7.3962,lon:3.8968}) { return [(lon-center.lon)*111320*Math.cos(center.lat*Math.PI/180),-(lat-center.lat)*110540]; }
export function ownerTile(polygons) {const ring=polygons[0][0];return [Math.floor(ring.reduce((sum,p)=>sum+p[0],0)/ring.length/250),Math.floor(ring.reduce((sum,p)=>sum+p[1],0)/ring.length/250)];}
export function encodeFootprints(polygons,tx,tz) {return polygons.map(p=>p.map(r=>r.map(([x,z])=>[Math.round((x-tx*250)*10),Math.round((z-tz*250)*10)])));}
export function cleanRing(ring) {
  if(!Array.isArray(ring)) return null;
  const out=[];
  for(const p of ring) { if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)) return null; if(!out.length||p[0]!==out.at(-1)[0]||p[1]!==out.at(-1)[1]) out.push(p); }
  if(out.length>1&&out[0][0]===out.at(-1)[0]&&out[0][1]===out.at(-1)[1]) out.pop();
  const area=out.reduce((s,p,i)=>{const q=out[(i+1)%out.length]; return s+p[0]*q[1]-q[0]*p[1];},0)/2;
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for(let i=0;i<out.length;i++)for(let j=i+2;j<out.length;j++) {
    if(i===0&&j===out.length-1)continue;
    const a=out[i],b=out[(i+1)%out.length],c=out[j],d=out[(j+1)%out.length];
    if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return null;
  }
  return out.length>=3&&Math.abs(area)>=1?out:null;
}
export function selectLOD(distance,low=false) { return distance<(low?90:140)?'near':distance<(low?240:350)?'medium':'far'; }
export function pointInRing(x,z,p) { let c=false; for(let i=0,j=p.length-1;i<p.length;j=i++) if((p[i][1]>z)!==(p[j][1]>z)&&x<(p[j][0]-p[i][0])*(z-p[i][1])/(p[j][1]-p[i][1])+p[i][0]) c=!c; return c; }
export function validHoles(rings) {
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const crossing=(a,b)=>a.some((p,i)=>b.some((q,j)=>cross(p,a[(i+1)%a.length],q)*cross(p,a[(i+1)%a.length],b[(j+1)%b.length])<0&&cross(q,b[(j+1)%b.length],p)*cross(q,b[(j+1)%b.length],a[(i+1)%a.length])<0));
  return rings.slice(1).every((hole,i)=>hole.every(p=>pointInRing(...p,rings[0]))&&!crossing(hole,rings[0])&&rings.slice(1,i+1).every(other=>!crossing(hole,other)&&!pointInRing(...hole[0],other)&&!pointInRing(...other[0],hole)));
}
export function roadOverlap(rings,edges) {
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const intersects=(a,b,c,d)=>cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0;
  for(const e of edges) {
    const len=Math.hypot(e.b[0]-e.a[0],e.b[1]-e.a[1]); if(!len) continue;
    const nx=-(e.b[1]-e.a[1])/len*e.width/2,nz=(e.b[0]-e.a[0])/len*e.width/2;
    const q=[[e.a[0]+nx,e.a[1]+nz],[e.b[0]+nx,e.b[1]+nz],[e.b[0]-nx,e.b[1]-nz],[e.a[0]-nx,e.a[1]-nz]];
    const inside=p=>pointInRing(...p,rings[0])&&!rings.slice(1).some(r=>pointInRing(...p,r));
    if(q.some(inside)||rings[0].some(p=>pointInRing(...p,q))||rings.some(r=>r.some((p,i)=>q.some((v,j)=>intersects(p,r[(i+1)%r.length],v,q[(j+1)%4]))))) return e.roadId;
  }
  return null;
}
