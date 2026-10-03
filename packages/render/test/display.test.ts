import { describe, expect, it } from 'vitest';
import { acesDisplay, displayToScene } from '../src/hdr/display.js';

describe('display → scene bridge', () => {
  it('round-trips display colours through three\'s ACES + sRGB', () => {
    for (const c of [[0.5, 0.25, 0.1], [0.9, 0.95, 0.97], [0.02, 0.3, 0.6], [0.8, 0.1, 0.9], [0, 0, 0]]) {
      const back = acesDisplay(displayToScene(c, 1.05), 1.05);
      back.forEach((v, i) => expect(v).toBeCloseTo(c[i], 2));
    }
  });

  it('maps near-white display values to genuine HDR', () => {
    expect(Math.max(...displayToScene([0.98, 0.98, 0.98]))).toBeGreaterThan(3);
  });
});
