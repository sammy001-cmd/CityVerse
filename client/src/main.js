import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import './style.css';

// ============================================================
// CITYVERSE NG  |  v0.2  |  Real Ibadan district from OpenStreetMap
// ============================================================

// ---------- CONFIG (change these to move the district) ----------
const CENTER = { lat: 7.3962, lon: 3.8968 }; // Dugbe / Cocoa House area. VERIFY on Google Maps and adjust.
const RADIUS = 450;                          // metres around CENTER to load
const LAMP_URL = '/assets/models/street-lamp/street_lamp_01_4k.gltf';
const LAMP_SCALE = 2;
const LAMP_MAX = 24;
const PLAYER_MODEL_URL = '/assets/models/characters/player.glb'; // optional Mixamo/MakeHuman GLB

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
renderer.toneMappingExposure = 0.6;
renderer.shadowMap.enabled = !LOW;
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

scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x8a5a3c, 1.3));
const sun = new THREE.DirectionalLight(0xfff1dc, 4);
sun.castShadow = !LOW;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 400 });
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

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(3000, 3000),
  new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

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

function buildBuildings(ways) {
  const rand = mulberry32(42);
  const roofs = [], walls = [];
  const tint = new THREE.Color();

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
    tint.setRGB(v, v * (0.85 + rand() * 0.25), v * (0.7 + rand() * 0.3));
    roofs.push(sliceGroup(geo, geo.groups[0], tint));
    const wv = 0.8 + rand() * 0.35;
    const wallPick = rand();
    if (wallPick < 0.25) tint.setRGB(wv, wv * 0.95, wv * 0.8);          // cream
    else if (wallPick < 0.5) tint.setRGB(wv * 0.9, wv * 0.95, wv);      // faded blue-grey
    else if (wallPick < 0.7) tint.setRGB(wv, wv * 0.8, wv * 0.65);      // peach
    else tint.setRGB(wv * 0.85, wv * 0.85, wv * 0.85);                  // concrete
    walls.push(sliceGroup(geo, geo.groups[1], tint));
    geo.dispose();

    // collision footprint
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    const f = { pts, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
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
  for (const m of [roofMesh, wallMesh]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }
  return roofs.length;
}

// ---------- Roads ----------
const ROAD_W = { motorway: 14, trunk: 14, primary: 12, secondary: 10, tertiary: 8, unclassified: 6, residential: 6, living_street: 5, service: 4, track: 3 };
const lampSpots = [];
const roadPts = [];   // sample points used to spawn the player on a road

function ribbon(pts, width, y) {
  const pos = [], idx = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
    let dx = next[0] - prev[0], dz = next[1] - prev[1];
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const nx = -dz, nz = dx;
    pos.push(p[0] + (nx * width) / 2, y, p[1] + (nz * width) / 2, p[0] - (nx * width) / 2, y, p[1] - (nz * width) / 2);
    if (i < pts.length - 1) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
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
    if (width >= 6) roadPts.push(pts[Math.floor(pts.length / 2)]);

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
    new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  );
  mesh.receiveShadow = true;
  scene.add(mesh);
  return geoms.length;
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
new GLTFLoader().load(
  PLAYER_MODEL_URL,
  (gltf) => {
    player.clear();
    const model = gltf.scene;
    model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    player.add(model);
    mixer = new THREE.AnimationMixer(model);
    gltf.animations.forEach((clip) => {
      const n = clip.name.toLowerCase();
      const k = n.includes('run') ? 'run' : n.includes('walk') ? 'walk' : n.includes('idle') ? 'idle' : null;
      if (k) actions[k] = mixer.clipAction(clip);
    });
    play('idle');
  },
  undefined,
  () => console.info('No player model yet. Drop a GLB at', PLAYER_MODEL_URL)
);
function play(name) {
  if (!actions[name] || current === name) return;
  actions[current]?.fadeOut(0.2);
  actions[name].reset().fadeIn(0.2).play();
  current = name;
}

// ---------- Input ----------
const keys = {};
let yaw = 0, pitch = 0.35, camDist = 6;
let velY = 0, grounded = true;

addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space' && grounded) { velY = 7; grounded = false; }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
renderer.domElement.addEventListener('click', () => {
  if (document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock();
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
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

// ---------- Main loop ----------
const clock = new THREE.Clock();
let acc = 0, frames = 0;
let started = false;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (started) {
    const fwd = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    const strafe = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const moving = fwd !== 0 || strafe !== 0;
    const speed = keys.ShiftLeft ? 9 : 5;

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

    velY -= 20 * dt;
    player.position.y += velY * dt;
    if (player.position.y <= 0) { player.position.y = 0; velY = 0; grounded = true; }

    play(!moving ? 'idle' : keys.ShiftLeft && actions.run ? 'run' : actions.walk ? 'walk' : 'idle');
    mixer?.update(dt);

    // camera orbit
    const cp = Math.cos(pitch);
    camera.position.set(
      player.position.x + Math.sin(yaw) * cp * camDist,
      player.position.y + 1.6 + Math.sin(pitch) * camDist,
      player.position.z + Math.cos(yaw) * cp * camDist
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
    hud.textContent = `FPS ${Math.round(frames / acc)}\nDraw calls ${i.render.calls}\nTriangles ${(i.render.triangles / 1000).toFixed(0)}k\nBuildings ${footprints.length}\nWASD move | Shift run | Space jump | Click = mouse look | Wheel = zoom`;
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
    console.log(`Built ${nB} buildings and ${nR} roads`);
    placeLamps();
    const [sx, sz] = findSpawn();
    player.position.set(sx, 0, sz);
    started = true;
    hideStatus();
  } catch (err) {
    console.error(err);
    setStatus('Map server is busy or unreachable (' + err.message + '). Run: node scripts/fetch-osm.mjs  then refresh.');
  }
})();