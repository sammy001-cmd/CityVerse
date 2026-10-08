import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Physics, Vehicle } from './vehicles.js';
import './style.css';

// ============================================================
// CITYVERSE NG  |  v0.2  |  Real Ibadan district from OpenStreetMap
// ============================================================

// Debug toggles in the URL, e.g. localhost:5173/?lamps=0&vehicles=1&shadows=0  (use them to find what costs FPS)
const P = new URLSearchParams(location.search);

// ---------- CONFIG (change these to move the district) ----------
const CENTER = { lat: 7.3962, lon: 3.8968 }; // Dugbe / Cocoa House area. VERIFY on Google Maps and adjust.
const RADIUS = 450;                          // metres around CENTER to load
const LAMP_URL = '/assets/models/street-lamp/street_lamp_01_4k.gltf';
const LAMP_SCALE = 2;
const LAMP_MAX = Number(P.get('lamps') ?? 8);     // the 4K lamp model is heavy; decimate it before raising this
const PLAYER_MODEL_URL = '/assets/models/characters/player.glb'; // realistic character (see guide)
const PLAYER_HEIGHT = 1.75;
// Mixamo animations are not "in place" in the game, so speeds must match the clips to avoid foot sliding.
const WALK_SPEED = 2.2, WALK_ANIM_SPEED = 1.58;   // m/s: game speed, speed the walk clip was made at
const RUN_SPEED = 5.0, RUN_ANIM_SPEED = 4.1;      // measured from your Running.fbx
// 'Jumping Down' is a drop-from-height clip (hips start 0.8 m above the ground), so it is off by default.
// Download a normal 'Jump' from Mixamo, convert it, and set this to true.
const USE_JUMP_CLIP = false;                                      // model is auto-scaled to this (metres)
const ANIM_DIR = '/assets/models/characters/anims/';             // optional idle.glb, walk.glb, run.glb

// ---------- Local projection (lat/lon -> metres) ----------
const M_LON = 111320, M_LAT = 110540;
const cosLat = Math.cos((CENTER.lat * Math.PI) / 180);
const project = (lat, lon) => [(lon - CENTER.lon) * M_LON * cosLat, -(lat - CENTER.lat) * M_LAT]; // [x, z]
const dLat = RADIUS / M_LAT;
const dLon = RADIUS / (M_LON * cosLat);

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Add ?low to the URL (e.g. localhost:5173/?low) to test with cheaper graphics
const LOW = new URLSearchParams(location.search).has('low');

// ---------- HUD ----------
const hud = document.createElement('div');
hud.style.cssText = 'position:fixed;top:10px;left:10px;z-index:10;font:12px/1.4 monospace;color:#fff;background:rgba(0,0,0,.45);padding:8px 10px;border-radius:6px;pointer-events:none;white-space:pre';
document.body.appendChild(hud);
const status = document.createElement('div');
status.style.cssText = 'position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;background:#1b1410;color:#f1e3d0;font:18px sans-serif;text-align:center;padding:24px';
status.textContent = 'Loading Ibadan...';
document.body.appendChild(status);
const setStatus = (msg) => { status.textContent = msg; };
const hideStatus = () => status.remove();

// ---------- Renderer / scene / camera ----------
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xc7cfd6, 150, 800);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 6000);

const renderer = new THREE.WebGLRenderer({ antialias: !LOW, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(LOW ? 1 : Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.45;
const SHADOWS = !LOW && P.get('shadows') !== '0';
renderer.shadowMap.enabled = SHADOWS;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

// ---------- Sky + lighting ----------
const sky = new Sky();
sky.scale.setScalar(5000);
scene.add(sky);
const su = sky.material.uniforms;
su.turbidity.value = 9;
su.rayleigh.value = 2;
su.mieCoefficient.value = 0.006;
su.mieDirectionalG.value = 0.85;

const sunDir = new THREE.Vector3().setFromSphericalCoords(
  1, THREE.MathUtils.degToRad(90 - 38), THREE.MathUtils.degToRad(150)
);
su.sunPosition.value.copy(sunDir);

// Image-based lighting generated from the sky: gives metal roofs and skin real reflections/ambient light
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(sky);
  scene.environment = pmrem.fromScene(envScene).texture;
  scene.environmentIntensity = 0.2;
  scene.add(sky);
}
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x8a5a3c, 0.25));
const sun = new THREE.DirectionalLight(0xfff1dc, 4);
sun.castShadow = SHADOWS;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 400 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.5;
scene.add(sun, sun.target);

