// Rapier world on a @gamekit/core fixed step, with render interpolation.
import RAPIER from '@dimforge/rapier3d-compat';

let ready: Promise<typeof RAPIER> | null = null;

/** Initialise Rapier's wasm once; safe to call from anywhere. */
export function initRapier(): Promise<typeof RAPIER> {
  return (ready ??= RAPIER.init().then(() => RAPIER));
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

export interface Pose {
  p: { x: number; y: number; z: number };
  q: { x: number; y: number; z: number; w: number };
}

/** Steps the world once per fixed step and remembers the previous pose of
 *  each tracked body, so rendering can blend by the loop's alpha. */
export class PhysicsStepper {
  private readonly prev = new Map<number, Pose>();
  private readonly tracked = new Set<RAPIER.RigidBody>();
  readonly events: RAPIER.EventQueue;

  constructor(readonly world: RAPIER.World) {
    this.events = new RAPIER.EventQueue(true);
  }

  track(body: RAPIER.RigidBody): RAPIER.RigidBody {
    this.tracked.add(body);
    this.prev.set(body.handle, poseOf(body));
    return body;
  }

  untrack(body: RAPIER.RigidBody): void {
    this.tracked.delete(body);
    this.prev.delete(body.handle);
  }

  /** Call from FixedStepLoop's step. `dt` must equal world.timestep. */
  step(dt: number): void {
    if (Math.abs(dt - this.world.timestep) > 1e-9) throw new Error(`PhysicsStepper: dt ${dt} != world.timestep ${this.world.timestep}`);
    for (const b of this.tracked) this.prev.set(b.handle, poseOf(b));
    this.world.step(this.events);
  }

  /** Blended pose for rendering. */
  interpolated(body: RAPIER.RigidBody, alpha: number, out: Pose = emptyPose()): Pose {
    const a = this.prev.get(body.handle) ?? poseOf(body);
    const t = body.translation();
    const r = body.rotation();
    out.p.x = a.p.x + (t.x - a.p.x) * alpha;
    out.p.y = a.p.y + (t.y - a.p.y) * alpha;
    out.p.z = a.p.z + (t.z - a.p.z) * alpha;
    nlerp(a.q, r, alpha, out.q);
    return out;
  }

  /** Plain snapshot of every body for @gamekit/core hashState. */
  snapshot(): number[] {
    const out: number[] = [];
    this.world.forEachRigidBody((b) => {
      const t = b.translation(), r = b.rotation(), v = b.linvel();
      out.push(b.handle, t.x, t.y, t.z, r.x, r.y, r.z, r.w, v.x, v.y, v.z);
    });
    return out;
  }
}

export const emptyPose = (): Pose => ({ p: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 } });

function poseOf(b: RAPIER.RigidBody): Pose {
  const t = b.translation(), r = b.rotation();
  return { p: { x: t.x, y: t.y, z: t.z }, q: { x: r.x, y: r.y, z: r.z, w: r.w } };
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
