// The seed canopy bot (seed/canopy-playtest-bot.mjs) ported onto @gamekit/playtest.
// The harness now owns the browser, video, mp4, key diffing, logs and JSON;
// what stays here is only what is specific to the tree-climbing prototype:
// how to read its state and the three per-variant policies.
//
// Prefer the game exposing window.__game = { state, actions, events }; until
// it does, `readState` adapts its existing window.canopy.sim.
import { runBots, writeGallery } from '@gamekit/playtest';

const URL_BASE = process.env.URL ?? 'http://localhost:5178/';
const OUT = process.env.OUT ?? 'out/canopy';
const SEED = process.env.SEED ?? '20261003';
const VARIANTS = (process.env.VARIANTS ?? 'ledge,bark,grip').split(',');

const actions = { left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], grab: ['KeyX'], jump: ['Space'] };

// Runs in the page.
function readCanopy() {
  const sim = window.canopy.sim, c = sim.cat, w = sim.world;
  const goal = w.tops.find((t) => t.goal);
  const trunk = w.trunks.find((t) => t.id === goal.trunkId);
  const ledge = w.tops.filter((t) => t.trunkId === trunk.id && t.kind === 'branch' && !t.snapped && t.side === -1).map((t) => ({ y: t.y, x0: t.x0 }));
  return { x: c.body.x, y: c.body.y, w: c.body.w, mode: c.mode, grip: c.grip, trunk: c.trunk?.id ?? null,
    supportKind: c.support?.kind ?? null, goal: sim.reachedGoal, tx0: trunk.x0, tid: trunk.id, ledge, time: sim.time };
}

/** Same decisions as the seed bot, as a pure state → keys function. */
function canopyPolicy(s, ctx) {
  const variant = ctx.params.variant, m = ctx.memory;
  if (s.goal) return { done: true };
  const onGoalTrunk = s.trunk === s.tid;
  if (!onGoalTrunk && !['cling', 'hang', 'mantle'].includes(s.mode)) {
    const gap = s.tx0 - (s.x + s.w / 2);
    if (variant === 'grip' && s.mode === 'stand' && s.supportKind !== 'floor' && s.grip < 0.97) return { hold: [], waitMs: 60 };
    if (gap > 10) return { hold: ['right'] };
    if (gap < -2 && s.mode === 'stand' && s.supportKind === 'floor') return { hold: ['left'] }; // walked under the arch: back out
    const hold = ['right', 'up', ...(variant === 'ledge' ? ['grab'] : [])];
    if (s.mode === 'stand') { m.jumps = (m.jumps ?? 0) + 1; return { hold, tap: ['jump'], waitMs: 60 }; }
    return { hold };
  }
  if (variant === 'bark') return { hold: ['up'] };
  if (variant === 'ledge') return { hold: ['up', 'grab'] };
  // grip: steady beat; rest on a left branch when grip runs low.
  if (s.mode === 'cling' && s.grip < 0.35 && s.ledge.find((l) => l.y >= s.y - 2 && l.y <= s.y + 6)) {
    m.resting = true; return { hold: [], tap: ['left'], waitMs: 50 };
  }
  if (s.mode === 'stand' && m.resting) {
    if (s.grip < 0.97) return { hold: [], waitMs: 100 };
    m.resting = false; return { hold: ['right'], waitMs: 120 };
  }
  if (ctx.t - (m.lastPull ?? -1) >= 0.4) { m.lastPull = ctx.t; return { hold: [], tap: ['up'] }; }
  return { hold: [] };
}

const results = await runBots(VARIANTS.map((variant) => ({
  name: variant, url: `${URL_BASE}?variant=${variant}&seed=${SEED}`, outDir: OUT, policy: canopyPolicy, params: { variant },
  limitS: 75, leadInMs: 1200, leadOutMs: 2500, readState: readCanopy, actions, watch: ['mode'],
  metrics: (s) => ({ y: Math.round(s.y), grip: +s.grip.toFixed(2) }),
  summarize: () => {
    const sim = window.canopy.sim, counts = {};
    for (const e of sim.events) counts[e.type] = (counts[e.type] || 0) + 1;
    return { reachedGoal: sim.reachedGoal, simTime: +sim.time.toFixed(2), events: counts };
  },
})));
for (const [v, r] of Object.entries(results)) console.log(v, r.done ? 'goal' : 'timeout', r.wallSeconds, r.video);
await writeGallery(OUT, `canopy seed ${SEED}`);
