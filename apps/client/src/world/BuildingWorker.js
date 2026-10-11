import {buildBuildingGeometry} from './BuildingGeometry.js';
import {packGeometry} from './RoadWorldTransfer.js';
self.onmessage=({data})=>{
  try {
    const transfers=[],geometry=buildBuildingGeometry(data.records,data.lod);
    const packed=geometry.map(g=>g?packGeometry(g,transfers):null);
    geometry.forEach(g=>g?.dispose());self.postMessage({id:data.id,geometry:packed},transfers);
  } catch(error) {self.postMessage({id:data.id,error:String(error)});}
};
