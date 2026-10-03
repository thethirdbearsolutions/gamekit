import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BendPath } from '../src/curved/path.js';
import { runPage, startRig, type Rig } from './browser.js';

describe('BendPath', () => {
  it('is the identity when straight', () => {
    const p = new BendPath();
    expect(p.bend(2, 1, -50)).toMatchObject({ x: 2, y: 1, z: -50, h: 0 });
    expect(p.bend(-1, 0, 5).z).toBeCloseTo(5);
  });

  it('a constant turn rate draws a circle', () => {
    const p = new BendPath({ samples: 65, step: 3 });
    const k = 1 / 20;
    p.fromCurvature(() => k);
    // A path turning right at 1/20 rad/m circles the centre (20, 0).
    for (const s of [5, 31.4, 62.8, 100, 150]) {
      const q = p.pathAt(s);
      expect(Math.hypot(q.x - 20, q.z)).toBeCloseTo(20, 3);
      expect(q.h).toBeCloseTo(k * s, 4);
    }
  });

  it('is continuous across samples and the end of range', () => {
    const p = new BendPath();
    p.fromCurvature((s) => Math.sin(s / 10) * 0.05);
    for (const s of [3, 6, 99, p.range]) {
      const a = p.pathAt(s - 1e-4), b = p.pathAt(s + 1e-4);
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1e-3);
    }
  });
});

describe('CurvedWorld in WebGL', () => {
  let rig: Rig;
  beforeAll(async () => { rig = await startRig(); }, 120_000);
  afterAll(() => rig?.close());

  it('GLSL bend matches the JS bend and culling follows the bend', async () => {
    const r = await runPage(rig, 'curved.html');
    expect(r.consoleErrors).toEqual([]);
    expect(r.maxErr).toBeLessThan(0.01);
    // Drawn well to the side of where it would be on the straight.
    expect(Math.abs(r.drawn.x)).toBeGreaterThan(20);
    expect(r.callsBefore).toBe(0); // culled by its unbent bounds (the ATK-45 class of bug)
    expect(r.callsAfter).toBe(1);
    expect(r.centre[0]).toBeGreaterThan(100); // and actually on screen where expected
  });
});
