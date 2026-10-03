# @gamekit/core

Small, framework-free runtime pieces every game here was writing for itself.

| Module | What it does |
| --- | --- |
| `FixedStepLoop` | Accumulator loop: simulation in whole steps of `1/hz`, rendering with an interpolation `alpha`. Caps steps per frame and reports dropped time instead of spiralling. `runSteps(n)` for headless runs and frame-stepped capture. |
| `Rng`, `RngStreams` | sfc32 generator seeded by a hash of (seed, stream name). Named streams are independent: extra draws in `"weather"` never shift `"loot"`. State save/restore. |
| `InputMap` | Each key (`KeyboardEvent.code`) binds to exactly one action. Raw events are buffered and read once per step with `sample(tick)`; a tap shorter than a step is latched and still seen as one press. Record and replay. |
| `ScriptedInput` | Feeds a `{tick, action, type}` script through the same buffer, for tests and bots. |
| `hashState` | 64-bit digest over a canonical walk (sorted keys, exact float64 bits). |

```ts
import { FixedStepLoop, InputMap, RngStreams, hashState, lerp } from '@gamekit/core';

const rng = new RngStreams(seed);
const input = new InputMap({ left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], jump: ['Space'] });
input.attach(window);

const loop = new FixedStepLoop({
  hz: 60,
  step(dt, tick) {
    const f = input.sample(tick);          // exactly once per step
    if (f.pressed('jump')) jump();
    world.step(dt, rng.stream('wind'));
  },
  render(alpha) { draw(lerp(prev.x, curr.x, alpha)); },
});
loop.start();
console.log(hashState(world.snapshot()));
```

## Determinism rules

- Read input only through `sample(tick)` inside `step`. Never read `Date.now()`, `performance.now()` or `Math.random()` in a step.
- Give every system its own stream: `rng.stream('spawns')`. Never share one generator across systems.
- The hash covers exactly what you hand it. Include the RNG state (`rng.getState()`).
- `test/determinism.test.ts` shows the check every game should copy: the same seed and script give the same hash with 30, 60 and 144 Hz render rates (with jittered frame times).

## Example

`npm run examples`, then open <http://127.0.0.1:5199/packages/core/examples/>: a seeded ledge climber. It exposes `window.__game` for `@gamekit/playtest`.
