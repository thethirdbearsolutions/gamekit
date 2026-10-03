# Adopting gamekit in the sailing lab (`harbor/`)

For the session that owns `cozytown.ai` branch `czy-sailing-rapier`. This guide was written read-only from that branch at
`d0b24fa`. Nothing has been pushed to cozytown.ai. Line numbers drift, so search by name.

gamekit was partly extracted from this lab. Several pieces will look familiar, and in a few places the lab's version won.
Those are marked **(from harbor)**.

## Install

```jsonc
// harbor/package.json
"dependencies": { "gamekit": "github:thethirdbearsolutions/gamekit#<commit>" }
```

Imports are `gamekit/core`, `gamekit/render`, `gamekit/physics`, `gamekit/playtest`. Pin a commit. three and Rapier stay
the lab's own dependencies (gamekit only peers them).

## What to swap, in order

Each step is independent and can be its own PR. Run `npm test` and the shots after each one.

### 1. Playtest and capture scripts → `gamekit/playtest` (no sim changes)

| harbor | gamekit | Notes |
| --- | --- | --- |
| `scripts/record.mjs` (CZY-1144: stopped clock, `__harbor.frame(1/FPS)`, closed-loop pilot steering on true wind angle, captions per beat, jpeg frames → mp4) | `capture({ policy, policyEvery, beats, format: 'jpeg', fps })` | Same idea, generalised. The pilot becomes a `policy(state, ctx)` that returns `{ hold: ['left'] }`. Beats become `beats: [{ tick, caption, run }]`. Each beat's state is in `result.log`. |
| `scripts/playtest.mjs` (naive-kid key scenarios, sim advanced in slices, transcript) | `capture({ script, beats })` for scripted steps. `runBot` for real-time play with video. | Scenario steps (`tap`/`down`/`up`/`wait`) map onto a `script` of `{ tick, action, type }`. `holdsToScript` takes `{ action: [start, end) }`. |
| `scripts/screenshot.mjs` | `capture({ ticks, every: ticks, sheet: false, fps: 0 })` per scenario, or a loop over `page.screenshot` like `waterfall-falls/scripts/captures.mjs` | |
| Self-started vite server + hard-coded Chromium path | `serveVite(root)`, `launchBrowser()` | `launchBrowser` finds `/opt/pw-browsers` itself (`GAMEKIT_CHROMIUM` overrides) and adds the SwiftShader flags. |

The game side: add `window.__game` next to `__harbor` (keep `__harbor` for the existing scripts):

```ts
window.__game = {
  state: () => window.__harbor.state(),
  actions: { left: ['ArrowLeft'], right: ['ArrowRight'], sailUp: ['ArrowUp'], sailDown: ['ArrowDown'], dock: ['Enter'], anchor: ['KeyQ'] },
  hash: () => sim.hash(),
  // n fixed steps (the existing advance() loop, without its camera snap), then one render
  step: (n = 1) => { for (let i = 0; i < n; i++) { controls.tick(STEP); sim.step(); renderer.tickVisuals(STEP); } renderer.render(1, STEP); },
  pause: () => (paused = true), resume: () => (paused = false),
};
```

`?paused=1` already starts frozen, which is what `capture()` expects.

### 2. Core → `gamekit/core`

| harbor `src/core` | gamekit/core | Expected diffs |
| --- | --- | --- |
| `FixedStepLoop(stepFn, step, maxSteps)`: `.advance(dt)`, `.alpha`, `.steps` | `new FixedStepLoop({ hz: 60, step: (dt, tick) => …, render: (alpha) => … })`: `.advance(dt)`, `.alpha`, `.tick`, `.runSteps(n)` | Same semantics. The harbor loop clamps the backlog before stepping. gamekit steps up to the cap and reports `dropped` seconds. A stalled tab behaves the same. |
| `Rng` (mulberry32, `fork(label)`) | `RngStreams(seed).stream(name)` (sfc32, streams derived from (seed, name)) | **Every seeded layout changes.** Archipelagos, ports and wave parameters are generated from the seed, so swapping the generator gives new worlds for old seeds. Two options: (a) keep harbor's `Rng` for world generation, and use gamekit streams for new systems only; or (b) swap everything and bump the layout version, as canopy does with `{ seed, layoutVersion }`. **Option (a) is recommended**: saves and shared seeds keep their worlds. Note that `fork()` derives from the parent's *current* state, so the order of forks matters. `RngStreams` doesn't have that hazard. |
| `hash3`, `hash01`, `seedFrom` | `hash32`, `hash01` **(from harbor)**, `hashString` | `hash32` is harbor's `hash3`, bit for bit. `hashString` is not `seedFrom`: keep `seedFrom` wherever a seed string must map to the same number as before. |
| `StateHasher` (FNV-1a, 32-bit, `num`/`array`) | `Hasher` (`f64`/`u32`/`value`, 64-bit digest) or `hashState(obj)` | **Golden hashes change.** Regenerate `GOLDEN` in `test/design.test.ts` once and review it in the PR. gamekit treats `-0` as `0` and all NaNs as equal; harbor didn't. |
| `KeyboardControls` (event-driven; hold-to-repeat sail levels; touch and gamepad call the same API) | `InputMap` for the key → action layer only | Keep `KeyboardControls` as the *game* layer (levels, repeat, hooks), and feed it from `InputMap.sample(tick)` once per step instead of from raw events. Touch and gamepad call `input.actionDown/actionUp`. What you gain: taps shorter than a step are latched, and input can be recorded and replayed (`startRecording()` → `ScriptedInput`). Expected diff: a level key pressed and released within one step now always registers. Today it depends on event timing. |