// ---------- Procedural textures (replace with Poly Haven / ambientCG PBR later) ----------
function canvasTex(size, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = LOW ? 1 : 4;
  if (repeat) tex.repeat.set(repeat, repeat);
  return tex;
}
const noiseRand = mulberry32(7);

const zincTex = canvasTex(256, (g, s) => {
  g.fillStyle = '#8a4b2d'; g.fillRect(0, 0, s, s);
  for (let x = 0; x < s; x += 16) {              // corrugation ridges
    g.fillStyle = 'rgba(255,200,150,.22)'; g.fillRect(x, 0, 4, s);
    g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x + 8, 0, 5, s);
  }
  for (let i = 0; i < 900; i++) {                // rust and dirt patches
    g.fillStyle = `rgba(${60 + noiseRand() * 90},${25 + noiseRand() * 40},10,${noiseRand() * 0.25})`;
    g.fillRect(noiseRand() * s, noiseRand() * s, 2 + noiseRand() * 22, 2 + noiseRand() * 14);
  }
}, 0.25);

const wallTex = canvasTex(128, (g, s) => {
  g.fillStyle = '#e2d6c0'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 1200; i++) {
    g.fillStyle = `rgba(90,70,50,${noiseRand() * 0.12})`;
    g.fillRect(noiseRand() * s, noiseRand() * s, 1 + noiseRand() * 4, 1 + noiseRand() * 4);
  }
}, 0.15);

