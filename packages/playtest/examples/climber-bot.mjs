// Plays the @gamekit/core climber example two ways:
//  1. real time, real key presses, recorded to mp4 (what a player would see);
//  2. frame-stepped from a scripted input, for deterministic sheets/strips.
// Run: npm run build && npm run examples (in another shell) && node packages/playtest/examples/climber-bot.mjs
import { capture, runBot, writeGallery } from '@gamekit/playtest';

const BASE = process.env.URL ?? 'http://127.0.0.1:5199/packages/core/examples/';
const OUT = process.env.OUT ?? 'out/climber';
const SEED = process.env.SEED ?? 'gamekit';

/** Head for the lowest ledge above us; jump when lined up with it. */
function climberPolicy(s, ctx) {
  if (s.won) return { done: true, note: 'goal' };
  // Aim from where we last stood, so the target doesn't change mid-jump.
  if (s.onGround) ctx.memory.base = s.y;
  const base = ctx.memory.base ?? 0;
  const next = s.ledges.filter((l) => l.y > base + 1).sort((a, b) => a.y - b.y)[0];
  if (!next) return { hold: [] };
  const cx = next.x + next.w / 2;
  const dx = cx - s.x;
  const hold = Math.abs(dx) > 12 ? [dx > 0 ? 'right' : 'left'] : [];
  // Jump from the ground once the ledge is within the arc's reach and we're
  // already running at it (or right underneath), or we're about to run off our ledge.
  const here = s.ledges.find((l) => l.y === s.y && s.x >= l.x && s.x <= l.x + l.w);
  const atEdge = here && here.w < 600 && (dx > 0 ? here.x + here.w - s.x : s.x - here.x) < 14;
  const lined = atEdge || (Math.abs(dx) < next.w / 2 + 60 && (Math.abs(dx) < 20 || s.vx * Math.sign(dx) > 150));
  const tap = s.onGround && lined && ctx.t - (ctx.memory.lastJump ?? -1) > 0.25 ? ['jump'] : [];
  if (tap.length) ctx.memory.lastJump = ctx.t;
  return { hold, tap };
}

const live = await runBot({
  name: 'climber-live', url: `${BASE}?seed=${SEED}`, outDir: OUT, policy: climberPolicy, limitS: 45,
  viewport: { width: 640, height: 480 },
  metrics: (s) => ({ y: Math.round(s.y), best: s.best }),
  watch: ['onGround', 'best'],
});
console.log('live:', live.done ? 'reached goal' : 'timed out', `${live.wallSeconds}s`, live.video);

const stepped = await capture({
  name: 'climber-stepped', url: `${BASE}?seed=${SEED}`, outDir: OUT, ticks: 240, every: 4,
  viewport: { width: 640, height: 480 },
  script: [{ tick: 0, action: 'right', type: 'down' }, { tick: 20, action: 'jump', type: 'tap' }, { tick: 120, action: 'right', type: 'up' }],
  sheet: { frames: 12, cols: 4 }, strip: { frames: 8, width: 200 },
});
console.log('stepped:', stepped.frames, 'frames, final hash', stepped.hashes.at(-1)?.hash);
console.log('gallery:', await writeGallery(OUT, `climber seed ${SEED}`));
