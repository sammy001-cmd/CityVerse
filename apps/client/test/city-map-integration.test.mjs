import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const integration = main.slice(main.indexOf('let cityMap = null;'), main.indexOf('const groundY ='))
  .replace("import('./navigation/CityMap.js')", 'mockImport()');
const input = main.slice(main.indexOf("addEventListener('keydown', (e) => {"), main.indexOf('function findSpawn()'));

function setup({ failInit = false, deferImport = false } = {}) {
  const listeners = new Map(), instances = [], vehicleInputs = [];
  let imports = 0, release;
  const gate = deferImport ? new Promise((resolve) => { release = resolve; }) : Promise.resolve();
  class FakeMap {
    constructor() { instances.push(this); this.opened = false; this.opens = []; }
    async init() { return !failInit; }
    async open(position) { this.opened = true; this.opens.push(position); }
    close() { this.opened = false; }
    destroy() { this.destroyed = true; }
    isOpen() { return this.opened; }
  }
  const element = { addEventListener(type, fn) { listeners.set(`canvas:${type}`, [fn]); }, requestPointerLock() { throw new Error('Unexpected pointer lock'); } };
  const context = vm.createContext({
    LOW: false, keys: { KeyW: true }, driving: null,
    player: { position: { x: 12, z: -34 }, rotation: { y: 0.7 } },
    mapLoading: { hidden: true }, document: { pointerLockElement: element, exitPointerLock() { this.pointerLockElement = null; } },
    console: { warn() {}, info() {} }, clearTimeout() {}, setTimeout(fn) { return fn; },
    mockImport: async () => { imports++; await gate; return { CityMap: FakeMap }; },
    addEventListener(type, fn, options) {
      const entries = listeners.get(type) ?? []; entries.push({ fn, options }); listeners.set(type, entries);
    },
    renderer: { domElement: element, toneMappingExposure: 0.45 }, scene: { environmentIntensity: 0.2 },
    yaw: 0, pitch: 0.35, camDist: 6, lastMouse: 0, velY: 0, grounded: true,
    toggleVehicle() { throw new Error('Unexpected vehicle toggle'); }, nearestVehicle() { return null; },
    THREE: { MathUtils: { clamp: (value, min, max) => Math.max(min, Math.min(max,value)) } }, performance,
  });
  vm.runInContext(integration + input, context);
  return { context, instances, vehicleInputs, listeners, release, imports: () => imports,
    run: (code) => vm.runInContext(code, context),
    retryInit: () => { failInit = false; } };
}

await test('concurrent openings import and initialize once, use foot position, clear held keys and release pointer lock', async () => {
  const env = setup({ deferImport: true });
  const a = env.run('toggleCityMap()'), b = env.run('toggleCityMap()');
  assert.equal(env.context.mapLoading.textContent, 'Opening map...');
  assert.equal(env.context.mapLoading.hidden, false);
  assert.equal(env.imports(), 1); env.release(); await Promise.all([a,b]);
  assert.equal(env.instances.length,1); assert.equal(env.instances[0].opens.length,1);
  assert.deepEqual({ ...env.instances[0].opens[0] }, { x:12,z:-34,heading:0.7 });
  assert.equal(Object.keys(env.context.keys).length,0);
  assert.equal(env.context.document.pointerLockElement,null);
  assert.equal(env.context.mapLoading.hidden,true);
  await env.run('toggleCityMap()'); assert.equal(env.instances[0].opened,false);
  await env.run('toggleCityMap()'); assert.equal(env.imports(),1);
});

await test('failed initialization cleans up and permits a successful retry', async () => {
  const env = setup({ failInit:true }); await env.run('toggleCityMap()');
  assert.equal(env.instances[0].destroyed,true);
  assert.equal(env.run('cityMap'),null); assert.equal(env.run('cityMapLoadPromise'),null);
  assert.equal(env.run('cityMapOpening'),false);
  env.retryInit(); await env.run('toggleCityMap()');
  assert.equal(env.instances[1].opened,true); assert.equal(env.context.mapLoading.hidden,true);
});

await test('driving position is authoritative and destination selection stores the POI and closes the map', async () => {
  const env = setup();
  env.context.driving = { position:{x:-120,z:90},heading:2.1,setInput:(value) => env.vehicleInputs.push(value) };
  await env.run('toggleCityMap()');
  assert.deepEqual({...env.instances[0].opens[0]},{x:-120,z:90,heading:2.1});
  assert.deepEqual({...env.vehicleInputs[0]},{throttle:0,steer:0,handbrake:false});
  const poi = {id:'test',name:'Destination'};
  env.listeners.get('cityverse:set-destination')[0].fn({detail:{poi}});
  assert.equal(env.run('pendingDestination'),poi); assert.equal(env.instances[0].opened,false);
});

await test('capture M ignores repeats and editable fields; map input cannot move player, camera or enter vehicles', async () => {
  const env = setup(); const handler = env.listeners.get('keydown')[0];
  assert.equal(handler.options.capture,true);
  const target = {closest:() => null,isContentEditable:false};
  const key = (code,extra={}) => ({code,target,repeat:false,preventDefault(){},...extra});
  handler.fn(key('KeyM',{repeat:true}));
  handler.fn(key('KeyM',{target:{closest:() => ({}),isContentEditable:false}}));
  handler.fn(key('KeyM',{target:{closest:() => null,isContentEditable:true}}));
  assert.equal(env.imports(),0);
  handler.fn(key('KeyM')); await env.run('ensureCityMap()'); await Promise.resolve();
  assert.equal(env.instances[0].opened,true);
  for (const code of ['KeyW','KeyE','KeyR','Space']) handler.fn(key(code));
  assert.equal(env.context.keys.KeyW,undefined); assert.equal(env.context.velY,0);
  env.listeners.get('wheel')[0].fn({deltaY:100}); assert.equal(env.context.camDist,6);
  env.listeners.get('mousemove')[0].fn({movementX:100,movementY:100}); assert.equal(env.context.yaw,0);
  env.listeners.get('canvas:click')[0]();
  handler.fn(key('KeyM')); assert.equal(env.instances[0].opened,false);
  handler.fn(key('KeyW')); assert.equal(env.context.keys.KeyW,true);
});
