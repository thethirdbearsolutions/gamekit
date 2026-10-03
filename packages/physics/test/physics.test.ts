import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { FixedStepLoop, hashState } from '@gamekit/core';
import { Character, PhysicsStepper, applyBuoyancy, createWorld, dynamicBody, initRapier, needsCcd } from '@gamekit/physics';

beforeAll(async () => { await initRapier(); });

function ground(world: RAPIER.World) {
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
}

describe('physics', () => {
  it('character falls, lands, walks and jumps', () => {
    const world = createWorld();
    ground(world);
    const ch = new Character(world, { position: { x: 0, y: 3, z: 0 } });
    const stepper = new PhysicsStepper(world);
    const loop = new FixedStepLoop({ step: (dt, tick) => { ch.move(dt, 2, 0, tick === 120 ? 6 : 0); stepper.step(dt); } });
    loop.runSteps(110);
    expect(ch.grounded).toBe(true);
    expect(ch.position.y).toBeCloseTo(0.8, 1); // half-height + radius
    expect(ch.position.x).toBeGreaterThan(3);
    loop.runSteps(20);
    expect(ch.position.y).toBeGreaterThan(1.2);
  });

  it('CCD keeps a fast ball from tunnelling through a thin wall', () => {
    expect(needsCcd({ maxSpeed: 200, thinnest: 0.05 })).toBe(true);
    expect(needsCcd({ maxSpeed: 1, thinnest: 1 })).toBe(false);
    const world = createWorld({ gravity: { x: 0, y: 0, z: 0 } });
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.025, 5, 5).setTranslation(5, 0, 0));
    const ball = dynamicBody(world, { x: 0, y: 0, z: 0 }, { maxSpeed: 200, thinnest: 0.05 });
    world.createCollider(RAPIER.ColliderDesc.ball(0.05), ball);
    ball.setLinvel({ x: 200, y: 0, z: 0 }, true);
    for (let i = 0; i < 10; i++) world.step();
    expect(ball.translation().x).toBeLessThan(5);
  });

  it('buoyancy floats a box at the shared water height', () => {
    const world = createWorld();
    const box = dynamicBody(world, { x: 0, y: 2, z: 0 }, { maxSpeed: 10, thinnest: 1 });
    world.createCollider(RAPIER.ColliderDesc.cuboid(1, 0.5, 1).setDensity(400), box);
    const points = [-1, 1].flatMap((x) => [-1, 1].map((z) => ({ x, y: -0.5, z })));
    for (let i = 0; i < 600; i++) {
      applyBuoyancy(box, { points, heightAt: () => 0, volume: 2 * 1 * 2, depth: 1 });
      world.step();
      box.resetForces(true);
      box.resetTorques(true);
    }
    // 400 kg/m³ floats with 40% under: bottom at -0.4, centre near +0.1.
    expect(box.translation().y).toBeGreaterThan(-0.2);
    expect(box.translation().y).toBeLessThan(0.4);
    expect(Math.abs(box.linvel().y)).toBeLessThan(0.05);
  });

  it('is deterministic step for step and interpolates poses', () => {
    const run = () => {
      const world = createWorld();
      ground(world);
      const stepper = new PhysicsStepper(world);
      for (let i = 0; i < 5; i++) {
        const b = stepper.track(dynamicBody(world, { x: i * 0.3, y: 2 + i, z: 0 }, { maxSpeed: 20, thinnest: 0.5 }));
        world.createCollider(RAPIER.ColliderDesc.cuboid(0.25, 0.25, 0.25), b);
      }
      const loop = new FixedStepLoop({ step: (dt) => stepper.step(dt) });
      loop.runSteps(240);
      return { hash: hashState(stepper.snapshot()), stepper, world };
    };
    const a = run();
    expect(run().hash).toBe(a.hash);
    let body!: RAPIER.RigidBody;
    a.world.forEachRigidBody((b) => { if (b.isDynamic()) body = b; });
    const mid = a.stepper.interpolated(body, 0.5);
    expect(Number.isFinite(mid.p.y)).toBe(true);
    expect(Math.hypot(mid.q.x, mid.q.y, mid.q.z, mid.q.w)).toBeCloseTo(1, 6);
  });
});
