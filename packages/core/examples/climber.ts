// A tiny deterministic platform toy built only on @gamekit/core. Climb the
// seeded ledges to the top. Exposes window.__game for @gamekit/playtest.
import { InputMap, RngStreams, hashState, type InputFrame } from '@gamekit/core';

export type Action = 'left' | 'right' | 'jump';
export const bindings = { left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], jump: ['Space', 'ArrowUp', 'KeyW'] };

export interface Ledge { x: number; y: number; w: number }
export interface GameEvent { tick: number; type: string; [k: string]: unknown }

export function createClimber(seed: number | string) {
  const rng = new RngStreams(seed);
  const input = new InputMap<Action>(bindings);
  const ledges: Ledge[] = [{ x: 0, y: 0, w: 640 }];
  const gen = rng.stream('ledges');
  for (let i = 1; i <= 12; i++) {
    const prev = ledges[i - 1];
    const w = gen.range(70, 140);
    const cx = Math.min(600 - w / 2, Math.max(40 + w / 2, (i === 1 ? 320 : prev.x + prev.w / 2) + gen.range(-170, 170)));
    ledges.push({ x: cx - w / 2, y: i * 70, w });
  }
  const s = { tick: 0, x: 320, y: 0, vx: 0, vy: 0, onGround: true, best: 0, won: false, events: [] as GameEvent[] };
  const goal = ledges[ledges.length - 1];

  function step(dt: number, tick: number) {
    s.tick = tick;
    const f: InputFrame<Action> = input.sample(tick);
    if (s.won) return;
    const dir = (f.held('right') ? 1 : 0) - (f.held('left') ? 1 : 0);
    s.vx += (dir * 260 - s.vx) * Math.min(1, dt * (s.onGround ? 14 : 4));
    if (f.pressed('jump') && s.onGround) { s.vy = 440; s.onGround = false; s.events.push({ tick, type: 'jump', y: s.y }); }
    s.vy -= 1100 * dt;
    const prevY = s.y;
    s.x = Math.min(632, Math.max(8, s.x + s.vx * dt));
    s.y += s.vy * dt;
    s.onGround = false;
    if (s.vy <= 0) {
      for (const l of ledges) {
        if (prevY >= l.y && s.y <= l.y && s.x >= l.x && s.x <= l.x + l.w) {
          s.y = l.y; s.vy = 0; s.onGround = true;
          if (l.y > s.best) { s.best = l.y; s.events.push({ tick, type: 'ledge', y: l.y }); }
          if (l === goal) { s.won = true; s.events.push({ tick, type: 'goal' }); }
          break;
        }
      }
    }
  }

  return {
    input, ledges, s, step,
    /** Observable state for bots and tests (plain data only). */
    state: () => ({ tick: s.tick, x: s.x, y: s.y, vx: s.vx, vy: s.vy, onGround: s.onGround, best: s.best, won: s.won,
      ledges, goal: { x: goal.x, y: goal.y, w: goal.w } }),
    hash: () => hashState({ s, rng: rng.getState() }),
  };
}
