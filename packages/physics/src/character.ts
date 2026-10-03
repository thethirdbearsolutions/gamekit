// Kinematic character: a capsule moved by Rapier's KinematicCharacterController,
// with gravity, ground snapping, slopes, steps and a jump that only fires grounded.
import RAPIER from '@dimforge/rapier3d-compat';

export interface CharacterOptions {
  position?: { x: number; y: number; z: number };
  radius?: number;
  /** Half the height of the cylindrical part. */
  halfHeight?: number;
  /** Skin gap Rapier keeps from obstacles (m). */
  offset?: number;
  maxSlopeClimb?: number;
  minSlopeSlide?: number;
  /** Auto-step: max step height and min width (m); 0 disables. */
  stepHeight?: number;
  stepWidth?: number;
  snapToGround?: number;
  gravity?: number;
  /** Push dynamic bodies it walks into. */
  pushBodies?: boolean;
}

export class Character {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.KinematicCharacterController;
  vy = 0;
  grounded = false;
  private readonly gravity: number;

  constructor(readonly world: RAPIER.World, opts: CharacterOptions = {}) {
    const p = opts.position ?? { x: 0, y: 1, z: 0 };
    const radius = opts.radius ?? 0.3;
    const half = opts.halfHeight ?? 0.5;
    this.gravity = opts.gravity ?? 9.81 * 2; // games feel floaty at real g
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z));
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(half, radius), this.body);
    const c = world.createCharacterController(opts.offset ?? 0.02);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.setMaxSlopeClimbAngle(opts.maxSlopeClimb ?? (50 * Math.PI) / 180);
    c.setMinSlopeSlideAngle(opts.minSlopeSlide ?? (35 * Math.PI) / 180);
    if ((opts.stepHeight ?? 0.3) > 0) c.enableAutostep(opts.stepHeight ?? 0.3, opts.stepWidth ?? 0.2, false);
    if ((opts.snapToGround ?? 0.3) > 0) c.enableSnapToGround(opts.snapToGround ?? 0.3);
    c.setApplyImpulsesToDynamicBodies(opts.pushBodies ?? true);
    this.controller = c;
  }

  /** Move for one fixed step. `vx`/`vz` are desired horizontal velocity (m/s). */
  move(dt: number, vx: number, vz: number, jumpSpeed = 0): void {
    if (this.grounded && jumpSpeed > 0) this.vy = jumpSpeed;
    this.vy -= this.gravity * dt;
    const desired = { x: vx * dt, y: this.vy * dt, z: vz * dt };
    this.controller.computeColliderMovement(this.collider, desired);
    const m = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    // Hit a ceiling or landed: stop vertical speed.
    if ((this.grounded && this.vy < 0) || (this.vy > 0 && m.y < desired.y * 0.5)) this.vy = 0;
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
  }

  get position(): { x: number; y: number; z: number } {
    return this.body.translation();
  }

  dispose(): void {
    this.world.removeCharacterController(this.controller);
    this.world.removeRigidBody(this.body);
  }
}
