// After npm run build:client. Traverse the current entry's references so stale
// files retained in dist cannot inflate the bundle report.
import fs from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
const output='data/generated/street-world',assets='apps/client/dist/assets';
const html=await fs.readFile('apps/client/dist/index.html','utf8');
const entry=html.match(/src="\/assets\/([^"]+\.js)"/)[1];
const available=new Set(await fs.readdir(assets));
const queued=[entry],visited=new Set(),chunks=[];
while(queued.length){
  const file=queued.shift();if(visited.has(file))continue;visited.add(file);
  const buffer=await fs.readFile(`${assets}/${file}`);
  chunks.push({file,initial:file===entry,raw:buffer.length,gzip:gzipSync(buffer).length});
  const expression=/["'`](?:\.\/|\/?assets\/)([^"'` ]+\.js)["'`]/g;
  // Rapier embeds virtual WASM binding module names inside its bundled strings.
  for(const match of buffer.toString('utf8').matchAll(expression))if(available.has(match[1]))queued.push(match[1]);
}
await fs.mkdir(output,{recursive:true});
const baseline={raw:5075166,gzip:1840645,compression:'Node zlib gzip level 6',source:'retained pre-pass index-BS9TgLVv.js'};
const result={compression:'Node zlib gzip level 6',baseline,entry,chunks};
await fs.writeFile(`${output}/bundle-after.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
