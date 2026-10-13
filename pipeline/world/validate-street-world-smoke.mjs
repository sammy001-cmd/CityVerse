import fs from 'node:fs/promises';
const tabs=await(await fetch('http://127.0.0.1:9222/json')).json(),s=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>s.onopen=r);
let n=0;const pending=new Map();s.onmessage=({data})=>{const d=JSON.parse(data);if(d.id){pending.get(d.id)?.(d);pending.delete(d.id);}};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++n;pending.set(id,d=>d.error?reject(Error(JSON.stringify(d.error))):resolve(d.result));s.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;},pause=ms=>new Promise(r=>setTimeout(r,ms));
await call('Page.enable');await call('Network.setCacheDisabled',{cacheDisabled:false});
const results=[];
try{
 const fail=await call('Page.addScriptToEvaluateOnNewDocument',{source:`const originalFetch=window.fetch;window.fetch=function(url,...args){if(String(url).includes('/data/world/ibadan/buildings/manifest.json'))return Promise.resolve(new Response('test optional failure',{status:503}));return originalFetch.call(this,url,...args);};`});
 for(const legacy of [false,true]){
   if(legacy)await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:fail.identifier});
   await call('Page.navigate',{url:'http://127.0.0.1:5173/?startupDebug=1&buildingDebug=1&streetDebug=1'+(legacy?'&streets=legacy':'')});
   let result;
   for(let i=0;i<90;i++){await pause(1000);result=await evaluate(`(()=>{const t=globalThis.cityverseStartupDebug?.getStats().milestones;return {test:'${legacy?'legacy exclusivity':'optional building manifest 503'}',firstPlayable:t?.['first-playable-frame'],completion:t?.['optional-world-completion'],streetGroup:Boolean(globalThis.cityverseBuildingDebug?.scene.children.some(g=>g.name==='StreetWorld')),buildingFailure:globalThis.cityverseBuildingDebug?.system.getStats().failures??0};})()`);if(result?.completion)break;}
   if(!result.firstPlayable||!result.completion)throw Error('Smoke test did not become playable: '+JSON.stringify(result));
   if(legacy&&result.streetGroup)throw Error('Legacy and new Street World coexist');
   if(!legacy&&result.buildingFailure===0)throw Error('Failure injection was not exercised');
   results.push(result);console.log(result);
 }
 await fs.writeFile('data/generated/street-world/smoke-tests.json',JSON.stringify(results,null,2));
}finally{s.close();}