const groundTex = canvasTex(256, (g, s) => {
  g.fillStyle = '#9b5d3b'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(${90 + noiseRand() * 60},${40 + noiseRand() * 30},20,${noiseRand() * 0.3})`;
    g.fillRect(noiseRand() * s, noiseRand() * s, 1 + noiseRand() * 5, 1 + noiseRand() * 5);
  }
}, 1);
groundTex.repeat.set(160, 160);

const asphaltTex = canvasTex(256, (g, s) => {
  g.fillStyle = '#3a3b3e'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 5000; i++) {
    const v = 40 + noiseRand() * 60;
    g.fillStyle = `rgba(${v},${v},${v + 3},${0.15 + noiseRand() * 0.3})`;
    g.fillRect(noiseRand() * s, noiseRand() * s, 1 + noiseRand() * 2, 1 + noiseRand() * 2);
  }
}, 0.25);

// Drop real PBR textures into public/assets/textures/<name>/ as color.jpg, normal.jpg, roughness.jpg
// (Poly Haven / ambientCG, 1K or 2K). If missing, the procedural textures above are used.
// tile = real-world size of one texture tile in metres; uvSize = how many metres the UVs span (1 for buildings/roads)
const texLoader = new THREE.TextureLoader();
function applyPBR(mat, dir, tile, uvSize = 1) {
  const load = (file, srgb, assign) =>
    texLoader.load(`/assets/textures/${dir}/${file}`, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(uvSize / tile, uvSize / tile);
      t.anisotropy = LOW ? 1 : 4;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      assign(t);
      mat.needsUpdate = true;
    }, undefined, () => {});
  load('color.jpg', true, (t) => { mat.map = t; });
  load('normal.jpg', false, (t) => { mat.normalMap = t; });
  load('roughness.jpg', false, (t) => { mat.roughnessMap = t; mat.roughness = 1; });
}

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(3000, 3000),
  new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
applyPBR(ground.material, 'ground', 3, 3000);

// ---------- OSM loading ----------
// Order: 1) local file public/data/district.json (fast, reliable)  2) live Overpass (often busy)
async function loadOSM() {
  setStatus('Loading map data...');
  try {
    const r = await fetch('/data/district.json');
    if ((r.headers.get('content-type') || '').includes('json')) return await r.json();
  } catch (_) {}

  const key = `cv-osm-v1-${CENTER.lat}-${CENTER.lon}-${RADIUS}`;
  try { const c = localStorage.getItem(key); if (c) return JSON.parse(c); } catch (_) {}

  const s = CENTER.lat - dLat, n = CENTER.lat + dLat, w = CENTER.lon - dLon, e = CENTER.lon + dLon;
  const q = `[out:json][timeout:60];(way["building"](${s},${w},${n},${e});way["highway"](${s},${w},${n},${e}););out geom;`;

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      setStatus(`Downloading map data (try ${attempt}/3)... For reliability, run: node scripts/fetch-osm.mjs`);
      const res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      try { localStorage.setItem(key, JSON.stringify(json)); } catch (_) {}
      return json;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 4000 * attempt));
    }
  }
  throw lastErr;
}

// ---------- Buildings ----------
const footprints = [];            // for collision
const CELL = 50;
const grid = new Map();
const cellKey = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;

function inPoly(x, z, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function blockedPoint(x, z) {
  const list = grid.get(cellKey(x, z));
  if (!list) return false;
  for (const f of list) {
    if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ) continue;
    if (inPoly(x, z, f.pts)) return true;
  }
  return false;
}
const PR = 0.45; // player radius
const blocked = (x, z) =>
  blockedPoint(x, z) || blockedPoint(x + PR, z) || blockedPoint(x - PR, z) ||
  blockedPoint(x, z + PR) || blockedPoint(x, z - PR);

function sliceGroup(geo, g, tint) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = geo.attributes[name];
    out.setAttribute(name, new THREE.BufferAttribute(a.array.slice(g.start * a.itemSize, (g.start + g.count) * a.itemSize), a.itemSize));
  }
  const n = g.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = tint.r; col[i * 3 + 1] = tint.g; col[i * 3 + 2] = tint.b; }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

// ---------- Pitched (gable) roofs ----------
const polyArea = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
};

function pushTri(pos, uv, p, q, r, uvp, uvq, uvr, want) {
  const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
  const vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (nx * want[0] + ny * want[1] + nz * want[2] < 0) { [q, r] = [r, q]; [uvq, uvr] = [uvr, uvq]; }
  pos.push(...p, ...q, ...r);
  uv.push(...uvp, ...uvq, ...uvr);
}

function geoFrom(pos, uv, tint) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const col = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) { col[i] = tint.r; col[i + 1] = tint.g; col[i + 2] = tint.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Returns { roof, gable } geometries, or null if the footprint is not roughly rectangular
function gableRoof(pts, h, roofTint, wallTint) {
  const n = pts.length;
  let best = 0, ang = 0;
  for (let i = 0; i < n; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % n];
    const l = Math.hypot(x1 - x0, z1 - z0);
    if (l > best) { best = l; ang = Math.atan2(z1 - z0, x1 - x0); }
  }
  const c = Math.cos(ang), s = Math.sin(ang);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, z] of pts) {
    const u = x * c + z * s, v = -x * s + z * c;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const du = u1 - u0, dv = v1 - v0;
  const area = Math.abs(polyArea(pts));
  if (area < 14 || area > 500 || area / (du * dv) < 0.78) return null;

  // ridge runs along the longer side
  let ea, eb, a0, a1, b0, b1;
  if (du >= dv) { ea = [c, s]; eb = [-s, c]; a0 = u0; a1 = u1; b0 = v0; b1 = v1; }
  else { ea = [-s, c]; eb = [c, s]; a0 = v0; a1 = v1; b0 = u0; b1 = u1; }
  const P = (a, b, y) => [ea[0] * a + eb[0] * b, y, ea[1] * a + eb[1] * b];

  const o = 0.3;                                   // eave overhang
  const A0 = a0 - o, A1 = a1 + o, B0 = b0 - o, B1 = b1 + o, bm = (b0 + b1) / 2;
  const rise = THREE.MathUtils.clamp((b1 - b0) * 0.25, 0.7, 2.2);
  const slope = Math.hypot((B1 - B0) / 2, rise);
  const up = [0, 1, 0];

  const rp = [], ru = [];
  // two roof slopes (uv: along ridge, down the slope -> corrugation runs downhill)
  for (const Bedge of [B0, B1]) {
    const e0 = P(A0, Bedge, h), e1 = P(A1, Bedge, h), r1 = P(A1, bm, h + rise), r0 = P(A0, bm, h + rise);
    pushTri(rp, ru, e0, e1, r1, [A0, 0], [A1, 0], [A1, slope], up);
    pushTri(rp, ru, e0, r1, r0, [A0, 0], [A1, slope], [A0, slope], up);
  }
  // gable end triangles (wall material)
  const gp = [], gu = [];
  for (const [a, sgn] of [[a0, -1], [a1, 1]]) {
    pushTri(gp, gu, P(a, b0, h), P(a, b1, h), P(a, bm, h + rise), [b0, h], [b1, h], [bm, h + rise], [sgn * ea[0], 0, sgn * ea[1]]);
  }
  return { roof: geoFrom(rp, ru, roofTint), gable: geoFrom(gp, gu, wallTint) };
}

function buildBuildings(ways) {
  const rand = mulberry32(42);
  const roofs = [], walls = [];
  const roofTint = new THREE.Color(), wallTint = new THREE.Color();

  for (const w of ways) {
    if (!w.tags?.building || !w.geometry || w.geometry.length < 4) continue;
    const pts = w.geometry.map((p) => project(p.lat, p.lon));
    const a = pts[0], b = pts[pts.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) pts.pop();
    if (pts.length < 3) continue;

    const levels = parseFloat(w.tags['building:levels']);
    const h = levels ? levels * 3.3 + 1 : 3.2 + rand() * 3.2;

    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);

    // per-building colour variation (rusted zinc tones / painted wall tones)
    const v = 0.75 + rand() * 0.5;
    roofTint.setRGB(v, v * (0.85 + rand() * 0.25), v * (0.7 + rand() * 0.3));
    const wv = 0.8 + rand() * 0.35;
    const wallPick = rand();
    if (wallPick < 0.25) wallTint.setRGB(wv, wv * 0.95, wv * 0.8);          // cream
    else if (wallPick < 0.5) wallTint.setRGB(wv * 0.9, wv * 0.95, wv);      // faded blue-grey
    else if (wallPick < 0.7) wallTint.setRGB(wv, wv * 0.8, wv * 0.65);      // peach
    else wallTint.setRGB(wv * 0.85, wv * 0.85, wv * 0.85);                  // concrete

    const gab = h < 9 ? gableRoof(pts, h, roofTint, wallTint) : null;       // pitched roof on low, boxy buildings
    if (gab) { roofs.push(gab.roof); walls.push(gab.gable); }
    else roofs.push(sliceGroup(geo, geo.groups[0], roofTint));              // flat roof otherwise
    walls.push(sliceGroup(geo, geo.groups[1], wallTint));
    geo.dispose();

    // collision footprint
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    const f = { pts, h, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
    footprints.push(f);
    for (let cx = Math.floor(f.minX / CELL); cx <= Math.floor(f.maxX / CELL); cx++)
      for (let cz = Math.floor(f.minZ / CELL); cz <= Math.floor(f.maxZ / CELL); cz++) {
        const k = `${cx},${cz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(f);
      }
  }

  if (!roofs.length) return 0;
  const roofMesh = new THREE.Mesh(
    mergeGeometries(roofs),
    new THREE.MeshStandardMaterial({ map: zincTex, vertexColors: true, roughness: 0.55, metalness: 0.5 })
  );
  const wallMesh = new THREE.Mesh(
    mergeGeometries(walls),
    new THREE.MeshStandardMaterial({ map: wallTex, vertexColors: true, roughness: 0.9 })
  );
  applyPBR(roofMesh.material, 'zinc', 2);
  applyPBR(wallMesh.material, 'wall', 3);
  for (const m of [roofMesh, wallMesh]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }
  return roofs.length;
}

