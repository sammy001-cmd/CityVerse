import {createBuildingBuilder,appendBuildingRecords,finishBuildingBuilder} from './BuildingMeshData.js';
const yieldWork=()=>new Promise(r=>setTimeout(r,0));
// Serialize cooperative jobs; numeric arrays only, no Three.js objects in this worker.
let queue=Promise.resolve();
self.onmessage=({data})=>{queue=queue.then(async()=>{
  try {
    const start=performance.now(),builder=createBuildingBuilder(data.options),transfers=[];
    let sliceStart=performance.now();
    for(let i=0;i<data.records.length;i+=16){
      appendBuildingRecords(builder,data.records.slice(i,i+16),data.lod);
      // Yield by elapsed work rather than paying a timer for every small chunk.
      if(performance.now()-sliceStart>=4){await yieldWork();sliceStart=performance.now();}
    }
    const result=finishBuildingBuilder(builder);
    for(const g of result.geometry)if(g)for(const a of Object.values(g.attributes))transfers.push(a.array.buffer);
    self.postMessage({id:data.id,...result,workerMs:performance.now()-start},transfers);
  }catch(error){self.postMessage({id:data.id,error:String(error)});}
});};
