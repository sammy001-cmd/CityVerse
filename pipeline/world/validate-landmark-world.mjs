import fs from 'node:fs/promises';
const output='data/generated/landmark-world-v1';await fs.mkdir(output,{recursive:true});
const tabs=await(await fetch('http://127.0.0.1:9222/json')).json();
const tab=tabs.find(t=>t.type==='page'&&(t.url==='about:blank'||t.url.includes('5175')));if(!tab)throw Error('Open an isolated local Chrome tab');
const socket=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
let id=0;const jobs=new Map(),events=[];
socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){jobs.get(m.id)?.(m);jobs.delete(m.id);}else if(['Runtime.exceptionThrown','Log.entryAdded'].includes(m.method))events.push(m);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{jobs.delete(n);reject(Error(`Timed out: ${method}`));},60000);jobs.set(n,m=>{clearTimeout(timer);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result);});socket.send(JSON.stringify({id:n,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const capture=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(`${output}/${name}.png`,Buffer.from(r.data,'base64'));};
try{
 await call('Runtime.enable');await call('Log.enable');await call('Page.enable');await call('Network.enable');
 await call('Emulation.setDeviceMetricsOverride',{width:960,height:600,deviceScaleFactor:1,mobile:false});
 const results=[];
 for(const low of [false,true]){
  await call('Page.navigate',{url:`http://127.0.0.1:5175/?worldSafetyDebug=1&landmarkDebug=1&buildingDebug=1&startupDebug=1&mapDebug=1${low?'&low':''}`});
  let ready=false;
  for(let i=0;i<180;i++){await pause(1000);ready=await evaluate('Boolean(globalThis.cityverseLandmarkDebug?.system.loaded.size)');if(ready)break;}
  if(!ready)throw Error('World did not reach playable landmark stage: '+await evaluate('document.body.innerText'));
  await pause(2000);
  const startup=await evaluate('globalThis.cityverseStartupDebug?.getStats?.().milestones??null');
  const resources=await evaluate("performance.getEntriesByType('resource').filter(r=>/Landmark|landmarks|CityMap|city-map-v2|map\\/|search-index/.test(r.name)).map(r=>({url:r.name,start:r.startTime,ms:r.duration,bytes:r.encodedBodySize}))");
  const safety=await evaluate('(()=>{const d=cityverseWorldSafetyDebug;return {safe:d.system.lastSafe&&{x:d.system.lastSafe.x,y:d.system.lastSafe.y,z:d.system.lastSafe.z},recoveries:d.system.recoveries};})()');
  await evaluate('cityverseWorldSafetyDebug.player.position.y=-100');await pause(300);
  const recovery=await evaluate('(()=>{const d=cityverseWorldSafetyDebug;return {y:d.player.position.y,recoveries:d.system.recoveries,reason:d.system.reason};})()');
  await capture(`${low?'low':'normal'}-recovery`);
  // Move within the active patch toward its north edge; wait for streaming handover.
  await evaluate('(()=>{const d=cityverseWorldSafetyDebug,b=d.getSurface().loadedBounds();d.player.position.z=b.minZ+200;})()');
  for(let i=0;i<90;i++){await pause(1000);if(await evaluate('cityverseWorldSafetyDebug.getSurface().loadedBounds().minZ < -750'))break;}
  const handover=await evaluate('cityverseWorldSafetyDebug.getSurface().loadedBounds()');
  await capture(`${low?'low':'normal'}-boundary`);
  const landmarks=await evaluate('cityverseLandmarkDebug.getStats()');
  results.push({low,startup,resources,safety,recovery,handover,landmarks});
  await fs.writeFile(`${output}/live-report.json`,JSON.stringify({results,events},null,2));
  console.log(JSON.stringify({low,startup,recovery,handover,landmarkBatches:landmarks.loaded.length}));
 }
 await fs.writeFile(`${output}/live-report.json`,JSON.stringify({results,events},null,2));
}finally{socket.close();}