// ---------- Roads ----------
const ROAD_W = { motorway: 14, trunk: 14, primary: 12, secondary: 10, tertiary: 8, unclassified: 6, residential: 6, living_street: 5, service: 4, track: 3 };
const lampSpots = [];
const roadPts = [];   // sample points used to spawn the player on a road

function ribbon(pts, width, y) {
  const pos = [], idx = [], uvs = [];
  let run = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
    let dx = next[0] - prev[0], dz = next[1] - prev[1];
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const nx = -dz, nz = dx;
    pos.push(p[0] + (nx * width) / 2, y, p[1] + (nz * width) / 2, p[0] - (nx * width) / 2, y, p[1] - (nz * width) / 2);
    if (i > 0) run += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    uvs.push(width / 2, run, -width / 2, run);   // metres, so textures keep real scale
    if (i < pts.length - 1) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildRoads(ways) {
  const geoms = [];
  for (const w of ways) {
    const type = w.tags?.highway;
    const width = ROAD_W[type];
    if (!width || !w.geometry || w.geometry.length < 2) continue;
    const pts = w.geometry.map((p) => project(p.lat, p.lon));
    geoms.push(ribbon(pts, width, 0.05));
    if (width >= 6) {                       // [x, z, dirX, dirZ] sample point, used to spawn the player and vehicles
      const m = Math.floor((pts.length - 1) / 2), a = pts[m];
      const nx2 = pts[Math.min(m + 1, pts.length - 1)], pv = pts[Math.max(m - 1, 0)];
      const dx = nx2[0] - pv[0], dz = nx2[1] - pv[1], l = Math.hypot(dx, dz) || 1;
      roadPts.push([a[0], a[1], dx / l, dz / l]);
    }

    if (['primary', 'secondary', 'tertiary', 'trunk'].includes(type)) {   // lamp spots every ~45 m
      let acc = 0, side = 1;
      for (let i = 1; i < pts.length; i++) {
        const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
        const len = Math.hypot(x1 - x0, z1 - z0);
        acc += len;
        if (acc >= 45 && len > 0) {
          acc = 0;
          const nx = -(z1 - z0) / len, nz = (x1 - x0) / len, off = width / 2 + 1.5;
          lampSpots.push([x1 + nx * off * side, z1 + nz * off * side]);
          side *= -1;
        }
      }
    }
  }
  if (!geoms.length) return 0;
  const mesh = new THREE.Mesh(
    mergeGeometries(geoms),
    new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.92, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  );
  mesh.receiveShadow = true;
  applyPBR(mesh.material, 'asphalt', 4);
  scene.add(mesh);
  return geoms.length;
}

// ---------- Street furniture: electric poles, wires, trees ----------
function buildStreetFurniture(ways) {
  const rand = mulberry32(99);
  const poles = [], trees = [], wire = [];
  const SPACING = 38;

  for (const w of ways) {
    const width = ROAD_W[w.tags?.highway];
    if (!width || width < 5 || !w.geometry || w.geometry.length < 2) continue;
    const pts = w.geometry.map((p) => project(p.lat, p.lon));
    const side = rand() < 0.5 ? 1 : -1;
    let dist = 0, nextPole = 8 + rand() * 20, nextTree = 6 + rand() * 15, prev = null;

    for (let i = 1; i < pts.length; i++) {
      const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (!len) continue;
      const ux = (x1 - x0) / len, uz = (z1 - z0) / len, nx = -uz, nz = ux;

      while (nextPole <= dist + len || nextTree <= dist + len) {
        if (nextPole <= nextTree) {
          const t = nextPole - dist, off = width / 2 + 1.2;
          const x = x0 + ux * t + nx * off * side, z = z0 + uz * t + nz * off * side;
          if (!blocked(x, z)) {
            poles.push([x, z]);
            if (prev && Math.hypot(prev[0] - x, prev[1] - z) < 60)
              wire.push(prev[0], 7.4, prev[1], x, 7.4, z, prev[0], 7.0, prev[1], x, 7.0, z);
            prev = [x, z];
          } else prev = null;
          nextPole += SPACING;
        } else {
          const t = nextTree - dist, off = width / 2 + 2.5 + rand() * 4, sd = rand() < 0.5 ? 1 : -1;
          const x = x0 + ux * t + nx * off * sd, z = z0 + uz * t + nz * off * sd;
          if (rand() < 0.7 && !blocked(x, z)) trees.push([x, z, rand()]);
          nextTree += 14 + rand() * 22;
        }
      }
      dist += len;
    }
  }

  const dummy = new THREE.Object3D();

  if (poles.length) {
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.16, 8, 6); poleGeo.translate(0, 4, 0);
    const armGeo = new THREE.BoxGeometry(1.8, 0.1, 0.1); armGeo.translate(0, 7.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b6258, roughness: 0.9 });
    const poleMesh = new THREE.InstancedMesh(poleGeo, mat, poles.length);
    const armMesh = new THREE.InstancedMesh(armGeo, mat, poles.length);
    poles.forEach(([x, z], i) => {
      dummy.position.set(x, 0, z); dummy.rotation.set(0, rand() * Math.PI, 0); dummy.scale.setScalar(1); dummy.updateMatrix();
      poleMesh.setMatrixAt(i, dummy.matrix); armMesh.setMatrixAt(i, dummy.matrix);
    });
    poleMesh.castShadow = armMesh.castShadow = true;
    scene.add(poleMesh, armMesh);
  }

  if (wire.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x15151a })));
  }

  if (trees.length) {
    const trunkGeo = new THREE.CylinderGeometry(0.15, 0.25, 3, 6); trunkGeo.translate(0, 1.5, 0);
    const crownGeo = new THREE.IcosahedronGeometry(1.6, 1); crownGeo.scale(1, 0.85, 1); crownGeo.translate(0, 4.2, 0);
    const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 1 }), trees.length);
    const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), trees.length);
    const col = new THREE.Color();
    trees.forEach(([x, z, r], i) => {
      dummy.position.set(x, 0, z); dummy.rotation.set(0, r * 6.28, 0); dummy.scale.setScalar(0.8 + r * 0.8); dummy.updateMatrix();
      trunk.setMatrixAt(i, dummy.matrix); crown.setMatrixAt(i, dummy.matrix);
      crown.setColorAt(i, col.setHSL(0.25 + r * 0.06, 0.45, 0.22 + r * 0.1));
    });
    trunk.castShadow = crown.castShadow = true;
    scene.add(trunk, crown);
  }
  return { poles: poles.length, trees: trees.length };
}

