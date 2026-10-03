import { existsSync, statSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { capture, findChromium, runBot, serveStatic, type Policy } from '@gamekit/playtest';

let site: Awaited<ReturnType<typeof serveStatic>>;
let out: string;
beforeAll(async () => {
  site = await serveStatic(join(import.meta.dirname, 'fixture'));
  out = await mkdtemp(join(tmpdir(), 'gamekit-playtest-'));
});
afterAll(() => site.close());

describe('playtest', () => {
  it('finds the preinstalled chromium', () => {
    expect(existsSync(findChromium())).toBe(true);
  });

  it('runs a closed-loop bot in real time and records mp4 + json', async () => {
    type S = { x: number; hops: number };
    const policy: Policy<S> = (s, ctx) => {
      if (s.x >= 120) return { done: true, note: 'reached x=120' };
      const tap = s.hops < 2 && ctx.t > (s.hops + 1) * 0.3 ? ['hop'] : [];
      return { hold: ['right'], tap };
    };
    const r = await runBot({ name: 'walker', url: site.url, policy, outDir: out, limitS: 8, leadInMs: 200, leadOutMs: 200,
      viewport: { width: 320, height: 180 }, metrics: (s) => ({ x: s.x }), watch: ['hops'] });
    expect(r.done).toBe(true);
    expect(r.gameEvents.length).toBeGreaterThanOrEqual(1);
    expect(r.log.samples.length).toBeGreaterThan(5);
    expect(r.video && statSync(r.video).size).toBeGreaterThan(1000);
    const json = JSON.parse(await readFile(join(out, 'walker.json'), 'utf8'));
    expect(json.log.counters.done).toBe(1);
  });

  it('frame-stepped capture is deterministic and makes sheet, strip and mp4', async () => {
    const script = [
      { tick: 0, action: 'right', type: 'down' as const },
      { tick: 10, action: 'hop', type: 'tap' as const },
      { tick: 40, action: 'right', type: 'up' as const },
    ];
    const run = (name: string) => capture({ name, url: site.url, outDir: out, ticks: 60, every: 5, script,
      viewport: { width: 320, height: 180 }, sheet: { frames: 8, cols: 4, width: 160 }, strip: { frames: 5, width: 120 } });
    const a = await run('cap-a');
    const b = await run('cap-b');
    expect(a.frames).toBe(13);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.finalState).toMatchObject({ tick: 60, x: 90, hops: 1 });
    for (const f of [a.video!, a.sheet!, a.strip!]) expect(statSync(f).size).toBeGreaterThan(500);
  });

  it('frame-stepped capture can run a closed-loop policy with captions, deterministically', async () => {
    type S = { x: number; tick: number };
    const policy: Policy<S> = (st) => ({ hold: st.x < 60 ? ['right'] : [], tap: st.tick === 30 ? ['hop'] : [] });
    const run = (name: string) => capture({ name, url: site.url, outDir: out, ticks: 90, every: 10, policy, policyEvery: 5,
      beats: [{ tick: 0, caption: 'walk right' }, { tick: 45, caption: 'stop at x=60' }],
      viewport: { width: 320, height: 180 }, sheet: false, fps: 0, format: 'jpeg' });
    const a = await run('pilot-a');
    const b = await run('pilot-b');
    expect(a.hashes).toEqual(b.hashes);
    // Reads every 5 ticks, so it overshoots 60 by at most one interval of 2 px/tick.
    expect((a.finalState as S).x).toBeGreaterThanOrEqual(60);
    expect((a.finalState as S).x).toBeLessThanOrEqual(70);
    expect(a.finalState).toMatchObject({ hops: 1 });
    expect(a.log.map((l) => l.caption)).toEqual(['walk right', 'stop at x=60']);
  });
});
