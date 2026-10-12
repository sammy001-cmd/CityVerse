// City-independent build-time rules; all regions use the shared world projection.
import {seedFor} from '../../apps/client/src/world/BuildingRules.js';
export {seedFor};
import {CENTER,PROJECTION,QUANTIZATION,DEFAULT_TILE_SIZE} from './city-config.mjs';
export {CENTER,QUANTIZATION};
export const CATEGORIES = ['residential_low','residential_multi','commercial','mixed_use',
  'office','school','university','hospital','clinic','hotel','industrial','warehouse',
  'government','place_of_worship','market','parking_structure','generic'];
export const ROOFS = ['flat','gable','hipped','pyramidal','shed','other'];
export const HEIGHT_SOURCES = ['explicit_height','explicit_levels','inferred'];
export const TAGS = ['building','building:levels','building:min_level','height','min_height',
  'roof:shape','roof:levels','roof:height','roof:material','building:material','name',
  'amenity','shop','office','tourism','healthcare','leisure','religion','denomination',
  'school','university','addr:housenumber','addr:street'];
export const FIELDS = ['id','category','height','levels','minHeight','roof','seed','name',
  'flags','heightSource','polygons','tags'];
export const FLAGS = {explicitCategory: 1, explicitRoof: 2, largeFootprint: 4, heavyRoadOverlap: 8};

export function project(lon, lat, center = CENTER) {
  return [(lon-center.lon)*PROJECTION.metresPerDegreeLon*Math.cos(center.lat*Math.PI/180),
    -(lat-center.lat)*PROJECTION.metresPerDegreeLat];
}
export function classify(tags = {}) {
  const amenity = {hospital:'hospital',clinic:'clinic',doctors:'clinic',school:'school',
    kindergarten:'school',college:'university',university:'university',
    place_of_worship:'place_of_worship',marketplace:'market',townhall:'government',courthouse:'government'};
  let category = Object.hasOwn(amenity,tags.amenity) ? amenity[tags.amenity] : undefined;
  if (!category && ['hospital','clinic','doctor','doctors'].includes(tags.healthcare))
    category = tags.healthcare === 'hospital' ? 'hospital' : 'clinic';
  if (!category && ['hotel','guest_house','motel','hostel'].includes(tags.tourism)) category = 'hotel';
  if (!category && tags.university && tags.university !== 'no') category = 'university';
  if (!category && tags.school && tags.school !== 'no') category = 'school';
  if (!category && tags.office && tags.office !== 'no') category = tags.office === 'government' ? 'government' : 'office';
  if (!category && tags.shop && tags.shop !== 'no')
    category = ['apartments','residential','house','mixed_use'].includes(tags.building) ? 'mixed_use' : 'commercial';
  const building = {house:'residential_low',detached:'residential_low',semidetached_house:'residential_low',
    terrace:'residential_low',bungalow:'residential_low',residential:'residential_low',
    apartments:'residential_multi',dormitory:'residential_multi',commercial:'commercial',retail:'commercial',
    mixed_use:'mixed_use',office:'office',school:'school',university:'university',hospital:'hospital',
    clinic:'clinic',hotel:'hotel',industrial:'industrial',warehouse:'warehouse',government:'government',
    church:'place_of_worship',mosque:'place_of_worship',temple:'place_of_worship',synagogue:'place_of_worship',
    cathedral:'place_of_worship',market:'market',parking:'parking_structure',garage:'parking_structure'};
  category ??= Object.hasOwn(building,tags.building) ? building[tags.building] : undefined;
  return {category: category ?? 'generic', source: category ? 'explicit' : 'inferred'};
}
export function metres(value, allowZero = false) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet|foot|')?$/i);
  if (!match) return null;
  const feet = /^(ft|feet|foot|')$/i.test(match[2] ?? '');
  const number = Number(match[1]) * (feet ? 0.3048 : 1);
  return Number.isFinite(number) && number >= (allowZero ? 0 : 0.1) && number <= 300 ? number : null;
}
function levelsFor(value, allowZero = false) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (!/^\d+(?:\.\d+)?$/.test(String(value).trim())) return null;
  const levels = Number(value);
  return levels >= (allowZero ? 0 : 0.25) && levels <= 80 ? levels : null;
}
const round = value => Math.round(value * 10) / 10;
export function normalizeHeight(tags = {}, category = 'generic', seed = 0) {
  const floorHeight = ['industrial','warehouse'].includes(category) ? 5.5
    : ['commercial','office','school','university','hospital','market','parking_structure'].includes(category) ? 3.6 : 3.1;
  const explicit = metres(tags.height), explicitLevels = levelsFor(tags['building:levels']);
  const defaults = {residential_multi:3,mixed_use:2,office:3,university:2,hospital:3,hotel:3,parking_structure:2};
  const levels = explicitLevels ?? (explicit ? Math.max(1, Math.floor(explicit/floorHeight)) : defaults[category] ?? 1);
  const roofHeight = metres(tags['roof:height'], true);
  const height = round(explicit ?? Math.min(300,
    levels*floorHeight + (roofHeight ?? 0) + (explicitLevels ? 0 : 0.3 + (seed%1000)/1000*0.8)));
  const minHeight = round(metres(tags.min_height, true) ?? ((levelsFor(tags['building:min_level'], true) ?? 0)*floorHeight));
  const warnings = [];
  if (tags.height !== undefined && explicit === null) warnings.push('invalid_height_tag');
  if (tags['building:levels'] !== undefined && explicitLevels === null) warnings.push('invalid_levels_tag');
  if (minHeight >= height) warnings.push('invalid_min_height');
  return {height, levels, minHeight: minHeight < height ? minHeight : 0,
    source: explicit !== null ? 'explicit_height' : explicitLevels !== null ? 'explicit_levels' : 'inferred', warnings};
}
export function normalizeRoof(tags = {}, category = 'generic', levels = 1, seed = 0) {
  const aliases = {gabled:'gable',gable:'gable',flat:'flat',hipped:'hipped',pyramidal:'pyramidal',
    skillion:'shed',shed:'shed',half_hipped:'hipped'};
  const shape = typeof tags['roof:shape']==='string' ? tags['roof:shape'].trim().toLowerCase() : null;
  if (shape && shape !== 'no') return {shape: Object.hasOwn(aliases,shape) ? aliases[shape] : 'other', source:'explicit'};
  const flat = levels >= 3 || ['commercial','office','hospital','hotel','parking_structure'].includes(category);
  return {shape:flat ? 'flat' : ['industrial','warehouse'].includes(category) ? 'gable'
    : seed%2 ? 'hipped' : 'gable', source:'inferred'};
}

