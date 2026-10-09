// EXAMPLE: how the Suzuki Carry was prepared for the game. Copy this file and edit it for each new vehicle.
//   node scripts/optimize-vehicle-example.mjs  input.glb  output.glb
// Setup:  npm install -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
// The part names in DROP / WHEEL / BODY_RATIO and the matrix M are specific to the Carry model.
// Run  node scripts/inspect-model.mjs input.glb  first to list a new model's parts, then edit those lists.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weldPrimitive, simplifyPrimitive, transformPrimitive, compactPrimitive, dedup, prune, textureCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2] ?? 'van_raw.glb');
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const scene = root.listScenes()[0];
const srcMesh = root.listMeshes()[0];
const srcNode = root.listNodes()[0];

// 1) bake the node's Z-up -> Y-up rotation into the vertices (x, y, z) -> (x, -z, y)
const M = [1, 0, 0, 0,  0, 0, 1, 0,  0, -1, 0, 0,  0, 0, 0, 1];
for (const p of srcMesh.listPrimitives()) transformPrimitive(p, M, true);
srcNode.setMatrix([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);

// 2) decide what to do with each part
const DROP = new Set(['CHASSIS.007','AE86_SPRING.001','AE86_SUSP.003','brakedisc.007','FM3_CALIPERRS.003','Material_#10831.007',
  'S13TBS_BLUE1.001','S13TBS_BLUE2.003','S13TBS_BLACK1.003','S13TBS_BLACK3.001']);
const WHEEL = new Set(['Tyre.007','EXT_rim.007','_WatanabeMaterial__1953.007']);

const bodyPrims = [], wheelPrims = [];
for (const p of srcMesh.listPrimitives()) {
  const name = p.getMaterial().getName();
  if (DROP.has(name)) { srcMesh.removePrimitive(p); p.dispose(); }
  else if (WHEEL.has(name)) { srcMesh.removePrimitive(p); wheelPrims.push(p); }
  else bodyPrims.push(p);
}

// 3) weld + simplify the body
const BODY_RATIO = { 'MAINBODY.007': 0.2, 'black.009': 0.12, 'MAINBODY_INT.007': 0.08, 'Black.007': 0.12, 'MAINBODY_INT_SHEET02.007': 0.12 };
for (const p of bodyPrims) {
  weldPrimitive(p);
  const name = p.getMaterial().getName();
  const ratio = BODY_RATIO[name] ?? (p.getIndices().getCount() > 1500 ? 0.3 : 1);
  if (ratio < 1) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error: 0.01, lockBorder: false });
}

// 4) split the wheel parts into 4 separate wheel nodes, pivot at each wheel's centre
const names = { FL: [1, 1], FR: [-1, 1], RL: [1, -1], RR: [-1, -1] };  // [x sign (+x = left), front(+)/rear(-)]
const MID_Z = -0.17;                                                 // between front and rear axles (model space)
const wheelKey = (x, z) => (x > 0 ? 'L' : 'R') + '' ; // helper not used
const groups = {};                                                   // key -> [{prim, tris}]
for (const p of wheelPrims) {
  weldPrimitive(p);
  const pos = p.getAttribute('POSITION').getArray(), idx = p.getIndices().getArray();
  const buckets = { FL: [], FR: [], RL: [], RR: [] };
  for (let t = 0; t < idx.length; t += 3) {
    let cx = 0, cz = 0;
    for (let k = 0; k < 3; k++) { cx += pos[idx[t + k] * 3]; cz += pos[idx[t + k] * 3 + 2]; }
    cx /= 3; cz /= 3;
    const key = (cz > MID_Z ? 'F' : 'R') + (cx > 0 ? 'L' : 'R');
    buckets[key].push(idx[t], idx[t + 1], idx[t + 2]);
  }
  for (const key of Object.keys(buckets)) {
    if (!buckets[key].length) continue;
    const q = doc.createPrimitive().setMaterial(p.getMaterial());
    for (const sem of p.listSemantics()) q.setAttribute(sem, p.getAttribute(sem).clone());
    q.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(buckets[key])).setBuffer(buffer));
    compactPrimitive(q);
    (groups[key] ??= []).push({ prim: q, material: p.getMaterial().getName() });
  }
  p.dispose();
}

const info = {};
for (const key of Object.keys(names)) {
  const parts = groups[key] || [];
  // wheel centre from the tyre
  const tyre = parts.find((g) => g.material === 'Tyre.007') || parts[0];
  const mn = tyre.prim.getAttribute('POSITION').getMin([]), mx = tyre.prim.getAttribute('POSITION').getMax([]);
  const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
  info[key] = { center: c.map((v) => +v.toFixed(3)), radius: +((mx[1] - mn[1]) / 2).toFixed(3), width: +(mx[0] - mn[0]).toFixed(3) };
  const mesh = doc.createMesh('mesh_' + key);
  for (const g of parts) {
    const pa = g.prim.getAttribute('POSITION'), arr = pa.getArray();
    for (let i = 0; i < arr.length; i += 3) { arr[i] -= c[0]; arr[i + 1] -= c[1]; arr[i + 2] -= c[2]; }
    pa.setArray(arr);
    const ratio = g.material === 'Tyre.007' ? 0.35 : 0.06;
    simplifyPrimitive(g.prim, { simplifier: MeshoptSimplifier, ratio, error: 0.01, lockBorder: false });
    mesh.addPrimitive(g.prim);
  }
  const node = doc.createNode('wheel_' + key).setTranslation(c).setMesh(mesh);
  scene.addChild(node);
}

srcNode.setName('body');
await doc.transform(
  dedup(),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 80 }),
  prune()
);
await io.write(process.argv[3] ?? 'suzuki-carry.glb', doc);

// report
let tris = 0, per = {};
for (const m of doc.getRoot().listMeshes()) {
  let t = 0;
  for (const p of m.listPrimitives()) t += p.getIndices().getCount() / 3;
  per[m.getName() || 'body'] = t; tris += t;
}
console.log('triangles total', tris, per);
for (const p of b0().getMesh().listPrimitives()) console.log('  ', p.getMaterial().getName().padEnd(28), p.getIndices().getCount()/3);
function b0(){ return doc.getRoot().listNodes().find((n)=>n.getName()==='body'); }
console.log('wheel info', JSON.stringify(info));
const b = doc.getRoot().listNodes().find((n) => n.getName() === 'body');
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (const p of b.getMesh().listPrimitives()) { const a = p.getAttribute('POSITION'); const lo = a.getMin([]), hi = a.getMax([]); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], lo[k]); mx[k] = Math.max(mx[k], hi[k]); } }
console.log('body bounds', mn.map((v) => +v.toFixed(2)), mx.map((v) => +v.toFixed(2)));
