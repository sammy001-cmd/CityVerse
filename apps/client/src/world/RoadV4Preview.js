import * as THREE from 'three';
import { buildV4PolygonRoadTile } from './V4PolygonRoadTile.js';

const scene = new THREE.Scene(); scene.background = new THREE.Color('#b8b2a0');
const camera = new THREE.PerspectiveCamera(43, innerWidth / innerHeight, 0.1, 2500);
camera.position.set(260, 390, 450); camera.lookAt(0, 0, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; document.body.append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x696756, 2)); const sun = new THREE.DirectionalLight(0xffffff, 2.1); sun.position.set(80, 180, 70); sun.castShadow = true; scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(750, 750), new THREE.MeshStandardMaterial({ color: 0x87917a, roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.12; ground.receiveShadow = true; scene.add(ground);
const grid = new THREE.GridHelper(750, 60, 0x666b5c, 0x898b7c); grid.position.y = -0.08; scene.add(grid);
const material = new THREE.MeshStandardMaterial({ color: 0x35383b, roughness: 0.94, side: THREE.DoubleSide });
const keys = []; for (let tx=-1;tx<=1;tx++) for (let tz=-1;tz<=1;tz++) keys.push(`${tx}_${tz}`);
const tiles = await Promise.all(keys.map(async tileKey => { const response=await fetch(`/__v4_road_preview/${tileKey}.json`); if(!response.ok)return null; return buildV4PolygonRoadTile(await response.json(), { terrainHeightAt:()=>0, material }); }));
const loaded = tiles.filter(Boolean); let triangles=0,polygons=0; for(const tile of loaded){tile.group.traverse(o=>{if(o.isMesh)o.castShadow=true;});scene.add(tile.group);triangles+=tile.triangleCount;polygons+=tile.polygonCount;}
document.querySelector('#label').textContent = `Road World V4 · ${polygons} unified polygons · ${triangles} triangles · ${loaded.length} streamed subset tiles`;
globalThis.roadV4Preview = { scene, camera, renderer, tiles:loaded };
function draw() { renderer.render(scene, camera); requestAnimationFrame(draw); } draw();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
