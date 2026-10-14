import fs from 'node:fs/promises';
import {LANDMARK_MODELS} from '../../apps/client/src/navigation/LandmarkIdentity.js';
import {pointInRing} from '../../apps/client/src/world/BuildingRules.js';
for(const region of ['ibadan','ogbomoso']){
  const base=`apps/client/public/data/world/${region}`;
  const source=JSON.parse(await fs.readFile(`${base}/map/landmarks.json`,'utf8'));
  const landmarks=source.landmarks.filter(p=>LANDMARK_MODELS[p.id]?.regionId===region);
  const context=JSON.parse(await fs.readFile(`data/generated/city-map-v2/${region}-source.json`,'utf8'));
  for(const p of landmarks){
    const area=context.areas.find(a=>a.id===p.source.identity);
    if(!area)continue;
    if(LANDMARK_MODELS[p.id].architecture==='park'){p.siteRings=area.rings;continue;}
    if(LANDMARK_MODELS[p.id].architecture!=='institution')continue;
    const points=area.rings[0],xs=points.map(p=>p[0]),zs=points.map(p=>p[1]);
    const components=new Set();
    for(let x=Math.floor(Math.min(...xs)/250);x<=Math.floor(Math.max(...xs)/250);x++)for(let z=Math.floor(Math.min(...zs)/250);z<=Math.floor(Math.max(...zs)/250);z++){
      let tile;try{tile=JSON.parse(await fs.readFile(`${base}/buildings/tiles/${x}_${z}.json`,'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
      for(const row of tile.buildings){
        const ring=row[10]?.[0]?.[0];if(!ring?.length)continue;
        const cx=x*250+ring.reduce((s,p)=>s+p[0]*.1,0)/ring.length,cz=z*250+ring.reduce((s,p)=>s+p[1]*.1,0)/ring.length;
        if(pointInRing(cx,cz,points)&&!area.rings.slice(1).some(r=>pointInRing(cx,cz,r)))components.add(row[0]);
      }
    }
    p.componentSourceIds=[...components].sort();
  }
  await fs.writeFile(`${base}/landmarks.json`,JSON.stringify({version:1,region,derivedFrom:`${base}/map/landmarks.json`,landmarks}));
  console.log(region,landmarks.map(p=>`${p.id} ${p.name}`).join(', '));
}
