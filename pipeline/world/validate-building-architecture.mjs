// Live game validation using an isolated Chrome instance with --remote-debugging-port=9222.
// Start Vite first, then: node pipeline/world/validate-building-architecture.mjs
import fs from 'node:fs/promises';
const housingValidation=process.argv.includes('--housing');
const output=housingValidation?'data/generated/residential-foundation':'data/generated/building-phase-c';
await fs.mkdir(output,{recursive:true});
const tabs=await(await fetch('http://127.0.0.1:9222/json')).json();
const tab=tabs.find(t=>t.type==='page'&&(t.url==='about:blank'||t.url.includes('5173')));
if(!tab)throw new Error('No local game Chrome tab');
const socket=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
let serial=0;const jobs=new Map(),events=[];
socket.onmessage=({data})=>{const message=JSON.parse(data);if(message.id){jobs.get(message.id)?.(message);jobs.delete(message.id);}else events.push(message);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;jobs.set(id,d=>d.error?reject(new Error(JSON.stringify(d.error))):resolve(d.result));socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function capture(name,view=null){
  await evaluate(`(()=>{const d=cityverseBuildingDebug;d.captureView=${JSON.stringify(view)};if(!d.originalRender){d.originalRender=d.renderer.render;d.renderer.render=function(scene,camera){if(d.captureView){const p=d.player.position,v=d.captureView;camera.position.set(p.x+v[0],p.y+v[1],p.z+v[2]);camera.lookAt(p.x,p.y+v[3],p.z);}return d.originalRender.call(this,scene,camera);};}})()`);
  await pause(700);
  const stats=JSON.parse(await evaluate('JSON.stringify(cityverseBuildingDebug.system.getStats(cityverseBuildingDebug.camera))'));
  if(housingValidation)stats.housing=JSON.parse(await evaluate('JSON.stringify(cityverseBuildingDebug.system.getHousingStats())'));
  const screenshot=await call('Page.captureScreenshot',{format:'png'});
  await fs.writeFile(`${output}/${name}.png`,Buffer.from(screenshot.data,'base64'));
  await fs.writeFile(`${output}/${name}-stats.json`,JSON.stringify(stats,null,2));
  console.log(name,JSON.stringify(stats));
}
try{
  await call('Runtime.enable');await call('Network.enable');await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:960,height:600,deviceScaleFactor:1,mobile:false});
  for(const low of [false,true]){
    if(low||!process.argv.includes('--resume'))await call('Page.navigate',{url:`http://127.0.0.1:5173/?buildingDebug=1${low?'&low':''}${housingValidation?'&housingDebug=1':''}`});
    let ready=false;
    for(let i=0;i<600;i++){
      await pause(1000);
      ready=await evaluate(`Boolean(globalThis.cityverseBuildingDebug?.system.loaded.size===${low?25:49}&&!globalThis.cityverseBuildingDebug.system.updating)`);
      if(ready)break;
      if(i%20===0)console.log('Waiting for',low?'LOW':'NORMAL');
    }
    if(!ready)throw new Error('Building stream did not settle');
    await capture(low?'low-street':'normal-street');
    await capture(low?'low-neighborhood':'normal-neighborhood',[85,75,110,0]);
    await capture(low?'low-dense':'normal-dense',[190,210,260,0]);
  }
  const errors=events.filter(e=>e.method==='Runtime.exceptionThrown'||e.method==='Runtime.consoleAPICalled'&&e.params.type==='error');
  const requests=events.filter(e=>e.method==='Network.requestWillBeSent'&&e.params.request.url.includes('/data/world/')).map(e=>e.params.request.url);
  await fs.writeFile(`${output}/validation-events.json`,JSON.stringify({errors,requests},null,2));
  if(errors.length)throw new Error(`${errors.length} browser errors; inspect validation-events.json`);
}finally{socket.close();}
