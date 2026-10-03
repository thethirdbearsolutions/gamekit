// Body defaults: continuous collision detection for anything fast or thin,
// so a thrown ball or a dropped boat doesn't tunnel through a plank.
import RAPIER from '@dimforge/rapier3d-compat';

export interface CcdOptions {
  /** Fastest the body is expected to move (m/s). */
  maxSpeed: number;
  /** Smallest collider dimension involved (m): the body or what it hits. */
  thinnest: number;
  /** Simulation step (s). */
  dt?: number;
}

/** Whether a body moving `maxSpeed` could skip past something `thinnest`
 *  thick in one step. Half-thickness per step is the safe margin. */
export function needsCcd({ maxSpeed, thinnest, dt = 1 / 60 }: CcdOptions): boolean {
  return maxSpeed * dt > thinnest * 0.5;
}

/** Apply the CCD defaults both labs settled on: full CCD when the body could
 *  tunnel, otherwise soft CCD prediction (cheap, catches most glancing hits). */
export function withCcd(desc: RAPIER.RigidBodyDesc, opts: CcdOptions): RAPIER.RigidBodyDesc {
  const dt = opts.dt ?? 1 / 60;
  if (needsCcd(opts)) desc.setCcdEnabled(true);
  else desc.setSoftCcdPrediction(opts.maxSpeed * dt * 2);
  return desc;
}

/** Dynamic body with CCD defaults and sane damping. */
export function dynamicBody(world: RAPIER.World, at: { x: number; y: number; z: number }, ccd: CcdOptions,
  damping = { linear: 0.05, angular: 0.2 }): RAPIER.RigidBody {
  const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y, at.z)
    .setLinearDamping(damping.linear).setAngularDamping(damping.angular);
  return world.createRigidBody(withCcd(desc, ccd));
}

export interface BuoyancyOptions {
  /** Points in body space that sample the hull (e.g. corners of the waterline). */
  points: { x: number; y: number; z: number }[];
  /** Water surface height at world (x, z) — share it with the water shader. */
  heightAt: (x: number, z: number) => number;
  /** Submerged volume (m³) the whole body displaces when fully under. */
  volume: number;
  /** Depth over which a point goes from dry to fully submerged (m). */
  depth?: number;
  density?: number;
  gravity?: number;
  /** Water drag per point (N·s/m), damps bobbing and drift. Default scales
   *  with buoyancy so bobbing settles in a few seconds at any size. */
  drag?: number;
}

/** Per-point buoyancy (Archimedes, split across sample points) plus drag.
 *  Call once per fixed step before world.step(). Rapier keeps added forces
 *  AND torques until reset, so call body.resetForces(true) and
 *  body.resetTorques(true) first each step. Returns submerged fraction. */
export function applyBuoyancy(body: RAPIER.RigidBody, o: BuoyancyOptions): number {
  const depth = o.depth ?? 0.5;
  const perPoint = ((o.density ?? 1000) * (o.gravity ?? 9.81) * o.volume) / o.points.length;
  const drag = o.drag ?? perPoint * 0.3;
  const t = body.translation();
  const q = body.rotation();
  const lv = body.linvel();
  const av = body.angvel();
  let wet = 0;
  for (const p of o.points) {
    const w = rotate(q, p);
    const wx = t.x + w.x, wy = t.y + w.y, wz = t.z + w.z;
    const sub = Math.min(1, Math.max(0, (o.heightAt(wx, wz) - wy) / depth));
    if (sub <= 0) continue;
    wet += sub;
    // Velocity of this point = v + ω × r.
    const vx = lv.x + av.y * w.z - av.z * w.y;
    const vy = lv.y + av.z * w.x - av.x * w.z;
    const vz = lv.z + av.x * w.y - av.y * w.x;
    const f = { x: -vx * drag * sub, y: perPoint * sub - vy * drag * sub, z: -vz * drag * sub };
    body.addForceAtPoint(f, { x: wx, y: wy, z: wz }, true);
  }
  return wet / o.points.length;
}

function rotate(q: { x: number; y: number; z: number; w: number }, v: { x: number; y: number; z: number }) {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}