// ---------- Street lamps (placed along main roads) ----------
function placeLamps() {
  new GLTFLoader().load(
    LAMP_URL,
    (gltf) => {
      gltf.scene.scale.setScalar(LAMP_SCALE);
      gltf.scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      lampSpots.slice(0, LAMP_MAX).forEach(([x, z]) => {
        const c = gltf.scene.clone();
        c.position.set(x, 0, z);
        scene.add(c);
      });
    },
    undefined,
    (err) => console.warn('Lamp not loaded:', err)
  );
}

// ---------- Player (third person) ----------
const player = new THREE.Group();
scene.add(player);

function placeholderHuman() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.8, 4, 12), new THREE.MeshStandardMaterial({ color: 0x2f6b4f }));
  body.position.y = 0.85;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), new THREE.MeshStandardMaterial({ color: 0x5a3a28 }));
  head.position.y = 1.6;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.12), new THREE.MeshStandardMaterial({ color: 0x5a3a28 }));
  nose.position.set(0, 1.6, -0.2); // marks the front (-Z)
  [body, head, nose].forEach((m) => (m.castShadow = true));
  g.add(body, head, nose);
  return g;
}
player.add(placeholderHuman());

let mixer = null;
const actions = {};
let current = null;

// Mixamo downloads name their bones mixamorig, mixamorig1, mixamorig4... Normalise so clips from any file fit any character.
const fixName = (n) => n.replace(/mixamorig\d*/g, 'mixamorig');
function fixClip(clip) {
  clip.tracks.forEach((t) => {
    t.name = fixName(t.name);
    // remove forward/sideways root motion on the hips: the game moves the character, the clip only animates it
    if (/mixamorigHips\.position$/.test(t.name)) {
      const v = t.values;
      for (let i = 0; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; }
    }
  });
  return clip;
}
function registerClips(clips) {
  clips.forEach((clip) => {
    const n = clip.name.toLowerCase();
    const k = n.includes('run') ? 'run' : n.includes('walk') ? 'walk' : n.includes('idle') ? 'idle' : n.includes('jump') && USE_JUMP_CLIP ? 'jump' : null;
    if (k && !actions[k]) actions[k] = mixer.clipAction(fixClip(clip));
  });
}
// Animation-only GLBs made by scripts/convert-animations.mjs: anims/idle.glb, walk.glb, run.glb, jump.glb
function loadClipFile(name) {
  new GLTFLoader().load(`${ANIM_DIR}${name}.glb`, (g) => {
    if (g.animations[0] && mixer && !actions[name]) actions[name] = mixer.clipAction(fixClip(g.animations[0]));
  }, undefined, () => {});
}

