// Repeatable dense geometry/fallback benchmark, not a browser FPS benchmark.
// node pipeline/world/benchmark-building-runtime.mjs
import fs from 'node:fs/promises';
import {BuildingSystem} from '../../apps/client/src/world/BuildingSystem.js';

const fetcher=async url=>{
  try {
    const text=await fs.readFile(`apps/client/public${url}`,'utf8');
    return {ok:true,text:async()=>text,json:async()=>JSON.parse(text)};
  } catch {return {ok:false,status:404};}
};
for(const lowPerformance of [true,false]) {
  const system=await new BuildingSystem({scene:{add(){},remove(){}},worldSurface:{heightAt:()=>0},
    worker:false,lowPerformance,fetcher}).init();
  const started=performance.now();
  await system.update(2625,5125);
  console.log(JSON.stringify({sample:'densest Ibadan tile 10_20; flat test surface; no roads/physics',
    mode:lowPerformance?'LOW':'NORMAL',elapsedMs:performance.now()-started,...system.getStats()},null,2));
  system.dispose();
}
