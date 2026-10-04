import { FixedStepLoop, lerp } from '@gamekit/core';
import { bindings, createClimber } from './climber';

const params = new URLSearchParams(location.search);
const game = createClimber(params.get('seed') ?? 'gamekit');
const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const hud = document.getElementById('hud')!;
game.input.attach(window);

let prev = { x: game.s.x, y: game.s.y };
const loop = new FixedStepLoop({
  hz: 60,
  step: (dt, tick) => { prev = { x: game.s.x, y: game.s.y }; game.step(dt, tick); },
  render: (alpha) => {
    const x = lerp(prev.x, game.s.x, alpha);
    const y = lerp(prev.y, game.s.y, alpha);
    const cam = Math.max(0, y - 200);
    ctx.clearRect(0, 0, 640, 480);
    ctx.fillStyle = '#3a6';
    for (const l of game.ledges) ctx.fillRect(l.x, 470 - (l.y - cam), l.w, 6);
    ctx.fillStyle = game.s.won ? '#fd4' : '#e86';
    ctx.fillRect(x - 8, 470 - (y - cam) - 16, 16, 16);
    hud.textContent = `tick ${loop.tick}  best ${game.s.best}  ${game.s.won ? 'GOAL!' : ''}\nhash ${game.hash()}\n` +
      `keys: ${Object.entries(bindings).map(([a, k]) => `${a}=${k.join('/')}`).join('  ')}`;
  },
});

// The playtest contract: state() is plain data, actions maps action -> keys,
// step(n) lets a frame-stepped capture drive the sim deterministically.
declare global { interface Window { __game: unknown } }
window.__game = {
  state: game.state,
  actions: bindings,
  events: () => game.s.events,
  hash: game.hash,
  pause: () => loop.stop(),
  resume: () => loop.start(),
  step: (n = 1) => { loop.runSteps(n); loop.redraw(); },
};
if (params.get('paused') !== '1') loop.start();
