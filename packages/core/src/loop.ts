// Fixed-step accumulator loop (Gaffer's "Fix Your Timestep"). The simulation
// advances in whole steps of `dt`; rendering gets `alpha`, how far real time
// has run into the next step, for interpolating between the last two states.
// Determinism depends only on the step count, never on the render rate.

export interface FixedStepOptions {
  /** Simulation rate in Hz (default 60). */
  hz?: number;
  /** Most steps run for one frame; the rest of the backlog is dropped so a
   *  stalled tab doesn't spiral (default 8). */
  maxStepsPerFrame?: number;
  /** Advance one simulation step. `tick` counts from 0. */
  step: (dt: number, tick: number) => void;
  /** Draw, blending previous and current state by `alpha` in [0, 1). */
  render?: (alpha: number, frameDt: number) => void;
}

export class FixedStepLoop {
  readonly dt: number;
  readonly maxStepsPerFrame: number;
  tick = 0;
  /** Seconds of real time dropped because frames were too long. */
  dropped = 0;
  private acc = 0;
  private readonly stepFn: FixedStepOptions['step'];
  private readonly renderFn?: FixedStepOptions['render'];
  private raf = 0;
  private last = -1;

  constructor(opts: FixedStepOptions) {
    this.dt = 1 / (opts.hz ?? 60);
    this.maxStepsPerFrame = opts.maxStepsPerFrame ?? 8;
    this.stepFn = opts.step;
    this.renderFn = opts.render;
  }

  /** Interpolation factor for the current frame. */
  get alpha(): number {
    return Math.min(1, this.acc / this.dt);
  }

  /** Feed `frameDt` seconds of real time; runs whole steps, then renders.
   *  Returns the number of steps run. */
  advance(frameDt: number): number {
    this.acc += Math.max(0, frameDt);
    let n = 0;
    // The epsilon keeps 1/60 s accumulated from float frame times from
    // landing a step late (from the canopy lab's loop).
    while (this.acc >= this.dt - 1e-9) {
      if (n === this.maxStepsPerFrame) {
        const keep = this.acc % this.dt;
        this.dropped += this.acc - keep;
        this.acc = keep;
        break;
      }
      this.stepFn(this.dt, this.tick++);
      this.acc = Math.max(0, this.acc - this.dt);
      n++;
    }
    this.renderFn?.(this.alpha, frameDt);
    return n;
  }

  /** Run exactly `n` steps with no rendering (tests, headless sims, capture). */
  runSteps(n: number): void {
    for (let i = 0; i < n; i++) this.stepFn(this.dt, this.tick++);
  }

  /** Drive from requestAnimationFrame. */
  start(now: () => number = () => performance.now()): void {
    if (this.raf) return;
    const frame = () => {
      const t = now();
      if (this.last >= 0) this.advance((t - this.last) / 1000);
      this.last = t;
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = -1;
  }
}

/** Linear blend for interpolated rendering: `lerp(prev, curr, loop.alpha)`. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
