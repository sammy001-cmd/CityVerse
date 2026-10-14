// Tier A foundation. Call only for an active landmark/LOD; opening CityMap
// never imports this module or requests a GLB. Intake reports bind to file bytes.
export async function loadLandmarkAsset(url, report, {fetcher=globalThis.fetch, signal}={}){
  if(!report?.valid||!/^[a-f0-9]{64}$/.test(report.sha256??'')||!/^\/assets\/models\/landmarks\/[a-z0-9/_-]+\.glb$/.test(url))throw Error('Landmark asset requires a valid intake report and local GLB path');
  const start=performance.now(),response=await fetcher(url,{signal});
  if(!response.ok)throw Error(`Landmark asset unavailable: ${response.status}`);
  const declared=Number(response.headers?.get('content-length'));
  if(declared>report.bytes){await response.body?.cancel();throw Error('Landmark response exceeds validated size');}
  let bytes;
  if(response.body?.getReader){
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>report.bytes||size>report.limits.bytes){await reader.cancel();throw Error('Landmark stream exceeds validated size');}chunks.push(value);}}
    finally{reader.releaseLock();}
    const joined=new Uint8Array(size);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}bytes=joined.buffer;
  }else bytes=await response.arrayBuffer();
  if(bytes.byteLength!==report.bytes||bytes.byteLength>report.limits.bytes)throw Error('Landmark asset size differs from validation report');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==report.sha256)throw Error('Landmark asset differs from validated bytes');
  const fetched=performance.now();
  const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
  const gltf=await new GLTFLoader().parseAsync(bytes,'');
  return {object:gltf.scene,metrics:{fetchMs:fetched-start,decodeMs:performance.now()-fetched,bytes:bytes.byteLength,triangles:report.triangles,textureBytes:report.textureBytes},dispose(){const materials=new Set(),textures=new Set();gltf.scene.traverse(o=>{o.geometry?.dispose();for(const material of [o.material].flat()){if(!material)continue;materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);}});for(const texture of textures)texture.dispose();for(const material of materials)material.dispose();}};
}
