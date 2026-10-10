import * as THREE from 'three';

export function packGeometry(geometry,transfers) {
  const attributes={};
  for(const [name,attribute] of Object.entries(geometry.attributes)) {
    // Clone to leave worker's cached geometry intact for later tile transactions.
    const array=attribute.array.slice(); transfers.push(array.buffer);
    attributes[name]={array,itemSize:attribute.itemSize};
  }
  return {attributes,userData:geometry.userData};
}
export function unpackGeometry(data) {
  const geometry=new THREE.BufferGeometry();
  for(const [name,attribute] of Object.entries(data.attributes)) geometry.setAttribute(name,new THREE.BufferAttribute(attribute.array,attribute.itemSize));
  geometry.userData=data.userData; return geometry;
}
export function packGroup(group,transfers) {
  return {name:group.name,userData:group.userData,meshes:group.children.map((mesh) =>
    ({name:mesh.name,userData:mesh.userData,geometry:packGeometry(mesh.geometry,transfers)}))};
}
export function unpackGroup(data,materials) {
  const group=new THREE.Group();group.name=data.name;group.userData=data.userData;
  for(const value of data.meshes) {
    const mesh=new THREE.Mesh(unpackGeometry(value.geometry),materials[value.userData.part]);
    mesh.name=value.name;mesh.userData=value.userData;mesh.receiveShadow=true;group.add(mesh);
  }
  return group;
}
