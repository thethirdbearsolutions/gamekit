import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runPage, startRig, type Rig } from './browser.js';

const lum = (c: number[]) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;

describe('water and sky in WebGL', () => {
  let rig: Rig;
  let r: any;
  beforeAll(async () => { rig = await startRig(); r = await runPage(rig, 'water.html'); }, 120_000);
  afterAll(() => rig?.close());

  it('compiles in both colour modes with elevation, fog and the sky', () => {
    expect(r.consoleErrors).toEqual([]);
  });

  it('tints by depth: shallows lighter than the deep, lightest at the shore', () => {
    for (const mode of ['linear', 'display']) {
      expect(lum(r[mode].shallow)).toBeGreaterThan(lum(r[mode].deep) + 20);
    }
    expect(lum(r.linear.land)).toBeGreaterThan(lum(r.linear.shallow)); // shore foam
  });

  it('draws the sky', () => {
    expect(r.sky[2]).toBeGreaterThan(r.sky[0]); // blue above
  });
});
