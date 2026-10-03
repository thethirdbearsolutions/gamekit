// The curved world's path, in plain numbers. Generalised from chaotic-attack's
// bend (ATK-34/54): gameplay runs straight down -z from the origin; drawing
// puts a point `s` metres ahead and `x` to the side onto a path sampled every
// `step` metres (x, z, heading), turning at a steady rate between samples
// (an arc), so it can turn as far as it likes — all the way round a
// roundabout. An optional planet-style drop curves the horizon down.
//
// The GLSL in glsl.ts does the same sums; tests hold the two together.

export interface PathConfig {
  /** Number of samples (default 65). */
  samples?: number;
  /** Metres between samples (default 3). */
  step?: number;
}

export interface Pose { x: number; z: number; h: number }

export class BendPath {
  readonly samples: number;
  readonly step: number;
  readonly range: number;
  /** x, z, heading per sample; shared with shaders as a uniform. */
  readonly data: Float32Array;
  /** Planet curvature: y drops by k·d² with distance d from the origin. */
  drop = 0;
  /** Nothing further along the track than this is drawn. */
  cut = 1e6;

  constructor(cfg: PathConfig = {}) {
    this.samples = cfg.samples ?? 65;
    this.step = cfg.step ?? 3;
    this.range = this.step * (this.samples - 1);
    this.data = new Float32Array(this.samples * 3);
    this.straighten();
  }

  straighten(): void {
    for (let i = 0; i < this.samples; i++) this.data.set([0, -i * this.step, 0], i * 3);
  }

  /** Set samples from [x, z, h, x, z, h, ...]. */
  set(xzh: ArrayLike<number>): void {
    for (let i = 0; i < this.samples * 3; i++) this.data[i] = xzh[i] ?? 0;
  }

  /** Build the path from a heading-rate (curvature, rad/m) per sample, e.g.
   *  from a track description: integrate exactly as the arcs are drawn. */
  fromCurvature(k: (s: number) => number): void {
    let x = 0, z = 0, h = 0;
    this.data.set([0, 0, 0], 0);
    for (let i = 1; i < this.samples; i++) {
      const h1 = h + k((i - 0.5) * this.step) * this.step;
      const p = arc(x, z, h, (h1 - h) / this.step, this.step);
      x = p.x; z = p.z; h = h1;
      this.data.set([x, z, h], i * 3);
    }
  }

  /** The path `s` metres ahead, as drawn. */
  pathAt(s: number): Pose {
    const v = this.data;
    if (s <= 0) return { x: 0, z: -s, h: 0 };
    if (s >= this.range) {
      const o = (this.samples - 1) * 3;
      const e = s - this.range;
      return { x: v[o] + Math.sin(v[o + 2]) * e, z: v[o + 1] - Math.cos(v[o + 2]) * e, h: v[o + 2] };
    }
    const d = s / this.step;
    const i = Math.floor(d);
    const u = (d - i) * this.step;
    const k = (v[i * 3 + 5] - v[i * 3 + 2]) / this.step;
    return arc(v[i * 3], v[i * 3 + 1], v[i * 3 + 2], k, u);
  }

  /** Where a track-space point (x across, y up, z along -track) is drawn. */
  bend(x: number, y: number, z: number): { x: number; y: number; z: number; h: number } {
    const p = this.pathAt(-z);
    const wx = p.x + x * Math.cos(p.h);
    const wz = p.z + x * Math.sin(p.h);
    return { x: wx, y: y - this.drop * (wx * wx + wz * wz), z: wz, h: p.h };
  }
}

/** Advance `u` metres from (x, z) heading h, turning at k rad/m. */
function arc(x: number, z: number, h: number, k: number, u: number): Pose {
  const h1 = h + k * u;
  if (Math.abs(k) < 1e-3) {
    // Second-order series near straight; matches the shader's branch.
    return { x: x + Math.sin(h) * u + Math.cos(h) * k * u * u * 0.5, z: z - Math.cos(h) * u + Math.sin(h) * k * u * u * 0.5, h: h1 };
  }
  return { x: x + (Math.cos(h) - Math.cos(h1)) / k, z: z - (Math.sin(h1) - Math.sin(h)) / k, h: h1 };
}
