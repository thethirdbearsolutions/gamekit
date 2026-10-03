# @gamekit/playtest

Closed-loop playtest bots for browser games, plus deterministic frame-stepped capture. Node + Playwright, using the Chromium
preinstalled at `/opt/pw-browsers` (override with `GAMEKIT_CHROMIUM`; never run `playwright install`). WebGL runs on SwiftShader,
so it works in headless containers. Needs `ffmpeg` on `PATH` (or `FFMPEG`).

## The page contract

A game opts in by exposing one object:

```ts
window.__game = {
  state: () => ({ ...plainData }),            // what a bot may observe
  actions: { left: ['ArrowLeft'], jump: ['Space'] }, // action → keys; the first key is pressed
  events: () => sim.events,                    // optional: [{ type, ... }]
  hash: () => hashState(sim),                  // optional: @gamekit/core digest
  step: (n = 1) => { loop.runSteps(n); draw(); }, // optional: needed for frame-stepped capture
  pause: () => loop.stop(), resume: () => loop.start(),
};
```

Start paused when the URL has `?paused=1`. A page that can't add `__game` yet can be adapted from the bot side with
`readState` + `actions` (see `examples/canopy-bot.mjs`).

## Real-time bot (what a player would see)

A policy maps state to keys. The harness reads state, calls the policy, diffs held keys and presses real keys, records video
with Playwright and converts it to mp4, and writes metrics and an event log to `<name>.json`.

```js
import { runBot } from '@gamekit/playtest';
const r = await runBot({
  name: 'climb', url: 'http://127.0.0.1:5199/game/?seed=1', outDir: 'out',
  policy: (s, ctx) => s.won ? { done: true } : { hold: ['right'], tap: s.onGround ? ['jump'] : [] },
  limitS: 60, metrics: (s) => ({ y: s.y }), watch: ['mode'],
});
// out/climb.mp4, out/climb.json  { done, wallSeconds, keyPresses, summary, gameEvents, log: { counters, events, samples } }
```

`Decision` = `{ hold?, tap?, waitMs?, done?, note? }`. `ctx` = `{ t, memory, params }`. `runBots([...])` plays variants in one browser.

## Frame-stepped capture (deterministic)

The page starts paused; the harness sends scripted key events, calls `__game.step(1)` per tick, and screenshots every `every`
ticks. Output is identical on any machine however slow, and the mp4 plays at true speed.

```js
import { capture } from '@gamekit/playtest';
await capture({ name: 'jump', url, outDir: 'out', ticks: 240, every: 4,
  script: [{ tick: 0, action: 'right', type: 'down' }, { tick: 20, action: 'jump', type: 'tap' }],
  sheet: { frames: 12, cols: 4 }, strip: { frames: 8 } });
// out/jump.mp4, out/jump-sheet.png, out/jump-strip.png, out/jump-capture.json (hash per captured frame)
```

Comparing `hashes` between two captures is a regression test for determinism; comparing sheets is a visual diff.

Also: `writeGallery(outDir)` (static index.html over a run), `serveStatic(dir)`, `contactSheet`, `strip`, `webmToMp4`,
`framesToMp4`, `RunLog`.

## Examples

- `examples/climber-bot.mjs` plays the `@gamekit/core` climber example both ways. Run `npm run build`, `npm run examples`
  in another shell, then `node packages/playtest/examples/climber-bot.mjs`. Open `out/climber/index.html`.
- `examples/canopy-bot.mjs` is the seed tree-climbing bot (`seed/canopy-playtest-bot.mjs`) ported onto the harness: the
  three variant policies as pure functions, everything else from the library.

## Lineage

This merges three tools. The real-time loop and video come from the canopy seed bot. Frame stepping follows the sailing
lab's recorder (CZY-1144). Sheets and strips replace canopy's capture script.
