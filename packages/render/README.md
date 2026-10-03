# @gamekit/render

three.js rendering pieces shared across the 3D games (WebGL today; see "WebGPU" below).

| Module | What | Status |
| --- | --- | --- |
| `HdrPipeline` | Scene-linear half-float render, linear-HDR bloom (threshold, selective by layer, or both), then exposure, AgX/ACES/Neutral tone mapping and sRGB, once. | Done, browser-tested |
| `auditShaders` | Flags custom shaders that fight the pipeline (in-shader gamma or tone mapping, clamped or encoded output). | Done |
| `CurvedWorld`, `BendPath` | Curved-world bend from chaotic-attack, plus culling bounds and shadows that follow the bend. | Done, browser-tested |
| `WaveSet`, `wavesGlsl` | One Gerstner wave definition for shaders and physics (`heightAt` for buoyancy). | Done, GLSL/TS parity-tested |
| Water shading (fresnel, foam, depth-aware), sky/atmosphere, fog/mist | To be extracted from the sailing lab's `harbor/` and waterfall-falls' `water.ts`/`sky.ts`/`waterfall.ts`. | **Blocked: no repo access yet** |

## HDR pipeline

```ts
import { HdrPipeline } from '@gamekit/render';
const hdr = new HdrPipeline(renderer, scene, camera, { toneMapping: 'agx', exposure: 1, bloom: { mode: 'selective', strength: 0.8 } });
hdr.selectBloom(lanterns);          // only these glow in 'selective'; 'both' adds true-HDR highlights (> threshold)
renderer.setAnimationLoop(() => hdr.render());
addEventListener('resize', () => hdr.setSize(innerWidth, innerHeight));
```

Rules for materials (built-in materials already follow them):

- Write **scene-linear** colour. Don't apply gamma, `LinearTosRGB` or tone mapping in a shader. Don't clamp to 1.
- Things meant to glow should be **bright** (emissive > 1), not merely white.
- Feed colours in linear: `new Color().setRGB(r, g, b, LinearSRGBColorSpace)`, or hex colours, which three converts.
- Run `auditShaders(scene)` once during development.

Why this order matters (the FALLS-49 class of bug) is in [docs/render/hdr.md](../../docs/render/hdr.md).

## Curved world

```ts
const curved = CurvedWorld.install();   // before the first shader compiles
curved.path.fromCurvature((s) => 0.02 * Math.sin(s / 30));   // or path.set([x, z, heading, ...])
curved.path.drop = 0.0004; curved.sync();                    // optional planet-style horizon drop
// each frame:
scene.updateMatrixWorld(); curved.updateBounds(scene); hdr.render();
```

Gameplay stays straight down −z. Drawing bends. `path.bend(x, y, z)` gives the drawn position on the CPU (camera aim, UI
markers). Custom shaders call `bendWorld(worldPos)`. `curved.unbent(obj)` opts something out, and its shadow too.
`curved.attach(mat)` chains onto a material's own `onBeforeCompile`. `pre`/`uniforms` options take game-specific warps
(chaotic-attack's road widening). See [docs/adoption/chaotic-attack.md](../../docs/adoption/chaotic-attack.md).

## Waves

```ts
const sea = WaveSet.wind({ direction: 0.3, wavelength: 22, amplitude: 0.7, count: 6, seed: 7 });
const u = waveUniforms(sea);            // share across materials; set u.uWaveTime.value each step
// vertex shader: wavesGlsl() + "w.xyz += gkWaveDisplace(w.xz, uWaveTime); n = gkWaveNormal(w.xz, uWaveTime);"
applyBuoyancy(boat, { points, volume, heightAt: (x, z) => sea.heightAt(x, z, time) });  // @gamekit/physics
```

## WebGPU

The pipeline and the bend are WebGL (`ShaderChunk`/`onBeforeCompile`). three's `WebGPURenderer` uses TSL node materials, so
WebGPU versions will be TSL ports of the same functions: `bendWorld` as a `positionNode`, waves as a TSL `Fn`, and the
pipeline on `PostProcessing` with `mrt`-based selective bloom. They will share the tests. Culling via `updateBounds` already
works with `WebGPURenderer`, because it uses the same `intersectsFrustum` hook.

## Example

`npm run examples` → <http://127.0.0.1:5199/packages/render/examples/>. T cycles tone maps, B cycles bloom modes, C toggles
the curve, ↑/↓ change exposure. The water there is a placeholder until extraction.