function cross(a,b,c) {return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
function onSegment(a,b,p) {
  return Math.abs(cross(a,b,p)) < 1e-8 && p[0] >= Math.min(a[0],b[0])-1e-8
    && p[0] <= Math.max(a[0],b[0])+1e-8 && p[1] >= Math.min(a[1],b[1])-1e-8 && p[1] <= Math.max(a[1],b[1])+1e-8;
}
function intersects(a,b,c,d) {
  return (cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0)
    || onSegment(a,b,c) || onSegment(a,b,d) || onSegment(c,d,a) || onSegment(c,d,b);
}
function ringsTouch(a,b) {
  return a.some((p,i)=>b.some((q,j)=>intersects(p,a[(i+1)%a.length],q,b[(j+1)%b.length])));
}
export function signedArea(ring) {
  // Shift to the first vertex to avoid cancellation at distant world coordinates.
  const [ox,oz] = ring[0];
  return ring.reduce((area,p,i)=>{const q=ring[(i+1)%ring.length];
    return area+(p[0]-ox)*(q[1]-oz)-(q[0]-ox)*(p[1]-oz);},0)/2;
}
export function pointInRing(point,ring) {
  let inside = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i], b=ring[j];
    if ((a[1]>point[1]) !== (b[1]>point[1]) && point[0] < (b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
  }
  return inside;
}
export function cleanRing(input) {
  if (!Array.isArray(input)) return {reason:'malformed_ring'};
  const ring=[];
  for (const point of input) {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) return {reason:'nonfinite_coordinate'};
    if (!ring.length || point[0] !== ring.at(-1)[0] || point[1] !== ring.at(-1)[1]) ring.push([...point]);
  }
  if (ring.length>1 && ring[0][0]===ring.at(-1)[0] && ring[0][1]===ring.at(-1)[1]) ring.pop();
  if (new Set(ring.map(p=>p.join(','))).size < 3) return {reason:'fewer_than_three_vertices'};
  for (let i=0;i<ring.length;i++) for (let j=i+1;j<ring.length;j++) {
    if (j===i+1 || (i===0 && j===ring.length-1)) continue;
    if (intersects(ring[i],ring[(i+1)%ring.length],ring[j],ring[(j+1)%ring.length])) return {reason:'self_intersection'};
  }
  if (Math.abs(signedArea(ring)) < 1e-8) return {reason:'zero_area'};
  return {ring};
}
export function ringCentroid(ring) {
  const [ox,oz]=ring[0]; let x=0,z=0,twice=0;
  for (let i=0;i<ring.length;i++) {
    const a=[ring[i][0]-ox,ring[i][1]-oz], b=[ring[(i+1)%ring.length][0]-ox,ring[(i+1)%ring.length][1]-oz];
    const weight=a[0]*b[1]-b[0]*a[1]; twice+=weight; x+=(a[0]+b[0])*weight; z+=(a[1]+b[1])*weight;
  }
  return [ox+x/(3*twice),oz+z/(3*twice)];
}
export function cleanPolygons(input) {
  if (!Array.isArray(input) || !input.length) return {reason:'missing_polygons'};
  const polygons=[]; let area=0,cx=0,cz=0;
  const bounds={minX:Infinity,minZ:Infinity,maxX:-Infinity,maxZ:-Infinity};
  for (const polygon of input) {
    if (!Array.isArray(polygon) || !polygon.length) return {reason:'missing_outer_ring'};
    const rings=[];
    for (const raw of polygon) {
      const cleaned=cleanRing(raw); if (cleaned.reason) return cleaned;
      rings.push(cleaned.ring);
    }
    for (let i=1;i<rings.length;i++) {
      if (!rings[i].every(p=>pointInRing(p,rings[0])) || ringsTouch(rings[0],rings[i])) return {reason:'invalid_hole'};
      for (let j=1;j<i;j++) if (ringsTouch(rings[i],rings[j]) || pointInRing(rings[i][0],rings[j]) || pointInRing(rings[j][0],rings[i])) return {reason:'overlapping_holes'};
    }
    for (const prior of polygons) {
      const inSolid = (p,rs)=>pointInRing(p,rs[0])&&!rs.slice(1).some(r=>pointInRing(p,r));
      if (rings.some(r=>prior.some(p=>ringsTouch(r,p))) || inSolid(rings[0][0],prior) || inSolid(prior[0][0],rings)) return {reason:'overlapping_polygon_parts'};
    }
    for (let i=0;i<rings.length;i++) {
      const weight=Math.abs(signedArea(rings[i]))*(i===0?1:-1), centroid=ringCentroid(rings[i]);
      area+=weight; cx+=centroid[0]*weight; cz+=centroid[1]*weight;
      for (const [x,z] of rings[i]) {bounds.minX=Math.min(bounds.minX,x);bounds.maxX=Math.max(bounds.maxX,x);bounds.minZ=Math.min(bounds.minZ,z);bounds.maxZ=Math.max(bounds.maxZ,z);}
    }
    polygons.push(rings);
  }
  if (area<1) return {reason:'tiny_footprint'};
  // 5 km² is an implausible single building; valid complexes below this stay intact.
  if (area>5_000_000 || bounds.maxX-bounds.minX>10000 || bounds.maxZ-bounds.minZ>10000) return {reason:'implausible_footprint'};
  return {polygons,area,bounds,centroid:[cx/area,cz/area],large:area>100000};
}
export function ownerTile(centroid,tileSize=DEFAULT_TILE_SIZE) {return centroid.map(value=>Math.floor(value/tileSize));}
export function encodeFootprints(polygons,tx,tz,tileSize=DEFAULT_TILE_SIZE) {
  return polygons.map(p=>p.map(r=>r.map(([x,z])=>[Math.round((x-tx*tileSize)/QUANTIZATION),Math.round((z-tz*tileSize)/QUANTIZATION)])));
}
export function decodeFootprints(polygons,tx,tz,tileSize=DEFAULT_TILE_SIZE) {
  return polygons.map(p=>p.map(r=>r.map(([x,z])=>[tx*tileSize+x*QUANTIZATION,tz*tileSize+z*QUANTIZATION])));
}
export function normalizeBuilding(element,{center=CENTER,tileSize=DEFAULT_TILE_SIZE}={}) {
  if (!element || !/^(way|relation):[1-9]\d*$/.test(element.id)) return {reason:'invalid_source_identity'};
  if (!element.tags || !element.tags.building || element.tags.building==='no') return {reason:'not_a_building'};
  let projected;
  try {
    projected=element.polygons.map(p=>p.map(r=>r.map(v=>Array.isArray(v)&&v.length===2&&v.every(Number.isFinite)?project(...v,center):[NaN,NaN])));
  } catch {return {reason:'malformed_polygons'};}
  const geometry=cleanPolygons(projected); if (geometry.reason) return geometry;
  const [tx,tz]=ownerTile(geometry.centroid,tileSize),local=encodeFootprints(geometry.polygons,tx,tz,tileSize);
  const quantized=cleanPolygons(decodeFootprints(local,tx,tz,tileSize));
  if (quantized.reason) return {reason:`quantization_${quantized.reason}`};
  const seed=seedFor(element.id),classification=classify(element.tags);
  const height=normalizeHeight(element.tags,classification.category,seed);
  const roof=normalizeRoof(element.tags,classification.category,height.levels,seed);
  return {id:element.id,tx,tz,local,geometry:quantized,seed,classification,height,roof,tags:element.tags,
    members:element.members??[], flags:(classification.source==='explicit'?FLAGS.explicitCategory:0)
      | (roof.source==='explicit'?FLAGS.explicitRoof:0) | (geometry.large?FLAGS.largeFootprint:0)};
}