### 3. Physics bridge → `gamekit/physics` (thin)

| harbor | gamekit | Notes |
| --- | --- | --- |
| `initPhysics()` | `initRapier(RAPIER)` with the lab's `@dimforge/rapier2d-deterministic-compat` | Memoised per module. |
| `prevX/prevY/prevAngle` on `Ship` + `lerpAngle` in the renderer | `PhysicsStepper.track(body)` + `interpolated(body, alpha)` | Works with rapier2d. The 2D angle interpolates on the short arc, as `lerpAngle` does. Optional: the ships' own prev fields work fine. |
| Hull, sail, oar and grounding forces | — | These are the game. They stay in harbor. `applyBuoyancy` is 3D. |

### 4. Rendering → `gamekit/render`

The sailing lab's water was the main source for gamekit's water. These came **from harbor**:
- depth from a baked elevation texture: shallows tint, shore foam, shoaling;
- distance-faded noise ripples;
- the camera-following warped ocean grid (`oceanGrid`, `followCamera`);
- sky drawn at the far plane.

| harbor `src/render` | gamekit/render | Notes |
| --- | --- | --- |
| `water.ts` `WaterSurface` | `createWaterMaterial({ waves, elevation, deep, mid, shallow, … })` + `oceanGrid(3000, 220)` + `followCamera(mesh, cam, 4)` | Upload the heightfield with `elevationTexture()` or wrap the existing half-float texture as `{ texture, bounds }`. Harbor's sim y axis is **−world z**, and gamekit works in world xz throughout. Map `(x, y)` → `(x, −y)` once, where the texture bounds are set. The stencil hull mask (CZY-1138) is plain material state: set `stencilWrite`/`stencilRef`/`stencilFunc` on the returned material as now. Defaults close to harbor's look: `fresnel: { min: 0, max: 0.55 }`, `glint: { sharpness: 180, intensity: 1.2 }`, `ripples: { strength: 1.6, shade: 1 }`, `alpha: [0.38, 0.9]`. |
| `world/waves.ts` `WaveField` (4 sine waves, weather `scale`, `shoaling(depth)`) | `WaveSet` with `steepness: 0` (sine waves, no horizontal motion), `.scale`, `WaveSet.shoaling(depth, 0.5, 6)` | Ships keep sampling the swell from TS (`heightAt`), and the shader samples the same function. **Expected diff:** a different generator seeds wave directions and phases unless you build the `Wave[]` from `WaveField`'s arrays, which keeps the sea identical. Set `steepness > 0` for Gerstner crests. Then use `heightAt`, which solves for the drawn surface. |
| `sky.ts` `buildSky` | `new SkyDome({ zenith, horizon, sunSharpness: 900, sunIntensity: 3, glow: 0.18, haze: 0 })` | Already follows the camera and draws at the far plane, as harbor's does. |
| Renderer setup: `toneMapping = ACESFilmic`, `exposure = 1.05`, `renderer.render` | `HdrPipeline(renderer, scene, camera, { toneMapping: 'aces', exposure: 1.05 })` + `installDisplayFog(1.05)` | See the next section before switching. |

**Tone mapping: what will shift, and how to keep the look.** Harbor's water, sky and terrain shaders end with
`#include <colorspace_fragment>` but not `<tonemapping_fragment>`. Drawn to the canvas, they get sRGB but never ACES,
while built-in materials (ships, sails) get both. In an HDR pipeline everything gets ACES, and those shaders shift; that
is the bug waterfall-falls hit as FALLS-14/49. To keep today's look:
- gamekit's water and sky: pass `colorMode: 'untonemapped'` (GPU-tested to match within 3/255).
- Your own terrain shader: prepend `modeGlsl('untonemapped')`, end with `gl_FragColor.rgb = toScene( col )`, and add
  `modeUniforms(1.05)` to its uniforms.
- Call `installDisplayFog(1.05)` before anything compiles. three fogs built-in materials after tone mapping, and the
  pipeline would otherwise haze the distance.

With that, a frame should match today's except for intended changes: bloom on glints and the sun, MSAA, dither. Prove it
the way waterfall-falls did (`docs/gamekit-adoption/` on its `gamekit-adoption` branch): before/after stills plus a
same-build noise floor.

## What stays in harbor

Ship designs, rigs, sails, cloth, hull forms, wind, weather, ports, archipelago generation, HUD, chart, the CZY
`HarborScene` adapter and save shapes. Palettes and tuning constants also stay. gamekit takes none of them.

## Checklist for the PR

- [ ] `npm test` green; golden hashes regenerated once, with the reason in the commit
- [ ] determinism test at 30/60/144 Hz still passes (copy gamekit's `packages/core/test/determinism.test.ts` pattern)
- [ ] `record`/`playtest` scripts ported to `capture()` and producing the same sessions
- [ ] before/after stills of the standard shots, with noise floor
- [ ] no `Math.random` (harbor already holds this line)
