# Adopting gamekit in tree climbing (`src/climb`, `canopy/`)

For the session that owns `cozytown.ai` branch `czy-tree-climbing-lab`. This guide was written read-only from that branch
at `ed731e0`. Nothing has been pushed to cozytown.ai. Line numbers drift, so search by name.

The climbing engine is plain JS on a 2D canvas, with its own collision and no three.js or Rapier. So only
`gamekit/core` and `gamekit/playtest` apply. `render` and `physics` don't, and that's expected: the climb's collision
*is* the game mechanic and stays.

gamekit's core design matches this lab's CZY-1123 work closely: one job per key, latched taps, fixed step with alpha,
step-indexed scripts. Some of it came **from canopy**: the loop's float epsilon and the `{ action: [start, end) }`
script format.

## Install

The game serves native ES modules with no bundler (`<script type="module" src="src/main.js">`). gamekit's built output
is plain ESM with relative imports and, for `core`, no dependencies. There are two ways in:

1. **Import map** (no copy):
   ```html
   <script type="importmap">{ "imports": { "gamekit/core": "./node_modules/gamekit/lib/core/index.js" } }</script>
   ```
   This needs `node_modules` served in dev and deploy. Otherwise vendor the files.
2. **Vendored**: copy `node_modules/gamekit/lib/core/` to `src/vendor/gamekit-core/` with a script after `npm install`,
   and import `./vendor/gamekit-core/index.js`. This is the safest choice for the single-file builds.

`canopy/` (vite) can import `gamekit/core` directly. In `package.json`: `"gamekit": "github:thethirdbearsolutions/gamekit#<commit>"`.

## What to swap

### `src/climb/core/loop.js` → `FixedStepLoop`

| canopy | gamekit/core |
| --- | --- |
| `new FixedStepLoop({ dt, maxSteps })` | `new FixedStepLoop({ hz: 60, maxStepsPerFrame: 8, step, render })` |
| `alpha = loop.advance(frameSeconds, stepFn)` | `loop.advance(frameSeconds)` calls `step(dt, tick)` and `render(alpha)`. Read `loop.alpha` anywhere. |
| `loop.steps` | `loop.tick` |
| `lerp` | `lerp` |

Same semantics, including the 1e-9 epsilon (taken from canopy). One small difference: canopy keeps the leftover backlog
when the step cap is hit (the sim runs slow), while gamekit drops it and reports `loop.dropped` (the sim skips ahead).
Both avoid the spiral. To keep "slow, not skip", pass `maxStepsPerFrame: Infinity` and clamp `frameSeconds` yourself, as
canopy does today.

### `src/climb/input/actions.js` → `InputMap`

| canopy | gamekit/core |
| --- | --- |
| `KEYMAP` code → action (each code once) | `new InputMap({ left: ['ArrowLeft', 'KeyA'], right: […], up: […], down: […], jump: ['Space', 'KeyZ'], leave: ['Escape'] })`. It throws if a code is bound twice. |
| `input.keyDown(code)` / `keyUp(code)` → `boolean` (bound?) | same names, same return |
| `input.clear()` (blur) | `input.releaseAll()`, or `input.attach(window)`, which handles keydown, keyup and blur, with `preventDefault` for bound keys |
| `input.sample()` → `{ held, pressed, released }` objects | `input.sample(tick)` → `frame.held(a)`, `frame.pressed(a)`, `frame.released(a)`, `frame.bits` |
| `scriptFrame(step, holds)` / `compileScript(holds)` | `holdsToScript(holds)` → `ScriptedInput(map, script).apply(tick)` before `sample(tick)` |

Semantics match, including "a tap down and up within one step counts as held for that step".

The sim reads `frame.held.up` (property) and gamekit's frame has `frame.held('up')` (method). Either change the variant
code (`held.up` → `held('up')`, mechanical) or adapt at the boundary:

```js
const toCanopy = (f) => ({ held: proxy(f.held), pressed: proxy(f.pressed), released: proxy(f.released) });
const proxy = (fn) => new Proxy({}, { get: (_, a) => fn(a) });
```

