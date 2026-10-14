import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const output='data/generated/landmark-world-v1';await fs.mkdir(output,{recursive:true});
const tabs=await(await fetch('http://127.0.0.1:9222/json')).json(),tab=tabs.find(t=>t.url.includes('5175'));
if(!tab)throw Error('Run validate-landmark-world.mjs first');
const socket=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>socket.onopen=r);
let serial=0;const pending=new Map();socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;const timeout=setTimeout(()=>reject(Error(method+' timed out')),60000);pending.set(id,m=>{clearTimeout(timeout);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result);});socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const capture=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(`${output}/${name}.png`,Buffer.from(r.data,'base64'));};
async function visit(x,z){
 for(let i=0;i<90;i++){
  const reached=await evaluate(`(()=>{const d=cityverseWorldSafetyDebug,b=d.getSurface().loadedBounds(),p=d.player.position;const x=Math.max(b.minX+200,Math.min(b.maxX-200,${x})),z=Math.max(b.minZ+200,Math.min(b.maxZ-200,${z}));const state=d.getSurface().coverageAt(x,z,{roadColliders:cityverseBuildingDebug.system.roadSystem.colliderManager});if(state.valid&&state.collider)p.set(x,state.height,z);return Math.hypot(p.x-(${x}),p.z-(${z}))<2;})()`);
  if(reached){await evaluate('cityverseBuildingDebug.system.update(cityverseMapDebug.player.position.x,cityverseMapDebug.player.position.z)');await pause(1000);return;}
  await pause(1000);
 }
 throw Error(`Terrain did not stream to ${x},${z}`);
}
const parkOnly=process.argv.includes('--park-only');
const records=parkOnly?JSON.parse(await fs.readFile(`${output}/landmark-captures.json`,'utf8')).filter(r=>r.key!=='agodi'):[];
try{
 await call('Page.enable');
 for(const low of parkOnly?[false]:[false,true]){
  await call('Page.navigate',{url:`http://127.0.0.1:5175/?worldSafetyDebug=1&landmarkDebug=1&buildingDebug=1&mapDebug=1${low?'&low':''}`});
  let ready=false;for(let i=0;i<180;i++){await pause(1000);if(await evaluate('Boolean(globalThis.cityverseLandmarkDebug?.system.loaded.size)')){ready=true;break;}}assert.ok(ready);
  await evaluate(`(()=>{document.querySelectorAll('pre').forEach(e=>e.style.visibility='hidden');for(const e of document.body.children)if(e.textContent.startsWith('BUILDINGS '))e.style.visibility='hidden';const d=cityverseBuildingDebug,render=d.renderer.render.bind(d.renderer);d.renderer.render=(scene,camera)=>{if(d.capture){const {x,y,z,tx,ty,tz}=d.capture;camera.position.set(x,y,z);camera.lookAt(tx,ty,tz);}return render(scene,camera);};})()`);
  for(const [id,key,height] of [['osm:way:1283222827','cocoa',65],['osm:way:82467201','uch',12],['osm:way:373337181','agodi',6]]){
   if(parkOnly&&key!=='agodi')continue;
   if(low&&key!=='cocoa')continue;
   const place=await evaluate(`cityverseLandmarkDebug.registry.get(${JSON.stringify(id)})`);assert.ok(place);
   for(const [range,offset,elevation] of [['far',380,130],['medium',170,65],['street',65,12]]){
    if(low&&range!=='street')continue;
    const placement=low?25:key==='agodi'?(range==='far'?650:range==='medium'?350:offset):offset;
    await visit(place.x+placement,place.z+placement/3);
    await evaluate(`(()=>{const d=cityverseBuildingDebug,s=cityverseWorldSafetyDebug.getSurface(),y=s.heightAt(${place.x},${place.z}),ground=s.heightAt(${place.x+offset},${place.z-offset/2});d.capture={x:${place.x+offset},y:Math.max(y,ground)+${elevation},z:${place.z-offset/2},tx:${place.x},ty:y+${height},tz:${place.z}};})()`);
    await pause(1500);await capture(`${low?'low':'normal'}-${key}-${range}`);
    const stats=await evaluate('cityverseLandmarkDebug.getStats()');records.push({low,key,range,stats});
    await fs.writeFile(`${output}/landmark-captures.json`,JSON.stringify(records,null,2));console.log(low,key,range,stats.loaded.length);
   }
   if(!low&&key==='cocoa'){
    await evaluate(`(async()=>{await cityverseMapDebug.open();const m=cityverseMapDebug.map;await m.selectSearchResult(m.data.registry.get(${JSON.stringify(id)}));})()`);
    await pause(1500);await capture('normal-citymap-cocoa');
    const selected=await evaluate('({id:cityverseMapDebug.map.selected.id,x:cityverseMapDebug.map.selected.x,z:cityverseMapDebug.map.selected.z})');
    assert.equal(selected.id,id);assert.equal(selected.x,place.x);assert.equal(selected.z,place.z);
    await evaluate("document.querySelector('.city-map-destination').click()");
    const destination=await evaluate('cityverseMapDebug.destination');assert.equal(destination.id,id);assert.equal(destination.x,place.x);assert.equal(destination.z,place.z);
    records.push({selected,destination});await fs.writeFile(`${output}/landmark-captures.json`,JSON.stringify(records,null,2));
   }
  }
 }
}finally{socket.close();}
