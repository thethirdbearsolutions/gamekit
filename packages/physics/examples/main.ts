// A capsule character walking through a stack of crates on a floating raft.
// Physics at 60 Hz through @gamekit/core's loop; rendering interpolated.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { FixedStepLoop, InputMap, hashState } from '@gamekit/core';
import { Character, PhysicsStepper, applyBuoyancy, createWorld, dynamicBody, emptyPose, initRapier } from '@gamekit/physics';

await initRapier();
const world = createWorld();
const stepper = new PhysicsStepper(world);
world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.5, 6).setTranslation(-10, -0.5, 0));
const ch = new Character(world, { position: { x: -14, y: 2, z: 0 } });
stepper.track(ch.body);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb7d9);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(5, 10, 4);
scene.add(sun);
const floor = new THREE.Mesh(new THREE.BoxGeometry(40, 1, 12), new THREE.MeshStandardMaterial({ color: 0x6b8f4e }));
floor.position.set(-10, -0.5, 0);
scene.add(floor);
const sea = new THREE.Mesh(new THREE.PlaneGeometry(60, 30).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a6f97, transparent: true, opacity: 0.8 }));
sea.position.set(25, 0, 0);
scene.add(sea);

const things: { body: RAPIER.RigidBody; mesh: THREE.Mesh }[] = [];
for (let i = 0; i < 9; i++) {
  const b = stepper.track(dynamicBody(world, { x: -4 + (i % 3) * 0.55, y: 0.25 + Math.floor(i / 3) * 0.52, z: 0 }, { maxSpeed: 15, thinnest: 0.5 }));
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.25, 0.25, 0.25), b);
  things.push({ body: b, mesh: new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0xc08040 })) });
}
const raft = stepper.track(dynamicBody(world, { x: 14, y: 1, z: 0 }, { maxSpeed: 10, thinnest: 0.3 }));
world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.15, 1.5).setDensity(300), raft);
things.push({ body: raft, mesh: new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 3), new THREE.MeshStandardMaterial({ color: 0x9a7b4f })) });
const avatar = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1), new THREE.MeshStandardMaterial({ color: 0xe0604a }));
for (const t of [...things.map((t) => t.mesh), avatar]) scene.add(t);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

const input = new InputMap({ left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], jump: ['Space'] });
input.attach(window);
const wave = (x: number, t: number) => 0.15 * Math.sin(x * 0.6 + t * 1.5);
const raftPoints = [-1.8, 1.8].flatMap((x) => [-1.3, 1.3].map((z) => ({ x, y: -0.15, z })));
const pose = emptyPose();
const hud = document.getElementById('hud')!;
let time = 0;

const loop = new FixedStepLoop({
  step: (dt, tick) => {
    const f = input.sample(tick);
    time = tick * dt;
    ch.move(dt, ((f.held('right') ? 1 : 0) - (f.held('left') ? 1 : 0)) * 4, 0, f.pressed('jump') ? 7 : 0);
    raft.resetForces(true);
    raft.resetTorques(true);
    applyBuoyancy(raft, { points: raftPoints, heightAt: (x) => wave(x, time), volume: 4 * 0.3 * 3, depth: 0.3 });
    stepper.step(dt);
  },
  render: (alpha) => {
    for (const t of things) {
      stepper.interpolated(t.body, alpha, pose);
      t.mesh.position.set(pose.p.x, pose.p.y, pose.p.z);
      t.mesh.quaternion.set(pose.q.x, pose.q.y, pose.q.z, pose.q.w);
    }
    stepper.interpolated(ch.body, alpha, pose);
    avatar.position.set(pose.p.x, pose.p.y, pose.p.z);
    camera.position.set(pose.p.x + 2, 4, 11);
    camera.lookAt(pose.p.x + 2, 1, 0);
    renderer.render(scene, camera);
    hud.textContent = `tick ${loop.tick}  grounded ${ch.grounded}\n←/→ walk, Space jump`;
  },
});

declare global { interface Window { __game: unknown } }
window.__game = {
  state: () => ({ tick: loop.tick, x: ch.position.x, y: ch.position.y, grounded: ch.grounded, raftY: raft.translation().y }),
  actions: { left: ['ArrowLeft'], right: ['ArrowRight'], jump: ['Space'] },
  hash: () => hashState(stepper.snapshot()),
  step: (n = 1) => { loop.runSteps(n); loop.advance(0); },
  pause: () => loop.stop(),
  resume: () => loop.start(),
};
if (new URLSearchParams(location.search).get('paused') !== '1') loop.start();