**Keep `compileScript` for reachability (CZY-1133).** It fills one reusable frame per step with no allocation, and the
generator runs about 10⁵ steps per tree. gamekit's `sample()` is cheap (three bitmasks), but it goes through key
events and a fresh small object every step. Use `ScriptedInput` for browser-level tests and captures, and
`compileScript` inside the generator.

### `src/climb/core/rng.js` → keep it (decision for the owning session)

| canopy | gamekit/core |
| --- | --- |
| `mulberry32(seed)`, `createRng(seed)` (`range`, `int`, `chance`, `pick`) | `new Rng(seed, stream)` / `RngStreams(seed).stream(name)` (`range`, `int`, `chance`, `pick`, `normal`, `shuffle`, state get/set) |
| `hashSeed(...parts)` | `hashString(str)` (different output) |

**Every tree changes** if the generator switches RNG, because layouts are identified by `{ seed, layoutVersion }` and saved
tree keys depend on that (CZY-1173). So either keep `rng.js` for `generateLayout`, or switch and bump `LAYOUT_VERSION`
with a save migration. **Recommended: keep it.** Use `RngStreams` for anything new that shouldn't shift the layout when
it draws (particles, ambient life).

The renderer's particles use `Math.random`. That's harmless for the sim hash, but frame-stepped captures differ in
sparks and leaves between runs. A `rng.stream('fx')` makes captures pixel-repeatable.

### `sim.digest()` → `hashState` (optional)

`digest()` is a compact comparable state for the determinism tests. `hashState(sim.snapshotForHash())` gives a 64-bit hex
digest over exact float bits, if you want one shape across games. Existing digests and tests would need regenerating once.

### Playtest: `canopy/scripts/capture.mjs` and the seed bot → `gamekit/playtest`

| canopy | gamekit/playtest |
| --- | --- |
| `window.canopy = { sim, place(fn), play(holds, n), pause, … }` | Add `window.__game = { state, actions, step(n), pause, resume, hash }` beside it, with `step(n)` = run n steps of the live input and render once. Keep `canopy.place`/`play`; they're good scene-setup helpers for `capture({ setup })`. |
| `scripts/capture.mjs`: per-variant shots via in-page helpers, frame strips from hold scripts | `capture({ setup: (page) => page.evaluate(() => H.onBridge()), script: holdsToScript({...}), ticks, every, strip: { frames: 8 } })` |
| Chromium candidates list | `launchBrowser()` (finds `/opt/pw-browsers`; `GAMEKIT_CHROMIUM` overrides) |
| The real-time bot in the playtester's scratch copy (`seed/canopy-playtest-bot.mjs` in gamekit) | `gamekit/packages/playtest/examples/canopy-bot.mjs`, already ported. The three variant policies are pure functions; the harness owns the browser, key diffing, video, mp4, logs and JSON. Once `__game` exists, drop its `readState`/`actions` adapter. |

Example of a frame strip in the new form:

```js
import { holdsToScript } from 'gamekit/core';
import { capture, serveVite } from 'gamekit/playtest';
const site = await serveVite(new URL('..', import.meta.url).pathname);
await capture({
  name: 'bark-route', url: `${site.url}?seed=20261003`, outDir: 'captures', ticks: 120, every: 4,
  setup: (page) => page.evaluate(() => H.onBridge()),   // the lab's in-page helpers, unchanged
  script: holdsToScript({ right: [0, 14], jump: [2, 4], up: [6, 120] }),
  strip: { frames: 8, width: 320 }, sheet: { frames: 12, cols: 4 },
});
```

## Expected diffs

- No visual change. Swapping loop and input gives bit-identical trajectories if `held`/`pressed` semantics are kept;
  run the existing 10/30/60/144 fps determinism test before and after.
- `maxSteps` overflow: see the loop note (skip ahead vs. slow down).
- Hashes or digests only change if you adopt `hashState`.

## What stays in canopy and the game

The sim, variants, collide, generator and reachability, renderer, palette and themes, the CZY scene adapter, and save
migration. All of it is the game.