new GLTFLoader().load(
  PLAYER_MODEL_URL,
  (gltf) => {
    player.clear();
    const model = gltf.scene;
    model.traverse((o) => {
      o.name = fixName(o.name);
      if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
    });
    // scale to a real human height and stand the feet on the ground
    const box = new THREE.Box3().setFromObject(model);
    const k = PLAYER_HEIGHT / (box.getSize(new THREE.Vector3()).y || 1);
    model.scale.multiplyScalar(k);
    box.setFromObject(model);
    model.position.y -= box.min.y;
    const holder = new THREE.Group();
    holder.rotation.y = Math.PI;               // glTF characters face +Z; we walk toward -Z
    holder.add(model);
    player.add(holder);
    mixer = new THREE.AnimationMixer(model);
    registerClips(gltf.animations);
    ['idle', 'walk', 'run'].forEach(loadClipFile);
    if (USE_JUMP_CLIP) loadClipFile('jump');
    console.log('Character loaded. Clips in file:', gltf.animations.map((a) => a.name));
  },
  undefined,
  () => console.info('No player model yet. Drop a GLB at', PLAYER_MODEL_URL)
);
function updateAnimation(moving, running, airborne) {
  if (!mixer) return;
  let name = airborne && actions.jump ? 'jump'
    : !moving ? 'idle'
    : running && actions.run ? 'run' : 'walk';
  if (!actions[name]) name = name === 'idle' ? null : actions.walk ? 'walk' : null;
  if (!name) { if (current) actions[current].timeScale = 0; return; }   // no idle clip yet: freeze the pose
  if (current !== name) {
    const next = actions[name];
    next.reset().fadeIn(0.2).play();
    if (current) actions[current].fadeOut(0.2);
    current = name;
  }
  actions[name].timeScale = name === 'walk' ? WALK_SPEED / WALK_ANIM_SPEED : name === 'run' ? RUN_SPEED / RUN_ANIM_SPEED : 1;
}