// Clip a footprint against a carriageway rectangle. Sum across short road segments
// is an approximate overlap area (adjacent/junction rectangles may overlap).
function clippedArea(ring,rectangle) {
  let points=ring;
  for (let i=0;i<4 && points.length;i++) {
    const a=rectangle[i],b=rectangle[(i+1)%4],output=[];
    for (let j=0;j<points.length;j++) {
      const p=points[j],q=points[(j+1)%points.length],cp=cross(a,b,p),cq=cross(a,b,q);
      if (cp>=0) output.push(p);
      if ((cp>=0)!==(cq>=0)) {const t=cp/(cp-cq);output.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}
    }
    points=output;
  }
  return points.length>=3?Math.abs(signedArea(points)):0;
}
export function roadRectangle(edge) {
  const dx=edge.b[0]-edge.a[0],dz=edge.b[1]-edge.a[1],length=Math.hypot(dx,dz);
  if (!length || !Number.isFinite(edge.width) || edge.width<=0) return null;
  const nx=-dz/length*edge.width/2,nz=dx/length*edge.width/2;
  return [[edge.a[0]-nx,edge.a[1]-nz],[edge.b[0]-nx,edge.b[1]-nz],
    [edge.b[0]+nx,edge.b[1]+nz],[edge.a[0]+nx,edge.a[1]+nz]];
}
export function roadOverlapRatio(geometry,edges) {
  let area=0;
  for (const edge of edges) {
    const rectangle=roadRectangle(edge); if (!rectangle) continue;
    for (const rings of geometry.polygons) {
      area+=clippedArea(rings[0],rectangle);
      for (const hole of rings.slice(1)) area-=clippedArea(hole,rectangle);
    }
  }
  return Math.max(0,Math.min(1,area/geometry.area));
}
