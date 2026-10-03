import { describe, expect, it } from 'vitest';
import { FixedStepLoop, InputMap, Rng, RngStreams, hashState } from '@gamekit/core';

describe('FixedStepLoop', () => {
  it('runs whole steps and reports alpha', () => {
    const ticks: number[] = [];
    let alpha = -1;
    const loop = new FixedStepLoop({ hz: 10, step: (_dt, t) => ticks.push(t), render: (a) => { alpha = a; } });
    expect(loop.advance(0.25)).toBe(2);
    expect(ticks).toEqual([0, 1]);
    expect(alpha).toBeCloseTo(0.5);
  });

  it('caps steps per frame and records the dropped time', () => {
    const loop = new FixedStepLoop({ hz: 60, maxStepsPerFrame: 4, step: () => {} });
    expect(loop.advance(1)).toBe(4);
    expect(loop.dropped).toBeGreaterThan(0.9);
    expect(loop.alpha).toBeLessThan(1);
  });
});

describe('Rng', () => {
  it('is reproducible and streams are independent', () => {
    const a = new RngStreams(42);
    const b = new RngStreams(42);
    const xs = Array.from({ length: 5 }, () => a.stream('loot').next());
    // Draws on another stream must not shift "loot".
    for (let i = 0; i < 100; i++) b.stream('weather').next();
    expect(Array.from({ length: 5 }, () => b.stream('loot').next())).toEqual(xs);
    expect(new Rng(42, 'weather').next()).not.toBe(new Rng(42, 'loot').next());
  });

  it('stays in range and is roughly uniform', () => {
    const r = new Rng('seed');
    const bins = new Array(10).fill(0);
    for (let i = 0; i < 100000; i++) {
      const x = r.next();
      expect(x >= 0 && x < 1).toBe(true);
      bins[Math.floor(x * 10)]++;
    }
    for (const b of bins) expect(Math.abs(b - 10000)).toBeLessThan(500);
    for (let i = 0; i < 1000; i++) {
      const n = r.int(3, 5);
      expect(n >= 3 && n <= 5).toBe(true);
    }
  });

  it('save and restore state', () => {
    const r = new Rng(1);
    r.next();
    const s = r.getState();
    const x = r.next();
    r.setState(s);
    expect(r.next()).toBe(x);
  });
});

describe('InputMap', () => {
  const map = () => new InputMap({ jump: ['Space'], left: ['ArrowLeft', 'KeyA'] });

  it('refuses a key bound to two actions', () => {
    expect(() => new InputMap({ a: ['KeyX'], b: ['KeyX'] })).toThrow(/both/);
  });

  it('latches a tap that starts and ends between samples', () => {
    const m = map();
    m.keyDown('Space');
    m.keyUp('Space');
    const f = m.sample(0);
    expect(f.pressed('jump')).toBe(true);
    expect(f.held('jump')).toBe(true);
    expect(m.sample(1).pressed('jump')).toBe(false);
  });

  it('treats two keys for one action as one action', () => {
    const m = map();
    m.keyDown('ArrowLeft');
    expect(m.sample(0).pressed('left')).toBe(true);
    m.keyDown('KeyA');
    m.keyUp('ArrowLeft');
    const f = m.sample(1);
    expect(f.pressed('left')).toBe(false);
    expect(f.released('left')).toBe(false);
    expect(f.held('left')).toBe(true);
    m.keyUp('KeyA');
    expect(m.sample(2).released('left')).toBe(true);
  });

  it('ignores unbound keys and releases all on blur', () => {
    const m = map();
    expect(m.keyDown('KeyQ')).toBe(false);
    m.keyDown('Space');
    m.sample(0);
    m.releaseAll();
    expect(m.sample(1).released('jump')).toBe(true);
  });
});

describe('hashState', () => {
  it('ignores key order but not values', () => {
    expect(hashState({ a: 1, b: [1, 2] })).toBe(hashState({ b: [1, 2], a: 1 }));
    expect(hashState({ a: 1 })).not.toBe(hashState({ a: 1 + Number.EPSILON }));
    expect(hashState(new Float32Array([1, 2]))).not.toBe(hashState([1, 2]));
    expect(hashState(0)).toBe(hashState(-0));
  });
});
