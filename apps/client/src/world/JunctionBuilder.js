import * as THREE from 'three';

function cross(a,b,c){return (b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);}
function convexHull(points){
  const sorted=points.slice().sort((a,b)=>a.x-b.x||a.z-b.z),lower=[],upper=[];
  for(const p of sorted){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),p)<=1e-8)lower.pop();lower.push(p);}
  for(const p of sorted.slice().reverse()){while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),p)<=1e-8)upper.pop();upper.push(p);}
  return [...lower.slice(0,-1),...upper.slice(0,-1)];
}

export class JunctionBuilder {
  constructor({surface,roadOffset=0.055,overlap=1.2}={}){Object.assign(this,{surface,roadOffset,overlap});}

  build(junctions){
    const positions=[],uvs=[],colors=[],color=new THREE.Color('#494845');
    for(const junction of junctions){
      const arms=(junction.arms??[]).filter(a=>Math.hypot(a.dirX,a.dirZ)>1e-4&&Number.isFinite(a.width)&&a.width>0);
      if(arms.length<3)continue;
      const boundary=[];
      for(const arm of arms){
        const length=Math.hypot(arm.dirX,arm.dirZ),ux=arm.dirX/length,uz=arm.dirZ/length;
        const mouth=Math.max(junction.radius??3,arm.width*0.6)+this.overlap;
        const nx=-uz,nz=ux,half=arm.width/2;
        for(const side of [-1,1])boundary.push({x:junction.x+ux*mouth+nx*half*side,z:junction.z+uz*mouth+nz*half*side});
      }
      const hull=convexHull(boundary);if(hull.length<3)continue;
      const plan=this.surface.junctions?.get(junction.junctionId??`${junction.x}_${junction.z}`);
      const approachHeights=arms.map(a=>{const n=Math.hypot(a.dirX,a.dirZ);return this.surface.smoothTerrainHeight(junction.x,junction.z,a.dirX/n,a.dirZ/n);}).filter(Number.isFinite);
      const base=plan?.height??(approachHeights.reduce((s,v)=>s+v,0)/(approachHeights.length||1));
      const y=base+this.roadOffset;
      // Chamfer hull corners. The shared flat apron joins road profiles that
      // remain at this elevation inside half the expanded junction reach.
      const ring=[];
      for(let i=0;i<hull.length;i++){
        const prev=hull[(i+hull.length-1)%hull.length],p=hull[i],next=hull[(i+1)%hull.length];
        const t=Math.min(0.22,0.65/Math.max(0.65,Math.min(Math.hypot(prev.x-p.x,prev.z-p.z),Math.hypot(next.x-p.x,next.z-p.z))));
        for(const q of [prev,next])ring.push({x:p.x+(q.x-p.x)*t,z:p.z+(q.z-p.z)*t});
      }
      const center={x:junction.x,y,z:junction.z};
      for(let i=0;i<ring.length;i++){
        const a=ring[i],b=ring[(i+1)%ring.length];
        if(Math.abs(cross(center,a,b))<1e-7)continue;
        positions.push(center.x,center.y,center.z,a.x,y,a.z,b.x,y,b.z);
        uvs.push(center.x/4,center.z/4,a.x/4,a.z/4,b.x/4,b.z/4);
        for(let v=0;v<3;v++)colors.push(color.r,color.g,color.b);
      }
    }
    if(!positions.length)return null;
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    geometry.computeVertexNormals();return geometry;
  }
}