// ---------- Input ----------
const keys = {};
let yaw = 0, pitch = 0.35, camDist = 6;
let velY = 0, grounded = true;
let physics = null;
const vehicles = [];
let driving = null;          // the Vehicle the player is in, or null
let lastMouse = 0;

const prompt = document.createElement('div');
prompt.style.cssText = 'position:fixed;bottom:48px;left:50%;transform:translateX(-50%);z-index:10;font:600 15px sans-serif;color:#fff;background:rgba(0,0,0,.55);padding:8px 16px;border-radius:20px;pointer-events:none;display:none';
document.body.appendChild(prompt);

function nearestVehicle(maxDist) {
  let best = null, bd = maxDist;
  for (const v of vehicles) {
    const p = v.position, d = Math.hypot(p.x - player.position.x, p.z - player.position.z);
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

function toggleVehicle() {
  if (driving) {
    const p = driving.position, h = driving.heading;
    const lx = Math.cos(h), lz = -Math.sin(h);          // the car's left-hand side
    player.position.set(p.x, 0, p.z);
    for (const side of [1, -1]) {
      const x = p.x + lx * 2.4 * side, z = p.z + lz * 2.4 * side;
      if (!blocked(x, z)) { player.position.set(x, 0, z); break; }
    }
    player.rotation.y = h + Math.PI;
    driving = null;
    player.visible = true;
    return;
  }
  const v = nearestVehicle(5);
  if (v) { driving = v; player.visible = false; velY = 0; }
}

addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space' && grounded && !driving) { velY = 7; grounded = false; }
  if (e.code === 'KeyE') toggleVehicle();
  if (e.code === 'KeyR') (driving || nearestVehicle(6))?.resetUpright();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
// Live look-tuning (no reload): [ ] = exposure, - = = environment light. Read the values off the HUD.
addEventListener('keydown', (e) => {
  if (e.code === 'BracketLeft') renderer.toneMappingExposure = Math.max(0.1, renderer.toneMappingExposure - 0.05);
  if (e.code === 'BracketRight') renderer.toneMappingExposure += 0.05;
  if (e.code === 'Minus') scene.environmentIntensity = Math.max(0, scene.environmentIntensity - 0.05);
  if (e.code === 'Equal') scene.environmentIntensity += 0.05;
});
renderer.domElement.addEventListener('click', () => {
  if (document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock();
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  lastMouse = performance.now();
  yaw -= e.movementX * 0.0025;
  pitch = THREE.MathUtils.clamp(pitch + e.movementY * 0.0025, 0.05, 1.2);
});
addEventListener('wheel', (e) => { camDist = THREE.MathUtils.clamp(camDist + e.deltaY * 0.005, 3, 14); });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function findSpawn() {
  roadPts.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
  for (const p of roadPts) if (!blocked(p[0], p[1])) return p;
  for (let r = 0; r < 80; r += 3)
    for (let a = 0; a < 12; a++) {
      const x = Math.cos((a / 12) * Math.PI * 2) * r, z = Math.sin((a / 12) * Math.PI * 2) * r;
      if (!blocked(x, z)) return [x, z];
    }
  return [0, 0];
}

function spawnVehicles(px, pz) {
  const types = ['carry', 'danfo', 'car', 'carry'].slice(0, Number(P.get('vehicles') ?? 3));
  const placed = [];
  for (const [x, z, dx, dz] of roadPts) {
    if (placed.length >= types.length) break;
    const d = Math.hypot(x - px, z - pz);
    if (d < 12 || d > 160) continue;
    if (placed.some(([qx, qz]) => Math.hypot(x - qx, z - qz) < 30)) continue;
    if (blocked(x, z) || blocked(x + dx * 3, z + dz * 3) || blocked(x - dx * 3, z - dz * 3)) continue;
    vehicles.push(new Vehicle(physics, scene, types[placed.length], x, z, Math.atan2(dx, dz)));
    placed.push([x, z]);
  }
  return placed.length;
}

// ---------- Main loop ----------
const clock = new THREE.Clock();
let acc = 0, frames = 0;
let started = false;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (started) {
    if (physics) {
      physics.step(dt);
      if (driving) {
        driving.setInput({
          throttle: (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0),
          steer: (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0),
          handbrake: !!keys.Space,
        });
      }
      for (const v of vehicles) {
        if (v !== driving) v.setInput({ throttle: 0, steer: 0, handbrake: true });   // parked
        v.update(dt);
      }
      const near = driving ? null : nearestVehicle(5);
      prompt.style.display = driving || near ? 'block' : 'none';
      prompt.textContent = driving
        ? `${Math.round(driving.kmh)} km/h   |   W/S gas & brake   A/D steer   Space handbrake   R flip upright   E exit`
        : near ? `Press E to drive the ${near.T.name}` : '';
    }
    const fwd = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    const strafe = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const moving = !driving && (fwd !== 0 || strafe !== 0);
    const speed = keys.ShiftLeft ? RUN_SPEED : WALK_SPEED;

    if (moving) {
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // forward on ground
      const rx = -fz, rz = fx;                          // right
      let mx = fx * fwd + rx * strafe, mz = fz * fwd + rz * strafe;
      const l = Math.hypot(mx, mz); mx /= l; mz /= l;
      const nx = player.position.x + mx * speed * dt;
      const nz = player.position.z + mz * speed * dt;
      if (!blocked(nx, player.position.z)) player.position.x = nx;   // slide along walls
      if (!blocked(player.position.x, nz)) player.position.z = nz;
      const target = Math.atan2(-mx, -mz);
      let d = target - player.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      player.rotation.y += d * Math.min(1, dt * 12);
    }

    if (driving) {
      const p = driving.position;
      player.position.set(p.x, 0, p.z);
      velY = 0;
    } else {
      velY -= 20 * dt;
      player.position.y += velY * dt;
      if (player.position.y <= 0) { player.position.y = 0; velY = 0; grounded = true; }
    }

    updateAnimation(moving, !!keys.ShiftLeft, !grounded && !driving);
    mixer?.update(dt);

    // chase camera: when driving, swing behind the car unless the player is looking around with the mouse
    if (driving && performance.now() - lastMouse > 1500 && driving.kmh > 3) {
      const target = driving.heading + Math.PI;
      let d = target - yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      yaw += d * Math.min(1, dt * 3);
    }
    const dist = driving ? camDist + 4 : camDist;
    const cp = Math.cos(pitch);
    camera.position.set(
      player.position.x + Math.sin(yaw) * cp * dist,
      player.position.y + (driving ? 2.2 : 1.6) + Math.sin(pitch) * dist,
      player.position.z + Math.cos(yaw) * cp * dist
    );
    camera.lookAt(player.position.x, player.position.y + 1.4, player.position.z);

    // shadows follow the player
    sun.position.copy(player.position).addScaledVector(sunDir, 200);
    sun.target.position.copy(player.position);
  }

  renderer.render(scene, camera);

  acc += dt; frames++;
  if (acc >= 0.5) {
    const i = renderer.info;
    hud.textContent = `FPS ${Math.round(frames / acc)}\nDraw calls ${i.render.calls}\nTriangles ${(i.render.triangles / 1000).toFixed(0)}k\nBuildings ${footprints.length}\nWASD move | Shift run | Space jump | E = enter/exit vehicle | Click = mouse look | Wheel = zoom\nLook: exposure ${renderer.toneMappingExposure.toFixed(2)} ([ ])  env ${scene.environmentIntensity.toFixed(2)} (- =)`;
    acc = 0; frames = 0;
  }
}
animate();

// ---------- Boot ----------
(async () => {
  try {
    const osm = await loadOSM();
    setStatus('Building the city...');
    await new Promise((r) => setTimeout(r, 30)); // let the message paint
    const nB = buildBuildings(osm.elements);
    const nR = buildRoads(osm.elements);
    const fx = buildStreetFurniture(osm.elements);
    console.log(`Built ${nB} buildings, ${nR} roads, ${fx.poles} poles, ${fx.trees} trees`);
    placeLamps();
    const [sx, sz] = findSpawn();
    player.position.set(sx, 0, sz);
    setStatus('Starting physics...');
    physics = await Physics.create();
    const nCol = physics.addBuildings(footprints);
    const nVeh = spawnVehicles(sx, sz);
    console.log(`Physics ready: ${nCol} building colliders, ${nVeh} vehicles`);
    started = true;
    hideStatus();
  } catch (err) {
    console.error(err);
    setStatus('Map server is busy or unreachable (' + err.message + '). Run: node scripts/fetch-osm.mjs  then refresh.');
  }
})();