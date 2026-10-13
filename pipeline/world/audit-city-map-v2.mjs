import fs from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const dir='data/generated/city-map-v2',assets='apps/client/dist/assets',html=await fs.readFile('apps/client/dist/index.html','utf8'),entry=html.match(/src="\/assets\/([^" ]+\.js)"/)[1],available=new Set(await fs.readdir(assets)),queue=[entry],seen=new Set(),chunks=[];
while(queue.length){const file=queue.shift();if(seen.has(file))continue;seen.add(file);const bytes=await fs.readFile(`${assets}/${file}`);chunks.push({file,initial:file===entry,raw:bytes.length,gzip:gzipSync(bytes).length});for(const match of bytes.toString('utf8').matchAll(/["'`](?:\.\/|\/?assets\/)([^"'` ]+\.(?:js|css))["'`]/g))if(available.has(match[1]))queue.push(match[1]);}
const baseline=(JSON.parse(await fs.readFile(`${dir}/bundle-before.json`,'utf8'))).chunks.find(c=>c.initial),current=chunks.find(c=>c.initial);assert.ok(current.raw<=baseline.raw*1.01,'Initial bundle grew more than 1%');assert.ok(current.gzip<=baseline.gzip*1.01,'Initial gzip grew more than 1%');
const source=await fs.readFile(`${assets}/${entry}`,'utf8');assert.ok(!source.includes('/data/world/ibadan/map')&&!source.includes('/data/city-map-v2/regions.json'));
const protectedHashes=JSON.parse(await fs.readFile(`${dir}/protected-before.json`,'utf8'));for(const [path,hash] of Object.entries(protectedHashes))assert.equal(createHash('sha256').update(await fs.readFile(path)).digest('hex'),hash,`Protected source changed: ${path}`);
for(const file of ['apps/client/public/data/ibadan-routing-graph.json','apps/client/public/data/ogbomoso-routing-graph.json'])await assert.rejects(fs.access(file));
const report={compression:'Node zlib gzip level 6',baseline,current,delta:{raw:current.raw-baseline.raw,gzip:current.gzip-baseline.gzip},chunks,protectedFiles:Object.keys(protectedHashes),fullRoutingGraphPublic:false};await fs.writeFile(`${dir}/bundle-after.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({baseline,current,delta:report.delta,mapChunks:chunks.filter(c=>/CityMap|MapDesign|OptionalNavigation|POIManager/.test(c.file))},null,2));
