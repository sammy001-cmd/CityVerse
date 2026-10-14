// Convex polygon operations in X/Z. All interpolated attributes are preserved.
export const cross = (a,b,p) => (b[0]-a[0])*(p[2]-a[2])-(b[2]-a[2])*(p[0]-a[0]);

export function clipHalfPlane(polygon,a,b,inside=true) {
  const result=[];
  if (!polygon.length) return result;
  for (let i=0;i<polygon.length;i++) {
    const p=polygon[i],q=polygon[(i+1)%polygon.length];
    const dp=cross(a,b,p)*(inside ? 1 : -1),dq=cross(a,b,q)*(inside ? 1 : -1);
    if (dp>=0) result.push(p);
    if ((dp>=0)!==(dq>=0)) {
      const t=dp/(dp-dq);
      result.push(p.map((value,index) => value+(q[index]-value)*t));
    }
  }
  return result;
}

export function subtractTriangle(polygon,triangle,allowDegenerate=false) {
  const points=cross(triangle[0],triangle[1],triangle[2])<0 ? [triangle[0],triangle[2],triangle[1]] : triangle;
  let intersection=polygon;
  for (let i=0;i<3 && intersection.length>=3;i++) intersection=clipHalfPlane(intersection,points[i],points[(i+1)%3]);
  if (intersection.length<3 || (!allowDegenerate && polygonArea(intersection)<1e-8)) return [polygon];
  const outside=[];
  let remainder=polygon;
  for (let i=0;i<3 && remainder.length>=3;i++) {
    const a=points[i],b=points[(i+1)%3];
    const part=clipHalfPlane(remainder,a,b,false);
    if (part.length>=3) outside.push(part);
    remainder=clipHalfPlane(remainder,a,b,true);
  }
  return outside;
}

export function polygonArea(polygon) {
  let area=0;
  for (let i=1;i<polygon.length-1;i++) area+=Math.abs(cross(polygon[0],polygon[i],polygon[i+1]))/2;
  return area;
}
