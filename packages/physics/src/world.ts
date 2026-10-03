// Rapier world on a @gamekit/core fixed step, with render interpolation.
import RAPIER from '@dimforge/rapier3d-compat';

const ready = new Map<object, Promise<unknown>>();

/** Initialise a Rapier build's wasm once; safe to call from anywhere. Pass
 *  another build (rapier2d, the -deterministic ones) to use it instead. */
export function initRapier<M extends { init: () => Promise<void> } = typeof RAPIER>(mod: M = RAPIER as unknown as M): Promise<M> {
  let p = ready.get(mod) as Promise<M> | undefined;
  if (!p) ready.set(mod, (p = mod.init().then(() => mod)));
  return p;
}

export interface WorldOptions {
  gravity?: { x: number; y: number; z: number };
  /** Must match the loop's step (1 / hz). */
  dt?: number;
  /** Solver iterations; more is stiffer stacks and joints (Rapier default 4). */
  solverIterations?: number;
}

export function createWorld(opts: WorldOptions = {}): RAPIER.World {
  const world = new RAPIER.World(opts.gravity ?? { x: 0, y: -9.81, z: 0 });
  world.timestep = opts.dt ?? 1 / 60;
  if (opts.solverIterations) world.numSolverIterations = opts.solverIterations;
  return world;
}

type Vec = { x: number; y: number; z?: number };
type Quat = { x: number; y: number; z: number; w: number };

/** What the stepper needs from a Rapier body, 2D or 3D. */
export interface BodyLike {
  readonly handle: number;
  translation(): Vec;
  rotation(): Quat | number;
  linvel(): Vec;
}

/** What the stepper needs from a Rapier world, 2D or 3D. */
export interface WorldLike {
  timestep: number;
  step(events?: never): void;
  forEachRigidBody(f: (b: BodyLike) => void): void;
}

export interface Pose {
  p: { x: number; y: number; z: number };
  /** Quaternion in 3D; in 2D, w holds the angle and x/y/z are 0. */
  q: Quat;
}

/** Steps the world once per fixed step and remembers the previous pose of
 *  each tracked body, so rendering can blend by the loop's alpha. Works with
 *  rapier3d and rapier2d (and their -deterministic builds). */
export class PhysicsStepper {
  private readonly prev = new Map<number, Pose>();
  private readonly tracked = new Set<BodyLike>();

  /** `events`: an EventQueue to collect contacts into (optional). */
  constructor(readonly world: WorldLike, readonly events?: unknown) {}

  track<B extends BodyLike>(body: B): B {
    this.tracked.add(body);
    this.prev.set(body.handle, poseOf(body));
    return body;
  }

  untrack(body: BodyLike): void {
    this.tracked.delete(body);
    this.prev.delete(body.handle);
  }

  /** Call from FixedStepLoop's step. `dt` must equal world.timestep. */
  step(dt: number): void {
    if (Math.abs(dt - this.world.timestep) > 1e-6) throw new Error(`PhysicsStepper: dt ${dt} != world.timestep ${this.world.timestep}`);
    for (const b of this.tracked) this.prev.set(b.handle, poseOf(b));
    (this.world.step as (e?: unknown) => void)(this.events);
  }

  /** Blended pose for rendering. */
  interpolated(body: BodyLike, alpha: number, out: Pose = emptyPose()): Pose {
    const a = this.prev.get(body.handle) ?? poseOf(body);
    const b = poseOf(body);
    out.p.x = a.p.x + (b.p.x - a.p.x) * alpha;
    out.p.y = a.p.y + (b.p.y - a.p.y) * alpha;
    out.p.z = a.p.z + (b.p.z - a.p.z) * alpha;
    if (typeof body.rotation() === 'number') {
      const d = Math.atan2(Math.sin(b.q.w - a.q.w), Math.cos(b.q.w - a.q.w));
      out.q.x = out.q.y = out.q.z = 0;
      out.q.w = a.q.w + d * alpha;
    } else nlerp(a.q, b.q, alpha, out.q);
    return out;
  }

  /** Plain snapshot of every body for @gamekit/core hashState. */
  snapshot(): number[] {
    const out: number[] = [];
    this.world.forEachRigidBody((b) => {
      const { p, q } = poseOf(b);
      const v = b.linvel();
      out.push(b.handle, p.x, p.y, p.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z ?? 0);
    });
    return out;
  }
}

export const emptyPose = (): Pose => ({ p: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 } });

function poseOf(b: BodyLike): Pose {
  const t = b.translation(), r = b.rotation();
  const q = typeof r === 'number' ? { x: 0, y: 0, z: 0, w: r } : { x: r.x, y: r.y, z: r.z, w: r.w };
  return { p: { x: t.x, y: t.y, z: t.z ?? 0 }, q };
}

/** Normalised lerp along the short arc; plenty for one step of rotation. */
function nlerp(a: Pose['q'], b: Pose['q'], t: number, out: Pose['q']): void {
  const s = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
  out.x = a.x + (b.x * s - a.x) * t;
  out.y = a.y + (b.y * s - a.y) * t;
  out.z = a.z + (b.z * s - a.z) * t;
  out.w = a.w + (b.w * s - a.w) * t;
  const n = Math.hypot(out.x, out.y, out.z, out.w) || 1;
  out.x /= n; out.y /= n; out.z /= n; out.w /= n;
}
