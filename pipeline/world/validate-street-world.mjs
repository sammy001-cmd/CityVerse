import fs from 'node:fs/promises';
const output='data/generated/street-world',before=process.argv.includes('--before');
const screensOnly=process.argv.includes('--screens-only');
await fs.mkdir(output,{recursive:true});
const tabs=await(await fetch('http://127.0.0.1:9222/json')).json();
const socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.onopen=r);
let n=0;const pending=new Map(),events=[];
socket.onmessage=({data})=>{const d=JSON.parse(data);if(d.id){pending.get(d.id)?.(d);pending.delete(d.id);}else events.push(d);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++n;pending.set(id,d=>d.error?reject(Error(JSON.stringify(d.error))):resolve(d.result));socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
await call('Emulation.setDeviceMetricsOverride',{width:960,height:600,deviceScaleFactor:1,mobile:false});
await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.validation={longTasks:[],firstPlayable:null};new PerformanceObserver(list=>validation.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});const poll=()=>{if(validation.firstPlayable===null&&document.querySelector('canvas')&&!document.body.innerText.includes('Loading Ibadan')&&!document.body.innerText.includes('Loading real')&&!document.body.innerText.includes('Starting physics')&&!document.body.innerText.includes('Building the city')&&!document.body.innerText.includes('Loading navigation')&&!document.body.innerText.includes('Loading production')&&document.body.innerText.includes('WASD'))validation.firstPlayable=performance.now();requestAnimationFrame(poll);};requestAnimationFrame(poll);`});
try{
 for(const low of before?[false]:[false,true])for(const cold of screensOnly?[false]:[true,false]){
  events.length=0;
  if(cold)await call('Network.clearBrowserCache');
  await call('Network.setCacheDisabled',{cacheDisabled:cold});
  const tag=`${before?'before':'after'}-${low?'low':'normal'}-${cold?'cold':'warm'}`;
  await call('Page.navigate',{url:`http://127.0.0.1:5173/?buildingDebug=1&startupDebug=1&streetDebug=1${low?'&low':''}`});
  let ready=false;
  for(let i=0;i<600;i++){await pause(1000);ready=await evaluate(`Boolean(globalThis.cityverseBuildingDebug?.system.loaded.size===${low?25:49}&&!cityverseBuildingDebug.system.updating${before?'':`&&globalThis.cityverseStreetDebug?.system.loaded.size===${low?9:25}&&!cityverseStreetDebug.system.running&&globalThis.cityverseStartupDebug?.getStats().milestones['optional-world-completion']&&cityverseBuildingDebug.system.getBuildingCount()===${low?2744:6420}`})`);if(ready)break;if(i%30===0)console.log('waiting',tag);}
  if(!ready)throw Error(`World did not settle: ${tag}`);
  const result=JSON.parse(await evaluate(`JSON.stringify({validation, startup:globalThis.cityverseStartupDebug?.getStats(),roadTimings:globalThis.cityverseStartupDebug?.getRoadTimings?.(),roads:{tiles:cityverseBuildingDebug.roadSystem.loaded.size,radius:cityverseBuildingDebug.roadSystem.loadRadius},buildings:cityverseBuildingDebug.system.getStats(cityverseBuildingDebug.camera),street:globalThis.cityverseStreetDebug?.system.getStats(cityverseBuildingDebug.camera),housing:cityverseBuildingDebug.system.getHousingStats(),resources:performance.getEntriesByType('resource').map(e=>({name:e.name,start:e.startTime,duration:e.duration,bytes:e.encodedBodySize}))})`));
  result.errors=events.filter(e=>e.method==='Runtime.exceptionThrown'||e.method==='Runtime.consoleAPICalled'&&e.params.type==='error');
  if(!screensOnly)await fs.writeFile(`${output}/${tag}.json`,JSON.stringify(result,null,2));console.log(tag,JSON.stringify({firstPlayable:result.startup?.milestones?.['first-playable-frame']??result.validation.firstPlayable,street:result.street,errors:result.errors.length}));
  if(result.errors.length)throw Error(`Browser errors in ${tag}`);
  if(!before&&!cold){
   const debugShot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(`${output}/${low?'low':'normal'}-debug.png`,Buffer.from(debugShot.data,'base64'));
   const views=await evaluate(`(()=>{
     const d=cityverseBuildingDebug,origin={x:d.player.position.x,z:d.player.position.z},distance=p=>Math.hypot(p.x-origin.x,p.z-origin.z);
     const roadView=(name,types)=>{const e=d.roadSystem.getRoadEdges().filter(e=>types.includes(e.type)).sort((a,b)=>distance({x:(a.a[0]+a.b[0])/2,z:(a.a[1]+a.b[1])/2})-distance({x:(b.a[0]+b.b[0])/2,z:(b.a[1]+b.b[1])/2}))[0];if(!e)return null;const x=(e.a[0]+e.b[0])/2,z=(e.a[1]+e.b[1])/2,n=Math.hypot(e.b[0]-e.a[0],e.b[1]-e.a[1]),ux=(e.b[0]-e.a[0])/n,uz=(e.b[1]-e.a[1])/n;return {name,x,z,camera:[x-ux*12,3,z-uz*12],target:[x+ux*14,1.5,z+uz*14],roadId:e.roadId,roadClass:e.type};};
     const frontage=(name,tiers)=>{const b=d.system.getBuildings().filter(b=>tiers.includes(b.housing?.qualityTier)&&b.frontage&&b.frontage.distance<45).sort((a,b)=>distance({x:a.frontage.point[0],z:a.frontage.point[1]})-distance({x:b.frontage.point[0],z:b.frontage.point[1]}))[0];if(!b)return null;const [x,z]=b.frontage.point,cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2,n=Math.hypot(cx-x,cz-z);return {name,x,z,camera:[x-(cx-x)/n*5,3.5,z-(cz-z)/n*5],target:[cx,1.7,cz],buildingId:b.id,proceduralTier:b.housing.qualityTier};};
     const j=[...d.roadSystem.tileData.values()].flatMap(t=>t.junctions??[]).sort((a,b)=>distance(a)-distance(b))[0];
     return [roadView('residential',['residential','living_street']),roadView('major-road',['primary','secondary','tertiary','trunk']),j?{name:'junction',x:j.x,z:j.z,camera:[j.x-18,15,j.z+25],target:[j.x,0,j.z]}:null,frontage('upper-mid-frontage',[3,4,5]),frontage('affordable-standard',[1,2]),{name:'dense',...origin,camera:[origin.x+190,210,origin.z+260],target:[origin.x,0,origin.z]}].filter(Boolean);
   })()`);
   await evaluate("document.querySelectorAll('pre').forEach(e=>e.style.display='none')");
   const captures=[];
   for(const view of views){
     await evaluate(`(async()=>{const d=cityverseBuildingDebug,v=${JSON.stringify(view)};
       d.player.position.set(v.x,d.system.worldSurface.heightAt(v.x,v.z),v.z);
       await d.roadSystem.update(v.x,v.z);await d.system.update(v.x,v.z);await cityverseStreetDebug.system.update(v.x,v.z);
       if(!d.savedRender)d.savedRender=d.renderer.render;
       d.renderer.render=function(scene,camera){const y=d.system.worldSurface.heightAt(v.x,v.z);camera.position.set(v.camera[0],y+v.camera[1],v.camera[2]);camera.lookAt(v.target[0],d.system.worldSurface.heightAt(v.target[0],v.target[2])+v.target[1],v.target[2]);return d.savedRender.call(this,scene,camera);};
     })()`);
     await pause(600);const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(`${output}/${low?'low':'normal'}-${view.name}.png`,Buffer.from(shot.data,'base64'));
     captures.push({...view,stats:await evaluate('cityverseStreetDebug.system.getStats(cityverseBuildingDebug.camera)')});
   }
   await fs.writeFile(`${output}/${low?'low':'normal'}-captures.json`,JSON.stringify(captures,null,2));
  }
 }
}finally{socket.close();}
