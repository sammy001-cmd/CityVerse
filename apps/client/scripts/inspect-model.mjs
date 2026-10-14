// Lists every part (material) of a GLB with triangle count and bounds.
//   node scripts/inspect-model.mjs  model.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
const mesh = root.listMeshes()[0];
const rows = [];
for (const p of mesh.listPrimitives()) {
  const pos = p.getAttribute('POSITION'); const idx = p.getIndices();
  const tris = (idx ? idx.getCount() : pos.getCount()) / 3;
  const mn = pos.getMin([]), mx = pos.getMax([]);
  rows.push([p.getMaterial().getName(), tris, mn.map(v=>+v.toFixed(2)), mx.map(v=>+v.toFixed(2)), p.getMaterial().getAlphaMode()]);
}
rows.sort((a,b)=>b[1]-a[1]);
for (const r of rows) console.log(String(r[0]).padEnd(28), String(r[1]).padStart(7), r[4].padEnd(7), 'min', r[2].join(','), 'max', r[3].join(','));
console.log('textures', root.listTextures().map(t=>[t.getURI()||t.getName(), t.getSize()?.join('x')]).slice(0,40));
