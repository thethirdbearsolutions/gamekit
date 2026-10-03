import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runPage, startRig, type Rig } from './browser.js';

const close = (a: number[], b: number[], tol = 2) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const sum = (a: number[]) => a[0] + a[1] + a[2];

describe('HdrPipeline in WebGL', () => {
  let rig: Rig;
  let r: any;
  beforeAll(async () => { rig = await startRig(); r = await runPage(rig, 'hdr.html'); }, 120_000);
  afterAll(() => rig?.close());

  it('renders without errors', () => {
    expect(r.consoleErrors).toEqual([]);
  });

  it('matches three\'s own AgX output, for built-in and custom shaders alike', () => {
    expect(close(r.off.basic, r.refBasic)).toBe(true);
    expect(close(r.off.custom, r.refBasic)).toBe(true);
  });

  it('selective bloom glows only around the selected object and leaves the rest alone', () => {
    expect(sum(r.off.nearSel)).toBe(0);
    expect(sum(r.sel.nearSel)).toBeGreaterThan(20);
    // Only the wide tail of the selected glow (128 px away) reaches the unselected one.
    expect(sum(r.sel.nearUnsel)).toBeLessThan(sum(r.sel.nearSel) / 5);
    expect(sum(r.sel.nearUnsel)).toBeLessThan(sum(r.thr.nearUnsel) / 5);
    expect(close(r.sel.custom, r.off.custom, 4)).toBe(true);
  });

  it('threshold bloom catches every HDR highlight; both mode does both', () => {
    expect(sum(r.thr.nearSel)).toBeGreaterThan(20);
    expect(sum(r.thr.nearUnsel)).toBeGreaterThan(20);
    expect(sum(r.both.nearSel)).toBeGreaterThan(sum(r.thr.nearSel));
  });

  it('audit flags in-shader tone mapping and gamma, and nothing in a clean scene', () => {
    expect(r.audit).toEqual(expect.arrayContaining(['manual-gamma', 'manual-tonemap']));
    expect(r.auditClean).toBe(0);
  });
});

describe('display-referred shaders through the pipeline (FALLS-49)', () => {
  let rig: Rig;
  let r: any;
  beforeAll(async () => { rig = await startRig(); r = await runPage(rig, 'display.html'); }, 120_000);
  afterAll(() => rig?.close());

  it('gkDisplayToScene keeps a raw shader\'s on-screen look exactly', () => {
    expect(r.consoleErrors).toEqual([]);
    r.before.forEach((b: number[], i: number) => expect(close(r.after[i], b, 3)).toBe(true));
  });

  it('without it the look shifts, which is the FALLS-14 wash', () => {
    const shift = r.before.map((b: number[], i: number) => Math.max(...b.map((v, k) => Math.abs(v - r.naive[i][k]))));
    expect(Math.max(...shift)).toBeGreaterThan(30);
  });
});
