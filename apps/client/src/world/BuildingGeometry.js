import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Two shared tile batches: walls and roofs. No facade details or textures.
export function buildingMaterials() {
  const wall=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.92,side:THREE.DoubleSide});
  const roof=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.65,metalness:0.25,side:THREE.DoubleSide});
  // Small analytical corrugation; no image downloads or per-building textures.
  roof.onBeforeCompile=s=>{s.fragmentShader=s.fragmentShader.replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\n normal = normalize(normal + vec3(0.025*sin(vViewPosition.x*35.0),0.0,0.0));');};
  return [wall,roof];
}
function colored(g,color) {const a=new Float32Array(g.attributes.position.count*3),c=new THREE.Color(color);for(let i=0;i<a.length;i+=3)a.set([c.r,c.g,c.b],i);g.setAttribute('color',new THREE.BufferAttribute(a,3));return g;}
function triangles(points,color) {const g=new THREE.BufferGeometry(),vertices=points.flat(1);g.setAttribute('position',new THREE.Float32BufferAttribute(vertices.flat(),3));g.setAttribute('uv',new THREE.Float32BufferAttribute(vertices.flatMap(p=>[p[0],p[2]]),2));g.computeVertexNormals();return colored(g,color);}
function quad(a,b,c,d,color) {return triangles([[a,b,c],[a,c,d]],color);}
export function buildBuildingGeometry(records,lod) {
  const batches=[[],[]];
  for(const b of records) {
    const palette=['#e4dbc6','#c5ced0','#d3b9a4','#b4b3ab','#bfc7b3'];
    const tint=b.tags?.['building:material']==='concrete'||b.tags?.['building:material']==='brick'?'#a9aaa3':palette[b.seed%palette.length];
    for(const rings of b.polygons) {
      const pts=rings[0], shape=new THREE.Shape(pts.map(([x,z])=>new THREE.Vector2(x,-z)));
      shape.holes=rings.slice(1).map(r=>new THREE.Path(r.map(([x,z])=>new THREE.Vector2(x,-z))));
      const bottom=b.minHeight?b.baseY+b.minHeight:b.foundationBottom-0.2;
      const geo=new THREE.ExtrudeGeometry(shape,{depth:b.baseY+b.height-bottom,bevelEnabled:false,curveSegments:1});geo.rotateX(-Math.PI/2);geo.translate(0,bottom,0);
      const sides=geo.groups[1];
      for(const [name,attribute] of Object.entries(geo.attributes))geo.setAttribute(name,new THREE.BufferAttribute(attribute.array.slice(sides.start*attribute.itemSize,(sides.start+sides.count)*attribute.itemSize),attribute.itemSize));
      // Remove groups: one material per batch, and keep extrusion as collider source.
      geo.clearGroups();batches[0].push(colored(geo,tint));
      let top=b.baseY+b.height;
      const contour=pts.map(p=>new THREE.Vector2(...p)),holes=rings.slice(1).map(r=>r.map(p=>new THREE.Vector2(...p))), all=pts.concat(...rings.slice(1));
      const cap=THREE.ShapeUtils.triangulateShape(contour,holes).map(t=>t.map(i=>[all[i][0],top,all[i][1]]));
      let pitched=false;
      // Exact rectangular footprints get a ridge/hip kit; irregular roofs retain their polygon.
      if(lod!=='far'&&rings.length===1&&pts.length===4&&['gable','hipped'].includes(b.roof)) {
        const [a,c,d,e]=pts;const u=[c[0]-a[0],c[1]-a[1]],v=[e[0]-a[0],e[1]-a[1]],du=Math.hypot(...u),dv=Math.hypot(...v);
        const rectangular=du>1&&dv>1&&Math.abs((u[0]*v[0]+u[1]*v[1])/(du*dv))<0.04&&Math.hypot(d[0]-(c[0]+e[0]-a[0]),d[1]-(c[1]+e[1]-a[1]))<0.4;
        if(rectangular) {
          let corners=[a,c,d,e];if(dv>du) corners=[c,d,e,a];
          const [p,q,r,s]=corners, rise=Math.min(2.4,Math.min(du,dv)*0.23,(b.height-b.minHeight)*0.4,Math.max(0.2,b.height-b.minHeight-b.levels*2.8)),hip=b.roof==='hipped'?0.23:0;
          top-=rise;
          const positions=geo.attributes.position;
          for(let vertex=0;vertex<positions.count;vertex++)positions.setY(vertex,bottom+(positions.getY(vertex)-bottom)*(top-bottom)/(b.baseY+b.height-bottom));
          geo.computeVertexNormals();
          const m=[(p[0]+s[0])/2,(p[1]+s[1])/2],n=[(q[0]+r[0])/2,(q[1]+r[1])/2];
          const P=x=>[x[0],top,x[1]],R=f=>[m[0]+(n[0]-m[0])*f,top+rise,m[1]+(n[1]-m[1])*f];
          batches[1].push(quad(P(p),P(q),R(1-hip),R(hip),'#909b9c'),quad(P(s),R(hip),R(1-hip),P(r),'#909b9c'));
          batches[hip?1:0].push(triangles([[P(p),R(hip),P(s)],[P(q),P(r),R(1-hip)]],hip?'#909b9c':tint));pitched=true;
        }
      }
      if(!pitched)batches[1].push(triangles(cap,b.roof==='flat'?'#aaa79c':'#909b9c'));

    }
  }
  return batches.map(list=>{if(!list.length)return null;const g=mergeGeometries(list);list.forEach(x=>x.dispose());g.deleteAttribute('uv');g.computeBoundingSphere();return g;});
}
