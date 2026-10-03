import { describe, expect, it } from 'vitest';
import { FixedStepLoop, InputMap, RngStreams, ScriptedInput, hashState, type ScriptEvent } from '@gamekit/core';

// A toy sim that uses every core piece: RNG streams, input, fixed steps.
type Action = 'left' | 'right' | 'jump';
const bindings = { left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], jump: ['Space'] } as const;

function makeSim(seed: number) {
  const rng = new RngStreams(seed);
  const input = new InputMap<Action>(bindings);
  const s = { x: 0, y: 0, vx: 0, vy: 0, jumps: 0, coins: [] as number[], inputBits: 0 };
  const step = (dt: number, tick: number) => {
    const f = input.sample(tick);
    s.inputBits = (s.inputBits * 31 + f.bits) >>> 0;
    s.vx = (f.held('right') ? 4 : 0) - (f.held('left') ? 4 : 0) + rng.stream('wind').range(-0.1, 0.1);
    if (f.pressed('jump') && s.y === 0) { s.vy = 6; s.jumps++; }
    s.vy -= 9.81 * dt;
    s.x += s.vx * dt;
    s.y = Math.max(0, s.y + s.vy * dt);
    if (s.y === 0) s.vy = 0;
    if (rng.stream('coins').chance(0.05)) s.coins.push(rng.stream('coins').int(0, 99));
  };
  return { s, rng, input, step };
}

const script: ScriptEvent<Action>[] = [
  { tick: 5, action: 'right', type: 'down' },
  { tick: 30, action: 'jump', type: 'tap' },
  { tick: 90, action: 'right', type: 'up' },
  { tick: 95, action: 'left', type: 'down' },
  { tick: 140, action: 'jump', type: 'tap' },
  { tick: 200, action: 'left', type: 'up' },
];

/** Run with jittered frame times at `renderHz`; hash the state after step `ticks`. */
function run(seed: number, renderHz: number, ticks = 600) {
  const sim = makeSim(seed);
  const scripted = new ScriptedInput(sim.input, script);
  let frames = 0;
  let hash = '';
  const loop = new FixedStepLoop({
    hz: 60,
    step: (dt, tick) => {
      scripted.apply(tick);
      sim.step(dt, tick);
      if (tick === ticks - 1) hash = hashState({ s: sim.s, rng: sim.rng.getState() });
    },
    render: () => { frames++; },
  });
  const jitter = new RngStreams('frame-jitter').stream(String(renderHz));
  while (loop.tick < ticks) loop.advance((1 / renderHz) * jitter.range(0.8, 1.2));
  return { hash, frames };
}

describe('determinism', () => {
  it('same seed and inputs give the same hash at 30/60/144 Hz render rates', () => {
    const a = run(1234, 30);
    const b = run(1234, 60);
    const c = run(1234, 144);
    expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(c.frames).toBeGreaterThan(a.frames * 3);
    expect(b.hash).toBe(a.hash);
    expect(c.hash).toBe(a.hash);
  });

  it('a different seed gives a different hash', () => {
    expect(run(1, 60).hash).not.toBe(run(2, 60).hash);
  });

  it('recorded input replays to the same hash', () => {
    const live = makeSim(7);
    live.input.startRecording();
    const loop = new FixedStepLoop({ step: (dt, t) => live.step(dt, t) });
    for (let t = 0; t < 300; t++) {
      if (t === 10) live.input.keyDown('KeyD');
      if (t === 40) { live.input.keyDown('Space'); live.input.keyUp('Space'); } // tap inside one step
      if (t === 80) live.input.keyUp('KeyD');
      loop.runSteps(1);
    }
    const rec = live.input.stopRecording();
    const replay = makeSim(7);
    const scripted = new ScriptedInput(replay.input, rec);
    const loop2 = new FixedStepLoop({ step: (dt, t) => { scripted.apply(t); replay.step(dt, t); } });
    loop2.runSteps(300);
    expect(live.s.jumps).toBe(1);
    expect(hashState(replay.s)).toBe(hashState(live.s));
  });
});
