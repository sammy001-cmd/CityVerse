import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const projection=JSON.parse(await fs.readFile('pipeline/world/projection.json','utf8'));
const slugs=process.argv.find(a=>a.startsWith('--regions='))?.slice(10).split(',')??['ibadan','ogbomoso'];
const tileSize=1000,classes=['motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','residential','unclassified','living_street','service','pedestrian','footway','cycleway','path','steps'];
const kinds=['residential','commercial','retail','industrial','institution','park','water'];
const project=(lat,lon)=>[(lon-projection.origin.lon)*projection.metresPerDegreeLon*Math.cos(projection.origin.lat*Math.PI/180),-(lat-projection.origin.lat)*projection.metresPerDegreeLat];
export function clipSegment(a,b,box){
  const dx=b[0]-a[0],dz=b[1]-a[1];let lo=0,hi=1;
  for(const [p,q] of [[-dx,a[0]-box.minX],[dx,box.maxX-a[0]],[-dz,a[1]-box.minZ],[dz,box.maxZ-a[1]]]){
    if(p===0){if(q<0)return null;continue;}const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return null;
  }return [[a[0]+lo*dx,a[1]+lo*dz],[a[0]+hi*dx,a[1]+hi*dz]];
}
export function simplify(points,tolerance){
  if(points.length<3)return points;const kept=new Set([0,points.length-1]),stack=[[0,points.length-1]];
  while(stack.length){const [start,end]=stack.pop(),a=points[start],b=points[end],dx=b[0]-a[0],dz=b[1]-a[1],len=dx*dx+dz*dz;let best=tolerance*tolerance,index=-1;
    for(let i=start+1;i<end;i++){const p=points[i],t=len?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/len)):0,d=(p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dz)**2;if(d>best){best=d;index=i;}}
    if(index>=0){kept.add(index);stack.push([start,index],[index,end]);}
  }return [...kept].sort((a,b)=>a-b).map(i=>points[i]);
}
export function clipRing(ring,box){
  let points=ring.slice(0,-1);
  for(const [axis,bound,greater] of [[0,box.minX,true],[0,box.maxX,false],[1,box.minZ,true],[1,box.maxZ,false]]){
    const next=[],inside=p=>greater?p[axis]>=bound:p[axis]<=bound;
    for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],ia=inside(a),ib=inside(b);if(ia)next.push(a);if(ia!==ib){const t=(bound-a[axis])/(b[axis]-a[axis]);next.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}}points=next;if(points.length<3)return [];
  }
  points=points.map(p=>p.map(Math.round)).filter((p,i,a)=>!i||p[0]!==a[i-1][0]||p[1]!==a[i-1][1]);
  if(points.length<3)return [];return [...points,points[0]];
}
const bounds=points=>points.reduce((b,[x,z])=>({minX:Math.min(b.minX,x),maxX:Math.max(b.maxX,x),minZ:Math.min(b.minZ,z),maxZ:Math.max(b.maxZ,z)}),{minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity});
const inside=(p,b)=>p.x>=b.minX&&p.x<=b.maxX&&p.z>=b.minZ&&p.z<=b.maxZ;
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
const regions=[];
for(const slug of slugs){
  if(!/^[a-z][a-z0-9-]*$/.test(slug))throw Error('Invalid region');
  const city=JSON.parse(await fs.readFile(`pipeline/world/cities/${slug}.json`,'utf8')),raw=await fs.readFile(`data/generated/city-map-v2/${slug}-source.json`),source=JSON.parse(raw);
  const nw=project(city.bbox.north,city.bbox.west),se=project(city.bbox.south,city.bbox.east),box={minX:nw[0],minZ:nw[1],maxX:se[0],maxZ:se[1]};
  const output=`apps/client/public/data/world/${slug}/map`;await fs.mkdir(`${output}/tiles`,{recursive:true});
  const makeTile=(tx=0,tz=0)=>({tx,tz,names:[null],roads:[],areas:[],rivers:[],places:[],pois:[]});
  const overview=makeTile(),tiles=new Map(),search=new Map();
  const get=(x,z)=>{const tx=Math.floor(x/tileSize),tz=Math.floor(z/tileSize),key=`${tx}_${tz}`;if(!tiles.has(key))tiles.set(key,makeTile(tx,tz));return tiles.get(key);};
  const nameId=(tile,name)=>{if(!name)return 0;let i=tile.names.indexOf(name);if(i<0){i=tile.names.length;tile.names.push(name);}return i;};
  const local=(tile,p)=>p.map((v,i)=>Math.round(v-(i?tile.tz:tile.tx)*tileSize));
  const addSearch=p=>{if(!p.name||!inside(p,box))return;const key=`${p.category}:${p.name.toLowerCase()}`;if(!search.has(key))search.set(key,{...p,region:slug,tileKey:`${Math.floor(p.x/tileSize)}_${Math.floor(p.z/tileSize)}`});};
  const addSegments=(tile,points,type,name,river=false)=>{for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];(river?tile.rivers:tile.roads).push(river?[...a,...b,nameId(tile,name)]:[...a,...b,classes.indexOf(type),nameId(tile,name)]);}};
  for(const road of source.roads){
    const major=classes.indexOf(road.type)<=9;
    let anchor=null,longest=0;
    for(let i=1;i<road.points.length;i++){
      const clipped=clipSegment(road.points[i-1],road.points[i],box);if(!clipped)continue;const [a,b]=clipped,length=Math.hypot(a[0]-b[0],a[1]-b[1]);
      if(length>longest){longest=length;anchor={x:(a[0]+b[0])/2,z:(a[1]+b[1])/2};}
      const steps=Math.max(1,Math.ceil(length/100));for(let j=0;j<steps;j++){
        const p=[a[0]+(b[0]-a[0])*j/steps,a[1]+(b[1]-a[1])*j/steps],q=[a[0]+(b[0]-a[0])*(j+1)/steps,a[1]+(b[1]-a[1])*(j+1)/steps],tile=get((p[0]+q[0])/2,(p[1]+q[1])/2);addSegments(tile,[local(tile,p),local(tile,q)],road.type,road.name);
      }
    }
    if(major){const line=simplify(road.points,25);for(let i=1;i<line.length;i++){const clipped=clipSegment(line[i-1],line[i],box);if(clipped)addSegments(overview,clipped.map(p=>p.map(Math.round)),road.type,road.name);}}
    if(anchor&&road.name)addSearch({id:`osm:${road.id}`,name:road.name,category:'road',...anchor,importance:major?2:1});
  }
  for(const area of source.areas){
    const rings=area.rings.map(r=>clipRing(simplify(r,3),box));if(!rings[0]?.length)continue;
    const valid=rings.filter(r=>r.length>=4),b=bounds(valid[0]),kind=kinds.indexOf(area.kind);if(kind<0)continue;
    const coarse=valid.map(r=>simplify(r,25));if(coarse[0].length>=4)overview.areas.push([kind,area.id,nameId(overview,area.name),coarse.filter(r=>r.length>=4)]);
    for(let x=Math.floor(b.minX/tileSize);x<=Math.floor(b.maxX/tileSize);x++)for(let z=Math.floor(b.minZ/tileSize);z<=Math.floor(b.maxZ/tileSize);z++){
      const sub={minX:x*tileSize,maxX:(x+1)*tileSize,minZ:z*tileSize,maxZ:(z+1)*tileSize},cut=valid.map(r=>clipRing(r,sub));if(!cut[0]?.length)continue;
      const tile=get(x*tileSize+1,z*tileSize+1);tile.areas.push([kind,area.id,nameId(tile,area.name),cut.filter(r=>r.length>=4).map(r=>r.map(p=>local(tile,p)))]);
    }
  }
  for(const river of source.rivers){const coarse=simplify(river.points,18);for(let i=1;i<coarse.length;i++){const p=clipSegment(coarse[i-1],coarse[i],box);if(p)addSegments(overview,p.map(v=>v.map(Math.round)),null,river.name,true);}
    for(let i=1;i<river.points.length;i++){const pair=clipSegment(river.points[i-1],river.points[i],box);if(!pair)continue;const [a,b]=pair,steps=Math.max(1,Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1])/100));for(let j=0;j<steps;j++){const p=[a[0]+(b[0]-a[0])*j/steps,a[1]+(b[1]-a[1])*j/steps],q=[a[0]+(b[0]-a[0])*(j+1)/steps,a[1]+(b[1]-a[1])*(j+1)/steps],tile=get((p[0]+q[0])/2,(p[1]+q[1])/2);addSegments(tile,[local(tile,p),local(tile,q)],null,river.name,true);}}
  }
  const roadIds=new Set(source.roads.map(r=>`osm:${r.id}`));
  const pois=[...new Map(source.pois.filter(p=>inside(p,box)&&!(p.category==='landmark'&&roadIds.has(p.id))).map(p=>[p.id,{...p,region:slug}])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  const places=[...new Map(source.places.filter(p=>inside(p,box)).map(p=>[p.id,{...p,region:slug}])).values()];
  for(const p of pois){if(/university college hospital/i.test(p.name))p.aliases=[...(p.aliases??[]),'UCH'];if(/^university of ibadan$/i.test(p.name))p.aliases=[...(p.aliases??[]),'UI'];if(/ladoke akintola university of technology/i.test(p.name))p.aliases=[...(p.aliases??[]),/hospital/i.test(p.name)?'LAUTECH Teaching Hospital':'LAUTECH'];get(p.x,p.z).pois.push(p);addSearch(p);}
  for(const p of places){get(p.x,p.z).places.push(p);overview.places.push(p);addSearch(p);}
  const landmarks=pois.filter(p=>p.importance>=2).map(p=>({...p,labelPriority:p.importance,modelOverrideId:null}));
  const write=async(file,value)=>{const content=JSON.stringify(value);await fs.writeFile(`${output}/${file}`,content);return Buffer.byteLength(content);};
  const overviewBytes=await write('overview.json',overview),landmarkBytes=await write('landmarks.json',{version:1,region:slug,landmarks});
  const searchBytes=await write('search-index.json',{version:1,region:slug,fields:['id','name','category','x','z','tileKey','importance','aliases'],entries:[...search.values()].sort((a,b)=>a.name.localeCompare(b.name)).map(p=>[p.id,p.name,p.category,Math.round(p.x),Math.round(p.z),p.tileKey,p.importance??1,p.aliases??[]])});
  let tileBytes=0,maxTileBytes=0;for(const [key,tile] of [...tiles].sort(([a],[b])=>a.localeCompare(b))){const bytes=await write(`tiles/${key}.json`,tile);tileBytes+=bytes;maxTileBytes=Math.max(maxTileBytes,bytes);}
  const manifest={version:2,region:slug,displayName:city.displayName,projection,bounds:box,tileSize,tiles:[...tiles.keys()].sort(),tilePath:'tiles/{tx}_{tz}.json',overview:'overview.json',searchIndex:'search-index.json',landmarks:'landmarks.json',roadClasses:classes.map((type,id)=>({id,type})),areaKinds:kinds,
    source:{provider:'OpenStreetMap',input:'local Nigeria PBF',extractedSourceSHA256:createHash('sha256').update(raw).digest('hex')},attribution:'© OpenStreetMap contributors',stats:{overviewBytes,landmarkBytes,searchBytes,tileBytes,maxTileBytes,tileCount:tiles.size,pois:pois.length,places:places.length,landmarks:landmarks.length,searchEntries:search.size,areas:source.areas.length,rivers:source.rivers.length}};
  await write('manifest.json',manifest);regions.push({slug,displayName:city.displayName,bounds:box,manifest:`/data/world/${slug}/map/manifest.json`});console.log(JSON.stringify({region:slug,...manifest.stats}));
}
await fs.mkdir('apps/client/public/data/city-map-v2',{recursive:true});await fs.writeFile('apps/client/public/data/city-map-v2/regions.json',JSON.stringify({version:2,projection,regions}));
}
