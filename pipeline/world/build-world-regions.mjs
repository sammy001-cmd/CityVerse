import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,PROJECTION,loadCities,validateCity,regionPaths} from './city-config.mjs';
import {project} from './building-data.mjs';

export function makeRegionIndex(cities,available=new Set()) {
  const slugs=new Set();
  const regions=[...cities].sort((a,b)=>a.slug.localeCompare(b.slug)).map(city=>{
    validateCity(city);
    if(slugs.has(city.slug))throw new Error('Duplicate region slug');
    slugs.add(city.slug);
    const [minX,maxZ]=project(city.bbox.west,city.bbox.south);
    const [maxX,minZ]=project(city.bbox.east,city.bbox.north);
    return {slug:city.slug,displayName:city.displayName,country:city.country,state:city.state,
      bbox:city.bbox,worldBounds:{minX,minZ,maxX,maxZ},enabledWorldLayers:city.enabledWorldLayers,
      layers:{buildings:{available:city.enabledWorldLayers.includes('buildings')&&available.has(city.slug),
        manifest:regionPaths(city).manifestUrl}}};
  });
  return {version:1,projection:PROJECTION,regions,
    loadingPolicy:'Select by shared world bounds; fetch only the active region manifest and nearby tiles. Inactive regions allocate no geometry, draw calls or tile requests.'};
}
export async function writeRegionIndex(root=ROOT) {
  const cities=await loadCities(),available=new Set();
  for(const city of cities) {
    try {
      const output=regionPaths(city,root).output;
      const manifest=JSON.parse(await fs.readFile(path.join(output,'manifest.json'),'utf8'));
      if(manifest.region!==city.slug||manifest.projection?.id!==PROJECTION.id||manifest.schemaVersion!==2)
        throw new Error(`Invalid generated manifest for ${city.slug}`);
      const files=new Set(await fs.readdir(path.join(output,'tiles')));
      if(!Array.isArray(manifest.tiles)||!manifest.tiles.every(key=>/^-?\d+_-?\d+$/.test(key)))
        throw new Error(`Invalid generated tile list for ${city.slug}`);
      if(!manifest.tiles.every(key=>files.has(`${key}.json`)))continue;
      available.add(city.slug);
    } catch(error) {if(error.code!=='ENOENT')throw error;}
  }
  const index=makeRegionIndex(cities,available),output=path.join(root,'apps/client/public/data/world/regions.json');
  await fs.mkdir(path.dirname(output),{recursive:true});
  await fs.writeFile(output,JSON.stringify(index));
  return index;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  writeRegionIndex().then(index=>console.log('World region index:',index.regions.map(r=>r.slug))).catch(error=>{console.error(error);process.exitCode=1;});
