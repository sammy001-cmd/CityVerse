import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const clientRequire=createRequire(new URL('../../apps/client/package.json',import.meta.url));

// GLB intake contract shared with future vehicle/furniture/venue imports.
// Geometry bounds and orientation require an exporter declaration, then review.
export function validateAsset(document, bytes, contract={}) {
  const errors=[];
  const limits={bytes:20*1024*1024,triangles:100000,textureSize:2048,textureBytes:64*1024*1024,materials:32,...contract.limits};
  const buffers=document.buffers??[],views=document.bufferViews??[],accessors=document.accessors??[];
  let triangles=0;
  for(const mesh of document.meshes??[])for(const p of mesh.primitives??[]){
    const a=accessors[p.indices??p.attributes?.POSITION];
    if((p.mode??4)!==4)errors.push('Only triangle primitives are supported');
    if(!a||!Number.isSafeInteger(a.count)||a.count<3||a.count%3!==0)errors.push('Missing or invalid triangle accessor');
    else triangles+=a.count/3;
    if(p.material!==undefined&&!document.materials?.[p.material])errors.push('Invalid material');
  }
  if(!document.asset?.version?.startsWith('2.'))errors.push('Requires glTF 2');
  if(buffers.some(b=>b.uri))errors.push('GLB must embed buffers');
  if((document.images??[]).some(i=>i.uri))errors.push('GLB must embed images');
  if(bytes>limits.bytes)errors.push('Asset byte budget exceeded');
  if(triangles>limits.triangles)errors.push('Triangle budget exceeded');
  if(contract.metresPerUnit!==1)errors.push('Declare metresPerUnit: 1');
  if(contract.upAxis!=='+Y'||contract.forwardAxis!=='+Z')errors.push('Declare +Y up / +Z forward');
  if(contract.pivot!=='ground-center')errors.push('Declare ground-center pivot');
  if(!Array.isArray(contract.lods)||!['near','medium','far'].every(l=>contract.lods.includes(l)))errors.push('Declare near/medium/far LOD assets');
  if(!['box','capsule','convex','compound'].includes(contract.collision))errors.push('Declare simplified collision');
  const images=document.images??[];
  if(images.length&&(!Array.isArray(contract.textures)||contract.textures.length!==images.length))errors.push('Texture dimensions must be inspected for every image');
  for(const t of contract.textures??[])if(!Number.isInteger(t.width)||!Number.isInteger(t.height)||Math.min(t.width,t.height)<=0||Math.max(t.width,t.height)>limits.textureSize)errors.push('Texture budget/dimensions invalid');
  const textureBytes=(contract.textures??[]).reduce((sum,t)=>sum+t.width*t.height*4*4/3,0);
  if(textureBytes>limits.textureBytes)errors.push('Texture memory budget exceeded');
  if((document.materials?.length??0)>limits.materials)errors.push('Material budget exceeded');
  for(const v of views)if(!Number.isInteger(v.byteLength)||v.byteLength<0||v.byteOffset<0)errors.push('Invalid buffer view');
  return {valid:errors.length===0,bytes,triangles,textureBytes,materials:document.materials?.length??0,images:images.length,limits,errors,contract,reviewRequired:['Confirm declared orientation, physical dimensions and pivot against reference before publishing']};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [file,contractFile,reportFile]=process.argv.slice(2);
  if(!file||!contractFile||!reportFile)throw Error('Usage: node pipeline/world/validate-landmark-asset.mjs model.glb contract.json report.json');
  try {
  const data=await fs.readFile(file);
  if(data.length<20||data.readUInt32LE(0)!==0x46546c67||data.readUInt32LE(4)!==2||data.readUInt32LE(8)!==data.length||data.readUInt32LE(16)!==0x4e4f534a)throw Error('Invalid GLB header');
  const length=data.readUInt32LE(12);if(20+length>data.length)throw Error('Truncated GLB JSON');
  const document=JSON.parse(data.subarray(20,20+length).toString('utf8'));
  const contract=JSON.parse(await fs.readFile(contractFile,'utf8'));
  // Inspect embedded image bytes rather than trusting declared texture sizes.
  const binStart=20+length;
  if(document.images?.length){
    const sharp=clientRequire('sharp');
    if(binStart+8>data.length||data.readUInt32LE(binStart+4)!==0x004e4942)throw Error('Missing GLB BIN chunk');
    contract.textures=[];
    for(const image of document.images){
      const view=document.bufferViews?.[image.bufferView];if(!view)throw Error('Missing embedded image buffer view');
      const start=binStart+8+(view.byteOffset??0),end=start+view.byteLength;
      if(end>data.length)throw Error('Truncated embedded image');
      const {width,height}=await sharp(data.subarray(start,end)).metadata();contract.textures.push({width,height});
    }
  }
  const report=validateAsset(document,data.length,contract);
  report.sha256=createHash('sha256').update(data).digest('hex');
  await fs.writeFile(reportFile,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));if(!report.valid)process.exitCode=1;
  }catch(error){
    const report={valid:false,source:file,errors:[error.message]};
    await fs.writeFile(reportFile,JSON.stringify(report,null,2));console.error(JSON.stringify(report));process.exitCode=1;
  }
}
