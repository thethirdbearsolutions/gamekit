import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WaveSet } from '../src/water/waves.js';
import { runPage, startRig, type Rig } from './browser.js';

const sea = () => WaveSet.wind({ direction: 0.4, wavelength: 18, amplitude: 0.6, count: 5, seed: 3 });

describe('WaveSet', () => {
  it('heightAt finds the height of the surface drawn over (x, z)', () => {
    const w = sea();
    for (const [x, z, t] of [[0, 0, 0], [3.3, -7, 2.5], [-12, 4, 9.1]]) {
      const d = w.displace(x, z, t);
      expect(w.heightAt(x + d.x, z + d.z, t, 8)).toBeCloseTo(d.y, 3);
    }
  });

  it('normal is perpendicular to the displaced surface', () => {
    const w = sea();
    const e = 1e-3;
    const P = (x: number, z: number) => { const d = w.displace(x, z, 4); return [x + d.x, d.y, z + d.z]; };
    for (const [x, z] of [[1, 2], [-5, 9]]) {
      const p = P(x, z), px = P(x + e, z), pz = P(x, z + e);
      const tx = px.map((v, i) => v - p[i]), tz = pz.map((v, i) => v - p[i]);
      const n = w.normalAt(x, z, 4);
      expect(Math.abs(tx[0] * n.x + tx[1] * n.y + tx[2] * n.z)).toBeLessThan(1e-5);
      expect(Math.abs(tz[0] * n.x + tz[1] * n.y + tz[2] * n.z)).toBeLessThan(1e-5);
      expect(n.y).toBeGreaterThan(0);
    }
  });

  it('scales steepness so the surface never folds over', () => {
    const w = new WaveSet([{ direction: 0, wavelength: 4, amplitude: 1, steepness: 1 }, { direction: 1, wavelength: 4, amplitude: 1, steepness: 1 }]);
    let qka = 0;
    for (let i = 0; i < w.packed.count; i++) qka += w.packed.b[i * 4 + 1] * w.packed.a[i * 4 + 2] * w.packed.a[i * 4 + 3];
    expect(qka).toBeLessThanOrEqual(1 + 1e-6);
  });
});

describe('waves in WebGL', () => {
  let rig: Rig;
  beforeAll(async () => { rig = await startRig(); }, 120_000);
  afterAll(() => rig?.close());

  it('GLSL displacement and normals match the TS used by physics', async () => {
    const r = await runPage(rig, 'waves.html');
    expect(r.consoleErrors).toEqual([]);
    expect(r.errD).toBeLessThan(2e-3);
    expect(r.errN).toBeLessThan(2e-3);
  });
});
