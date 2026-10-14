import {MAP_PALETTE as P,roadStyle,mapBearing,destinationDistance,formatDistance} from './MapDesign.js';

// Heading-up rotation used only in vehicles. All inputs are public world metres.
export function minimapPoint(dx,dz,bearing,scale,half,headingUp){
  const angle=headingUp?-bearing:0,c=Math.cos(angle),s=Math.sin(angle);
  return {x:half+(dx*c-dz*s)*scale,y:half+(dx*s+dz*c)*scale};
}
export function destinationIndicator(point,half,padding=18){
  const dx=point.x-half,dy=point.y-half,limit=half-padding;
  const factor=Math.min(1,limit/Math.max(Math.abs(dx),Math.abs(dy),1));
  return {x:half+dx*factor,y:half+dy*factor,offscreen:factor<1,angle:Math.atan2(dy,dx)+Math.PI/2};
}
export class Minimap {
  constructor({graph=null,roadSystem=null,size=220,metresVisible=180,lowPerformance=false}={}){
    Object.assign(this,{graph,roadSystem,size,metresVisible,low:lowPerformance});this.lastRender=-Infinity;
    this.root=document.createElement('div');this.root.className='cityverse-minimap';this.root.setAttribute('aria-label','Nearby streets and destination');
    this.canvas=document.createElement('canvas');this.ctx=this.canvas.getContext('2d');if(!this.ctx)throw Error('Minimap canvas unavailable');
    this.label=document.createElement('div');this.label.className='cityverse-minimap-label';
    this.destinationLabel=document.createElement('div');this.destinationLabel.className='cityverse-minimap-destination';this.destinationLabel.hidden=true;
    this.destinationName=document.createElement('span');this.destinationDistance=document.createElement('strong');this.destinationLabel.append(this.destinationName,this.destinationDistance);
    this.root.append(this.canvas,this.label,this.destinationLabel);document.body.append(this.root);this.resize();
  }
  resize(){const size=window.innerWidth<=700?150:this.size,dpr=Math.min(window.devicePixelRatio||1,this.low?1:1.5);if(size===this.displaySize&&dpr===this.dpr)return;
    this.displaySize=size;this.dpr=dpr;this.root.style.width=`${size}px`;this.canvas.style.width=this.canvas.style.height=`${size}px`;this.canvas.width=this.canvas.height=Math.round(size*dpr);this.label.style.top=`${size-35}px`;this.label.style.bottom='auto';this.lastRender=-Infinity;}
  setDestination(destination){this.destination=destination;this.destinationLabel.hidden=!destination;this.lastRender=-Infinity;}
  update(position){this.position=position;const now=performance.now();if(now-this.lastRender<100)return;this.lastRender=now;this.render(position);}
  nearbyEdges(x,z,now=performance.now()){
    const roads=typeof this.roadSystem==='function'?this.roadSystem():this.roadSystem,cell=`${Math.floor(x/80)}_${Math.floor(z/80)}`;
    if(cell!==this.edgeCell||roads!==this.edgeOwner||now-(this.lastEdgesAt??-Infinity)>=300){this.edgeCell=cell;this.edgeOwner=roads;this.lastEdgesAt=now;const r=this.metresVisible*2;
      this.edges=roads?roads.getRoadEdges({minX:x-r,maxX:x+r,minZ:z-r,maxZ:z+r}):(this.graph?.edges??[]).flatMap(edge=>{const pair=this.graph.getEdgePosition(edge);return pair?[{...edge,a:[pair.from.x,pair.from.z],b:[pair.to.x,pair.to.z]}]:[];});
    }return this.edges??[];
  }
  render({x,z,heading=0,driving=false}){
    const ctx=this.ctx,w=this.displaySize,half=w/2,scale=w/(this.metresVisible*2),bearing=mapBearing(heading,driving),point=(a,b)=>minimapPoint(a-x,b-z,bearing,scale,half,driving);
    ctx.setTransform(this.dpr,0,0,this.dpr,0,0);ctx.fillStyle=P.land;ctx.fillRect(0,0,w,w);
    const edges=this.nearbyEdges(x,z);
    let nearest=null,distance=Infinity;const groups=new Map();
    for(const edge of edges){const rank=roadStyle(edge.type).rank;if(!groups.has(rank))groups.set(rank,[]);groups.get(rank).push(edge);
      const [ax,az]=edge.a,[bx,bz]=edge.b,dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1))),d=Math.hypot(x-ax-t*dx,z-az-t*dz);
      if(d<distance){distance=d;nearest=edge;}
    }
    for(const [,edges] of [...groups].sort(([a],[b])=>b-a)){const style=roadStyle(edges[0].type);for(const outline of [true,false]){ctx.strokeStyle=outline?P.roadOutline:style.color;ctx.lineWidth=style.width+(outline?1:0);ctx.lineCap='round';ctx.beginPath();for(const edge of edges){const a=point(...edge.a),b=point(...edge.b);ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}ctx.stroke();}}
    ctx.save();ctx.translate(half,half);ctx.rotate(driving?0:bearing);ctx.fillStyle=P.player;ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-11);ctx.lineTo(8,8);ctx.lineTo(0,4);ctx.lineTo(-8,8);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
    ctx.save();ctx.translate(w-19,20);ctx.rotate(driving?-bearing:0);ctx.fillStyle=P.muted;ctx.font='bold 10px system-ui';ctx.textAlign='center';ctx.fillText('N',0,-6);ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(4,7);ctx.lineTo(-4,7);ctx.fill();ctx.restore();
    this.label.textContent=nearest?.name??'Nearby streets';this.root.dataset.driving=String(driving);
    if(this.destination){const p=destinationIndicator(point(this.destination.x,this.destination.z),half);ctx.save();ctx.translate(p.x,p.y);ctx.fillStyle=P.destination;ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();if(p.offscreen){ctx.rotate(p.angle);ctx.moveTo(0,-8);ctx.lineTo(6,7);ctx.lineTo(-6,7);ctx.closePath();}else ctx.arc(0,0,6,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();
      this.destinationName.textContent=this.destination.name;this.destinationDistance.textContent=formatDistance(destinationDistance({x,z},this.destination));this.destinationLabel.title=`${this.destination.name} · ${this.destinationDistance.textContent}, straight line`;this.indicator=p;
    }
  }
  getStats(){return {edges:this.edges?.length??0,position:this.position,destination:this.destination,indicator:this.indicator,dpr:this.dpr,driving:this.root.dataset.driving==='true'};}
  destroy(){this.root.remove();}
}
