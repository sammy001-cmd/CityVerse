export const MAP_PALETTE={land:'#eee9df',residential:'#dedbce',commercial:'#e9d8c1',retail:'#e9d8c1',industrial:'#d4d4d0',institution:'#dbe2db',park:'#c5d9b4',water:'#a9ced9',river:'#8fbdce',player:'#168eb6',destination:'#dc6047',ink:'#263e3e',muted:'#6a7770',roadOutline:'#c9c5b6'};
export const CATEGORY_COLORS={hospital:'#bb5265',clinic:'#bb5265',pharmacy:'#bb5265',food:'#a86c37',fuel:'#927322',university:'#3c7d6b',school:'#3c7d6b',bank:'#6e6594',atm:'#6e6594',park:'#4d8053',sports:'#4d8053',landmark:'#317568',mall:'#876745',market:'#876745'};
export const CATEGORY_GLYPHS={hospital:'+',clinic:'+',pharmacy:'+',food:'F',fuel:'F',university:'U',school:'S',bank:'B',atm:'B',park:'P',sports:'S',landmark:'★',hotel:'H',mall:'M',market:'M',transport:'T',government:'G'};
export const CATEGORY_GROUPS={Food:['food'],Health:['hospital','clinic','pharmacy'],Fuel:['fuel'],Shopping:['mall','supermarket','market','shop']};
export function roadStyle(type){const family=type?.replace('_link',''),rank=['motorway','trunk'].includes(family)?0:family==='primary'?1:family==='secondary'?2:family==='tertiary'?3:['residential','unclassified','living_street'].includes(family)?4:5;
  return {rank,color:['#cc9861','#dbb779','#f7f2d9','#fffdf2','#fffdf4','#e8e4d9'][rank],width:[4.5,3.8,3,2.3,1.7,1][rank]};}
export const categoryLabel=value=>String(value??'place').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
// Walking yaw faces -Z; the existing vehicle public heading faces +Z.
export const mapBearing=(heading=0,driving=false)=>driving?Math.PI-heading:-heading;
export const destinationDistance=(player,destination)=>destination?Math.hypot(destination.x-player.x,destination.z-player.z):null;
export const formatDistance=metres=>metres>=1000?`${(metres/1000).toFixed(1)} km`:`${Math.round(metres)} m`;
export class LabelLayout {
  constructor(limit=48){this.limit=limit;this.boxes=[];this.obstacles=[];this.names=new Set();}
  intersects(b){return [...this.boxes,...this.obstacles].some(a=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y);}
  block(x,y,width,height){this.obstacles.push({x:x-width/2,y:y-height/2,w:width,h:height});}
  reserve(name,x,y,width,height=18){if(this.boxes.length>=this.limit||this.names.has(name))return false;const b={x:x-width/2-4,y:y-height/2-3,w:width+8,h:height+6};if(this.intersects(b))return false;this.boxes.push(b);this.names.add(name);return true;}
}
