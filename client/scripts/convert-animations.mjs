// Turns Mixamo FBX files into small, animation-only GLB files the game can load.
//
// One-time setup (in the client folder):
//   npm install -D fbx2gltf @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions
//
// Usage:
//   1. Put your Mixamo .fbx files in  client/raw-animations/   (e.g. Walking.fbx, Running.fbx, Breathing Idle.fbx, Jumping Down.fbx)
//   2. node scripts/convert-animations.mjs
//   3. Output goes to public/assets/models/characters/anims/  as idle.glb, walk.glb, run.glb, jump.glb
//
// Files are matched by name: contains "idle" -> idle, "walk" -> walk, "run" -> run, "jump" -> jump.
// Do NOT commit the raw .fbx files (some are 40+ MB): add raw-animations/ to .gitignore.
import { readdir, mkdir, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const require = createRequire(import.meta.url);
const convert = require('fbx2gltf');

const inDir = process.argv[2] || 'raw-animations';
const outDir = process.argv[3] || 'public/assets/models/characters/anims';
await mkdir(outDir, { recursive: true });

const keyFor = (file) => {
  const n = file.toLowerCase();
  for (const k of ['idle', 'walk', 'run', 'jump']) if (n.includes(k)) return k;
  return n.replace(/\.fbx$/, '').replace(/[^a-z0-9]+/g, '_');
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const files = (await readdir(inDir)).filter((f) => f.toLowerCase().endsWith('.fbx'));
if (!files.length) { console.log(`No .fbx files found in ${inDir}/`); process.exit(1); }

for (const file of files) {
  const key = keyFor(file);
  const tmp = path.join(outDir, `_tmp_${key}.glb`);
  const out = path.join(outDir, `${key}.glb`);
  try {
    await convert(path.join(inDir, file), tmp, []);
    const doc = await io.read(tmp);
    const root = doc.getRoot();
    root.listMeshes().forEach((m) => m.dispose());      // keep only the skeleton + animation
    root.listSkins().forEach((s) => s.dispose());
    root.listMaterials().forEach((m) => m.dispose());
    root.listTextures().forEach((t) => t.dispose());
    const anims = root.listAnimations().filter((a) => a.listChannels().length > 0);
    root.listAnimations().filter((a) => a.listChannels().length === 0).forEach((a) => a.dispose());
    if (!anims.length) throw new Error('no animation found in this FBX');
    anims[0].setName(key);
    await doc.transform(prune());
    await io.write(out, doc);
    const kb = Math.round((await stat(out)).size / 1024);
    console.log(`OK   ${file}  ->  ${out}  (${kb} KB)`);
  } catch (err) {
    console.log(`FAIL ${file}: ${err.message}`);
  } finally {
    await rm(tmp, { force: true });
  }
}
