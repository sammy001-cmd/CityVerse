import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';

// ============================================================
// CITYVERSE NG  |  vehicles.js
// Rapier physics world + drivable vehicles.
// Vehicle model space: +Z is FORWARD, +X is the vehicle's LEFT, +Y is up.
// ============================================================

// Tune each vehicle here. hw/hh/hl = half width / height / length of the chassis (metres).
export const VEHICLE_TYPES = {
  car: {
    name: 'Saloon car',
    hw: 0.9, hh: 0.45, hl: 2.15, mass: 1200,
    wheelR: 0.34, wheelW: 0.22, rest: 0.35, stiff: 30, slip: 2.2,
    engine: 2200, maxKmh: 110, steerMax: 0.55,
    settle: 0.274,             // suspension length when parked (measured in a physics test); used to place models
    modelUrl: null,            // e.g. '/assets/models/vehicles/car.glb' (see guide)
    modelHasWheels: false,
  },
  carry: {
    name: 'Suzuki Carry van',
    hw: 0.8, hh: 0.65, hl: 1.73, mass: 850,
    wheelR: 0.26, wheelW: 0.28, rest: 0.3, stiff: 28, slip: 2.4,
    engine: 1700, maxKmh: 95, steerMax: 0.6,
    settle: 0.217,
    // wheel layout measured from the model (metres, relative to the model centre)
    wheelX: 0.62, wheelZFront: 0.96, wheelZRear: -0.94,
    modelUrl: '/assets/models/vehicles/suzuki-carry.glb',   // body + 4 separate wheel nodes (wheel_FL/FR/RL/RR)
    modelWheelCenterY: 0.16,   // height of the wheel centres inside the model
    fallback: 'car',           // placeholder shape shown while the model loads
  },
  danfo: {
    name: 'Danfo bus',
    hw: 1.0, hh: 0.85, hl: 2.6, mass: 2200,
    wheelR: 0.38, wheelW: 0.26, rest: 0.4, stiff: 34, slip: 2.0,
    engine: 3300, maxKmh: 75, steerMax: 0.5,
    settle: 0.332,
    modelUrl: null,            // e.g. '/assets/models/vehicles/danfo.glb'
    modelHasWheels: false,
  },
};

const STEP = 1 / 60;

// ---------- Physics world ----------
export class Physics {
  static async create() {
    await RAPIER.init();
    return new Physics();
  }

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;
    this.vehicles = [];
    this.acc = 0;
    // flat ground at y = 0 (replace with a heightfield when terrain arrives)
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(1500, 0.5, 1500).setTranslation(0, -0.5, 0).setFriction(1)
    );
  }

  // footprints: [{ pts: [[x,z],...], h }]  -> one convex collider per building
  addBuildings(footprints) {
    let n = 0;
    for (const f of footprints) {
      const v = new Float32Array(f.pts.length * 6);
      f.pts.forEach(([x, z], i) => {
        v.set([x, 0, z], i * 6);
        v.set([x, f.h, z], i * 6 + 3);
      });
      const desc = RAPIER.ColliderDesc.convexHull(v);
      if (!desc) continue;
      this.world.createCollider(desc.setFriction(0.4));
      n++;
    }
    return n;
  }

  // fixed 60 Hz stepping, independent of frame rate
  step(dt) {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 3) {
      for (const v of this.vehicles) v.ctrl.updateVehicle(STEP);
      this.world.step();
      this.acc -= STEP;
      steps++;
    }
    if (this.acc > STEP) this.acc = 0;
  }
}

