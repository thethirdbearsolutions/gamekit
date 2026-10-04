import { describe, expect, it } from 'vitest';
import { acesDisplay, displayToScene } from '../src/hdr/display.js';

const hue = (c: number[]) => {
  const [r, g, b] = c, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 1e-6) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
};
const sat = (c: number[]) => { const mx = Math.max(...c); return mx ? (mx - Math.min(...c)) / mx : 0; };

describe('display → scene bridge', () => {
  it('round-trips in-gamut display colours through three\'s ACES + sRGB', () => {
    for (const c of [[0.5, 0.25, 0.1], [0.9, 0.95, 0.97], [0.02, 0.3, 0.6], [0.8, 0.1, 0.9], [0, 0, 0]]) {
      const back = acesDisplay(displayToScene(c, 1.05), 1.05);
      back.forEach((v, i) => expect(v).toBeCloseTo(c[i], 2));
    }
  });

  it('keeps hue and saturation for primaries ACES cannot reach (the rainbow bands)', () => {
    // hueRainbow's bands: pure and two-channel primaries at full brightness.
    for (const c of [[0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1], [1, 0, 1], [1, 0, 0], [0.2, 0.9, 0.3]]) {
      const back = acesDisplay(displayToScene(c, 1.05), 1.05);
      const dh = Math.abs(hue(back) - hue(c));
      expect(Math.min(dh, 360 - dh), `hue of ${c}`).toBeLessThan(8);
      expect(sat(back), `saturation of ${c}`).toBeGreaterThan(Math.min(0.7, sat(c) - 0.1)); // clamping instead gave ~0.35 (pastel)
      expect(Math.max(...back), `brightness of ${c}`).toBeGreaterThan(0.65);
    }
  });

  it('maps near-white display values to genuine HDR', () => {
    expect(Math.max(...displayToScene([0.98, 0.98, 0.98]))).toBeGreaterThan(3);
  });
});
