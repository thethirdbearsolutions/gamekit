# @gamekit/physics

Deliberately thin helpers over [Rapier](https://rapier.rs) (`@dimforge/rapier3d-compat`) for what the sailing and climbing labs
both rebuilt. Use Rapier directly for everything else.

| Export | What |
| --- | --- |
| `initRapier(module?)` | Initialise a Rapier build's wasm once (memoised per module). The default is rapier3d-compat. Pass rapier2d or a `-deterministic` build to use it. |
| `createWorld({ gravity, dt, solverIterations })` | World with `timestep` set to the loop's step. |
| `PhysicsStepper` | Works with 2D and 3D Rapier. Call `step(dt)` from `FixedStepLoop`'s step. It refuses a `dt` that doesn't match the world. It remembers each tracked body's previous pose, so `interpolated(body, alpha)` gives smooth rendering at any refresh rate. `snapshot()` feeds `hashState`. |
| `Character` | Kinematic capsule + `KinematicCharacterController`: gravity, slopes, auto-step, snap-to-ground, pushes dynamic bodies. `move(dt, vx, vz, jumpSpeed)` once per step. |
| `withCcd(desc, { maxSpeed, thinnest })` / `needsCcd` / `dynamicBody` | CCD defaults. Full CCD when one step could carry a body past half of the thinnest thing it can hit. Otherwise use soft CCD prediction. |
| `applyBuoyancy(body, { points, heightAt, volume })` | Per-point Archimedes force plus drag. Give it the same `heightAt` the water shader uses (`@gamekit/render`'s `waveHeight`), so boats ride the waves you see. |

```ts
await initRapier();
const world = createWorld({ dt: 1 / 60 });
const stepper = new PhysicsStepper(world);
const hero = new Character(world, { position: { x: 0, y: 2, z: 0 } });
stepper.track(hero.body);
const loop = new FixedStepLoop({
  hz: 60,
  step(dt, tick) { const f = input.sample(tick); hero.move(dt, f.held('right') ? 4 : 0, 0, f.pressed('jump') ? 7 : 0); stepper.step(dt); },
  render(alpha) { const p = stepper.interpolated(hero.body, alpha); mesh.position.set(p.p.x, p.p.y, p.p.z); renderer.render(scene, cam); },
});
```

Rapier is deterministic on the same build and platform, so hash `stepper.snapshot()` in tests. Cross-platform determinism
needs the `-deterministic` Rapier build (the sailing lab uses `rapier2d-deterministic-compat`; there's a test for it).
`Character`, `withCcd` and `applyBuoyancy` are 3D.

Example: `npm run examples` → <http://127.0.0.1:5199/packages/physics/examples/>.