// ---------- Placeholder models (replace with real GLB models later) ----------
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.4, ...o });
const glass = () => mat(0x0e141a, { roughness: 0.08, metalness: 0.9 });
function box(w, h, l, m, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

function buildCarBody(T) {
  const g = new THREE.Group();
  const paint = mat(0x9aa3ad);
  g.add(box(T.hw * 2, 0.55, T.hl * 2, paint, 0, -0.08, 0));                 // lower body
  g.add(box(T.hw * 1.8, 0.5, T.hl * 1.0, paint, 0, 0.45, -0.25));           // cabin
  g.add(box(T.hw * 1.84, 0.3, T.hl * 0.9, glass(), 0, 0.47, -0.25));        // windows
  const lamp = mat(0xffffff, { emissive: 0xfff2c0, emissiveIntensity: 1.5 });
  const tail = mat(0xaa0000, { emissive: 0x550000 });
  g.add(box(0.3, 0.14, 0.05, lamp, 0.62, 0.0, T.hl), box(0.3, 0.14, 0.05, lamp, -0.62, 0.0, T.hl));
  g.add(box(0.3, 0.14, 0.05, tail, 0.62, 0.0, -T.hl), box(0.3, 0.14, 0.05, tail, -0.62, 0.0, -T.hl));
  return g;
}

function buildDanfoBody(T) {
  const g = new THREE.Group();
  const yellow = mat(0xf2b705, { roughness: 0.45 });
  const brown = mat(0x5a2a14);
  g.add(box(T.hw * 2, T.hh * 2, T.hl * 2, yellow, 0, 0.05, 0));             // body
  g.add(box(T.hw * 2.03, 0.22, T.hl * 2.03, brown, 0, -0.1, 0));            // brown stripe
  g.add(box(T.hw * 2.03, 0.5, T.hl * 1.7, glass(), 0, 0.5, -0.2));          // side windows
  g.add(box(T.hw * 1.7, 0.5, 0.05, glass(), 0, 0.5, T.hl + 0.01));          // windscreen
  const lamp = mat(0xffffff, { emissive: 0xfff2c0, emissiveIntensity: 1.5 });
  g.add(box(0.28, 0.16, 0.05, lamp, 0.7, -0.35, T.hl + 0.02), box(0.28, 0.16, 0.05, lamp, -0.7, -0.35, T.hl + 0.02));
  g.add(box(T.hw * 1.9, 0.08, T.hl * 1.9, mat(0xd9d9d9), 0, T.hh + 0.1, 0)); // roof panel
  return g;
}
const BUILDERS = { car: buildCarBody, danfo: buildDanfoBody };

// ---------- Vehicle ----------
export class Vehicle {
  constructor(physics, scene, typeKey, x, z, heading = 0) {
    const T = (this.T = VEHICLE_TYPES[typeKey]);
    this.typeKey = typeKey;
    this.physics = physics;
    const world = physics.world;

    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, 1.5, z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setCcdEnabled(true)
        .setLinearDamping(0.05)
        .setAngularDamping(0.6)
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(T.hw, T.hh, T.hl).setMass(T.mass).setFriction(0.3),
      this.body
    );

    const c = (this.ctrl = world.createVehicleController(this.body));
    c.indexUpAxis = 1;
    c.setIndexForwardAxis = 2;
    const wx = T.wheelX ?? T.hw - 0.1, wy = T.wheelY ?? -T.hh + 0.1;
    const wzF = T.wheelZFront ?? T.hl - 0.65, wzR = T.wheelZRear ?? -(T.hl - 0.65);
    const spots = [[wx, wzF], [-wx, wzF], [wx, wzR], [-wx, wzR]]; // FL, FR, RL, RR  (+x = left)
    spots.forEach(([sx, sz]) =>
      c.addWheel({ x: sx, y: wy, z: sz }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, T.rest, T.wheelR)
    );
    for (let i = 0; i < 4; i++) {
      c.setWheelSuspensionStiffness(i, T.stiff);
      c.setWheelSuspensionCompression(i, 2.4);
      c.setWheelSuspensionRelaxation(i, 2.8);
      c.setWheelMaxSuspensionTravel(i, 0.3);
      c.setWheelMaxSuspensionForce(i, 100000);
      c.setWheelFrictionSlip(i, T.slip);
      c.setWheelSideFrictionStiffness(i, 1);
    }

    // visuals
    this.group = new THREE.Group();
    this.bodyVisual = BUILDERS[T.fallback ?? typeKey](T);
    this.group.add(this.bodyVisual);
    this.wheels = [];
    const tyre = mat(0x151515, { roughness: 0.9, metalness: 0 });
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Group();
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(T.wheelR, T.wheelR, T.wheelW, 20), tyre);
      cyl.rotation.z = Math.PI / 2;
      cyl.castShadow = true;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(T.wheelR * 0.5, T.wheelR * 0.5, T.wheelW + 0.02, 12), mat(0x9a9a9a));
      hub.rotation.z = Math.PI / 2;
      w.add(cyl, hub);
      w.rotation.order = 'YXZ';
      this.group.add(w);
      this.wheels.push(w);
    }
    scene.add(this.group);
    if (T.modelUrl) this.loadModel(T);

    this.steer = 0;
    this.input = { throttle: 0, steer: 0, handbrake: false };
    physics.vehicles.push(this);
    this.sync();
  }

  // Optional realistic model (GLB, facing +Z). If it has nodes named wheel_FL, wheel_FR, wheel_RL, wheel_RR
  // (pivot at each wheel centre) they become the real spinning/steering wheels.
  loadModel(T) {
    new GLTFLoader().load(T.modelUrl, (gltf) => {
      const m = gltf.scene;
      m.traverse((o) => { if (o.isMesh) o.castShadow = true; });

      const wheelNodes = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'].map((n) => m.getObjectByName(n));
      const hasWheelNodes = wheelNodes.every(Boolean);
      if (hasWheelNodes) wheelNodes.forEach((n) => n.parent.remove(n));

      // fit the body to the chassis length and centre it
      const b0 = new THREE.Box3().setFromObject(m);
      const s = (T.hl * 2) / (b0.getSize(new THREE.Vector3()).z || 1);
      m.scale.multiplyScalar(s);
      const b = new THREE.Box3().setFromObject(m);
      const centre = b.getCenter(new THREE.Vector3());
      m.position.x -= centre.x;
      m.position.z -= centre.z;
      // put the model's wheel centres where the physics wheels rest
      const wy = T.wheelY ?? -T.hh + 0.1;
      const settle = T.settle ?? T.rest * 0.85;
      const modelWheelY = (T.modelWheelCenterY ?? (b0.min.y + T.wheelR)) * s;
      m.position.y += wy - settle - modelWheelY;

      this.group.remove(this.bodyVisual);
      this.group.add(m);

      if (hasWheelNodes) {
        wheelNodes.forEach((node, i) => {
          this.wheels[i].clear();
          node.position.set(0, 0, 0);
          node.rotation.set(0, 0, 0);
          node.scale.setScalar(s);
          this.wheels[i].add(node);
        });
      } else if (T.modelHasWheels) this.wheels.forEach((w) => (w.visible = false));
    }, undefined, () => console.warn('Vehicle model not found:', T.modelUrl));
  }

  get position() { const t = this.body.translation(); return new THREE.Vector3(t.x, t.y, t.z); }
  get forward() { return new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.quaternion); }
  get heading() { const f = this.forward; return Math.atan2(f.x, f.z); }
  get forwardSpeed() { const v = this.body.linvel(); return v.x * this.forward.x + v.y * this.forward.y + v.z * this.forward.z; }
  get kmh() { return Math.abs(this.forwardSpeed) * 3.6; }

  setInput(i) { Object.assign(this.input, i); }

  update(dt) {
    const T = this.T, c = this.ctrl, inp = this.input;
    const fs = this.forwardSpeed, kmh = Math.abs(fs) * 3.6;
    let engine = 0, brake = 0;

    if (inp.throttle > 0) {
      if (fs < -1) brake = 25;                                       // moving backwards: brake first
      else engine = kmh < T.maxKmh ? T.engine * inp.throttle : 0;
    } else if (inp.throttle < 0) {
      if (fs > 1) brake = 28;                                        // moving forwards: brake
      else engine = kmh < 30 ? T.engine * 0.55 * inp.throttle : 0;  // reverse
    } else brake = 2.5;                                              // engine braking / rolling resistance

    for (let i = 0; i < 4; i++) {
      c.setWheelEngineForce(i, i >= 2 ? engine : 0);                 // rear-wheel drive
      c.setWheelBrake(i, brake);
    }
    if (inp.handbrake) { c.setWheelBrake(2, 60); c.setWheelBrake(3, 60); c.setWheelEngineForce(2, 0); c.setWheelEngineForce(3, 0); }

    // steering: positive angle = turn LEFT, so pressing right (input +1) gives a negative angle
    const target = (-inp.steer * T.steerMax) / (1 + kmh / 40);
    this.steer += (target - this.steer) * Math.min(1, dt * 8);
    c.setWheelSteering(0, this.steer);
    c.setWheelSteering(1, this.steer);

    this.sync();
  }

  sync() {
    const t = this.body.translation(), r = this.body.rotation();
    this.group.position.set(t.x, t.y, t.z);
    this.group.quaternion.set(r.x, r.y, r.z, r.w);
    for (let i = 0; i < 4; i++) {
      const cp = this.ctrl.wheelChassisConnectionPointCs(i);
      const len = this.ctrl.wheelSuspensionLength(i) ?? this.T.rest;
      const w = this.wheels[i];
      w.position.set(cp.x, cp.y - len, cp.z);
      w.rotation.set(this.ctrl.wheelRotation(i) ?? 0, i < 2 ? this.steer : 0, 0);
    }
  }

  // flip back onto its wheels
  resetUpright() {
    const t = this.body.translation();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.heading);
    this.body.setTranslation({ x: t.x, y: t.y + 1.5, z: t.z }, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}