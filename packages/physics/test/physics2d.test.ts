import RAPIER2D from '@dimforge/rapier2d-deterministic-compat';
import { describe, expect, it } from 'vitest';
import { FixedStepLoop, hashState } from '@gamekit/core';
import { PhysicsStepper, initRapier } from '@gamekit/physics';

// The sailing lab runs Rapier 2D (deterministic build); the same bridge serves it.
describe('PhysicsStepper with rapier2d', () => {
  const run = async () => {
    const R = await initRapier(RAPIER2D);
    const world = new R.World({ x: 0, y: -9.81 });
    world.timestep = 1 / 60;
    world.createCollider(R.ColliderDesc.cuboid(20, 0.5));
    const stepper = new PhysicsStepper(world);
    const box = stepper.track(world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0.2, 4).setRotation(0.4)));
    world.createCollider(R.ColliderDesc.cuboid(0.5, 0.5), box);
    new FixedStepLoop({ step: (dt) => stepper.step(dt) }).runSteps(90);
    return { stepper, box, hash: hashState(stepper.snapshot()) };
  };

  it('is deterministic and interpolates the 2D angle', async () => {
    const a = await run();
    expect((await run()).hash).toBe(a.hash);
    const mid = a.stepper.interpolated(a.box, 0.5);
    expect(mid.q.x).toBe(0);
    expect(Number.isFinite(mid.q.w)).toBe(true);
    expect(mid.p.z).toBe(0);
    expect(a.box.translation().y).toBeLessThan(4);
  });
});
