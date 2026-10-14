import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const DIRECTORY=path.join(ROOT,'pipeline/world/cities');
export const PROJECTION=JSON.parse(await fs.readFile(new URL('./projection.json',import.meta.url),'utf8'));
export const CENTER=Object.freeze(PROJECTION.origin);
export const QUANTIZATION=PROJECTION.quantization;
export const DEFAULT_TILE_SIZE=250;
if(PROJECTION.version!==1||PROJECTION.units!=='metres'||PROJECTION.axes?.x!=='east'||PROJECTION.axes?.z!=='south'
  ||!Number.isFinite(CENTER.lat)||Math.abs(CENTER.lat)>90||!Number.isFinite(CENTER.lon)||Math.abs(CENTER.lon)>180
  ||![PROJECTION.metresPerDegreeLat,PROJECTION.metresPerDegreeLon,QUANTIZATION].every(v=>Number.isFinite(v)&&v>0))
  throw new Error('Invalid shared world projection');
export function validateSlug(slug) {
  if(typeof slug!=='string'||!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug))throw new Error('Invalid city slug');
  return slug;
}
export function validateCity(config) {
  validateSlug(config?.slug);
  if('origin' in config||'center' in config)throw new Error('City cannot override the shared world origin');
  const allowed=['slug','displayName','country','countryCode','state','bbox','projection','tileSize','enabledWorldLayers','build'];
  if(!Object.keys(config).every(key=>allowed.includes(key)))throw new Error('Unsupported city configuration property');
  for(const key of ['displayName','country','countryCode','state'])
    if(typeof config[key]!=='string'||!config[key].trim())throw new Error(`Invalid city ${key}`);
  if(!/^[A-Z]{3}$/.test(config.countryCode))throw new Error('Invalid country code');
  const b=config.bbox;
  if(!b||!Object.keys(b).every(k=>['south','west','north','east'].includes(k))||!['south','west','north','east'].every(k=>Number.isFinite(b[k]))
    ||b.south>=b.north||b.west>=b.east||b.south< -90||b.north>90||b.west< -180||b.east>180)
    throw new Error('Invalid city bbox');
  if(config.projection!==PROJECTION.id)throw new Error('City must reference the shared projection');
  if(!Number.isInteger(config.tileSize)||config.tileSize<10||config.tileSize>10000)throw new Error('Invalid city tile size');
  const layers=config.enabledWorldLayers;
  if(!Array.isArray(layers)||!layers.length||new Set(layers).size!==layers.length
    ||!layers.every(l=>['buildings','roads','terrain','pois','navigation'].includes(l)))throw new Error('Invalid enabled world layers');
  if(config.build!==undefined&&(!config.build||typeof config.build!=='object'||Array.isArray(config.build)))throw new Error('Invalid build metadata');
  const roadPath=config.build?.roadAnalysisDirectory;
  if(roadPath!==undefined&&(typeof roadPath!=='string'||path.isAbsolute(roadPath)||roadPath.split(/[\\/]/).includes('..')))
    throw new Error('Road analysis path must stay within the project');
  return config;
}
export async function loadCity(slug) {
  validateSlug(slug);
  const config=validateCity(JSON.parse(await fs.readFile(path.join(DIRECTORY,`${slug}.json`),'utf8')));
  if(config.slug!==slug)throw new Error('City slug and config filename disagree');
  return config;
}
export async function loadCities() {
  const files=(await fs.readdir(DIRECTORY)).filter(f=>f.endsWith('.json')).sort();
  return Promise.all(files.map(file=>loadCity(file.slice(0,-5))));
}
export function regionPaths(city,root=ROOT) {
  const slug=validateSlug(typeof city==='string'?city:city.slug);
  return {source:path.join(root,'data/generated/world',slug,'buildings-source.json'),
    report:path.join(root,'data/generated/world',slug,'buildings-report.json'),
    output:path.join(root,'apps/client/public/data/world',slug,'buildings'),
    manifestUrl:`/data/world/${slug}/buildings/manifest.json`,
    tileUrl:key=>{if(!/^-?\d+_-?\d+$/.test(key))throw new Error('Invalid tile key');return `/data/world/${slug}/buildings/tiles/${key}.json`;}};
}
export function parseCityArgs(args=process.argv.slice(2)) {
  if(args.length!==2||args[0]!=='--city')throw new Error('Usage: --city <slug>');
  return validateSlug(args[1]);
}
