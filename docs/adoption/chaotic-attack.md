# Adopting @gamekit/render's curved world in chaotic-attack

Status: **read-only note**. Nothing has been pushed to chaotic-attack. Based on `src/bend.ts` at `ff7c1a3`.

## What gamekit's `CurvedWorld` is

`CurvedWorld` is `src/bend.ts` (ATK-34/38/39/46/54) generalised. The path model, the arc sums and the chunk patches are the
same. `BendPath.pathAt` and `bend` are `pathAt` and `bendPoint` with a `y` argument. The changes:

| bend.ts | gamekit | Why |
| --- | --- | --- |
| No culling fix | `curved.updateBounds(scene)` every frame bends each object's culling sphere, through `intersectsFrustum`, which the camera pass and the shadow-map pass both use | Things round a turn were culled (or lost their shadows) by where they'd be on the straight. A browser test shows a box 80 m down a quarter turn drawing 0 calls before and 1 after. |
| Patched chunks always call `bendWorld` | Patched chunks bend only under `GAMEKIT_BEND`, which is defined when the declarations are injected | A material the patch misses draws straight instead of failing to compile. |
| Overwrites `Material.prototype.onBeforeCompile` | Same default, plus `curved.attach(mat)` to chain onto a material's own hook, and `curved.inject(shader)` for custom code | Materials with their own `onBeforeCompile` (water, foliage) silently lost the bend. |
| Mutates every `ShaderLib` program up front | Declarations go in at compile time, only into shaders that bend | Custom `ShaderMaterial`s can call `bendWorld()` themselves and pick up the shared uniforms. |
| `WIDEN`, `uSide`, `widenAt` built in | A `pre` GLSL hook plus `uniforms` | Road widening is chaotic-attack's own and stays in the game. |
| `unbent()` sets `customDepthMaterial` | Also sets `customDistanceMaterial` | Point-light shadows stay unbent too. |
| — | `path.fromCurvature(k)` builds samples from a turn rate. `path.drop` adds an optional planet-style horizon drop | Shared with other games. |

## ATK-45

ATK-45 ("far side of a roundabout drawn running straight off at an angle") describes the v1 sideways-only bend. ATK-54's
path-following bend, which gamekit keeps, removes that limit: arcs can turn any amount. The ticket looks stale and can
probably be closed once someone checks a roundabout in play. The open bug that remains in this family is culling, which
`updateBounds` fixes.

## Swap, step by step

```ts
// main.ts
import { CurvedWorld } from '@gamekit/render';
const curved = CurvedWorld.install({
  samples: 65, step: 3,
  uniforms: { uSide: { value: sideBuf } },        // the game's own widening data
  pre: WIDEN_GLSL,                                // the WIDEN block from bend.ts, wrapped as vec4 bendPre( vec4 w ) under #ifdef WIDEN
});
// per frame (where setPath/setSides/setCut were called):
curved.path.set(pathBuf); curved.path.cut = course.pathAhead(state.dist, pathBuf); curved.sync();
scene.updateMatrixWorld(); curved.updateBounds(scene);
```

| bend.ts | gamekit |
| --- | --- |
| `installBend()` | `CurvedWorld.install(opts)` |
| `setPath(buf)` | `curved.path.set(buf)` |
| `setCut(s)` | `curved.path.cut = s; curved.sync()` |
| `straighten()` | `curved.path.straighten()` |
| `pathAt(s)` | `curved.path.pathAt(s)` |
| `bendPoint(x, z)` | `curved.path.bend(x, 0, z)` (returns `y` too) |
| `unbent(obj)` | `curved.unbent(obj)` |
| `widened(obj)`, `setSides`, `widenAt` | Stay in the game. Keep `widened()` setting the `WIDEN` define and a `WIDEN` depth material. The GLSL moves into `pre`. |

Uniform names change from `uPath`/`uCut` to `uBendPath`/`uBendCut`. Only bend.ts uses them.

## Expected diffs

- bend.ts goes from about 270 lines to about 60 (the widening hook and its helpers).
- Visual: identical on the straight and through turns. Objects that used to pop out round tight curves now stay drawn.
  Shadows round curves are no longer dropped.
- Cost: one sphere transform per object per frame in `updateBounds`. That is negligible next to the draw calls it saves.
