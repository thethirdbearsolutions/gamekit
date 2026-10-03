// Closed-loop playtest bot: real key presses, real time, video recorded.
// Not committed to the lab; lives in the playtester's scratch copy.
import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';

const OUT = process.env.OUT;
const SEED = process.env.SEED ?? '20261003';
const VARIANTS = (process.env.VARIANTS ?? 'ledge,bark,grip').split(',');
const LIMIT_S = 75;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader'] });

const results = {};
for (const variant of VARIANTS) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:5178/?variant=${variant}&seed=${SEED}`);
  await page.waitForFunction(() => window.canopy?.sim);
  await page.click('body').catch(() => {});
  await sleep(1200); // let the viewer see the tree first

  const held = new Set();
  const want = async (keys) => {
    for (const k of [...held]) if (!keys.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of keys) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  const tap = async (k) => { await page.keyboard.down(k); await sleep(40); await page.keyboard.up(k); };

  const t0 = Date.now();
  let lastPull = 0, resting = false, log = [], lastMode = '', jumps = 0;
  while (Date.now() - t0 < LIMIT_S * 1000) {
    const s = await page.evaluate(() => {
      const sim = canopy.sim, c = sim.cat, w = sim.world;
      const goal = w.tops.find(t => t.goal);
      const trunk = w.trunks.find(t => t.id === goal.trunkId);
      const ledge = w.tops.filter(t => t.trunkId === trunk.id && t.kind === 'branch' && !t.snapped && t.side === -1)
        .map(t => ({ y: t.y, x0: t.x0 }));
      return { x: c.body.x, y: c.body.y, w: c.body.w, mode: c.mode, grip: c.grip, trunk: c.trunk?.id ?? null,
               supportKind: c.support?.kind ?? null, goal: sim.reachedGoal, tx0: trunk.x0, tid: trunk.id, ledge, time: sim.time };
    });
    if (s.mode !== lastMode) { log.push({ t: +((Date.now() - t0) / 1000).toFixed(2), mode: s.mode, y: Math.round(s.y), grip: +s.grip.toFixed(2) }); lastMode = s.mode; }
    if (s.goal) { await want(new Set()); break; }

    const atTrunk = s.x + s.w / 2 >= s.tx0 - 1.5;
    const onGoalTrunk = s.trunk === s.tid;
    const keys = new Set();

    if (!onGoalTrunk && !['cling', 'hang', 'mantle'].includes(s.mode)) {
      // Walk to just left of the mango trunk, then jump at it while pushing into the bark.
      const gapToTrunk = s.tx0 - (s.x + s.w / 2);
      if (variant === 'grip' && s.mode === 'stand' && s.supportKind !== 'floor' && s.grip < 0.97) { await want(new Set()); await sleep(60); continue; }
      if (gapToTrunk > 10) keys.add('ArrowRight');
      else if (gapToTrunk < -2 && s.mode === 'stand' && s.supportKind === 'floor') keys.add('ArrowLeft'); // walked under the arch: back out
      else {
        keys.add('ArrowRight'); keys.add('ArrowUp');
        if (variant === 'ledge') keys.add('KeyX');
        if (s.mode === 'stand') { await want(keys); await tap('Space'); jumps++; await sleep(60); continue; }
      }
      await want(keys);
    } else if (variant === 'bark') {
      await want(new Set(['ArrowUp']));
    } else if (variant === 'ledge') {
      await want(new Set(['ArrowUp', 'KeyX']));
    } else { // grip: steady beat, rest on a left branch when grip runs low
      await want(new Set());
      if (s.mode === 'cling' && s.grip < 0.35) {
        const b = s.ledge.find(l => l.y >= s.y - 2 && l.y <= s.y + 6);
        if (b) { await tap('ArrowLeft'); resting = true; await sleep(50); continue; }
      }
      if (s.mode === 'stand' && resting) {
        if (s.grip < 0.97) { await sleep(100); continue; }
        resting = false; await want(new Set(['ArrowRight'])); await sleep(120); await want(new Set()); continue;
      }
      const now = Date.now();
      if (now - lastPull >= 400) { await tap('ArrowUp'); lastPull = now; }
    }
    await sleep(45);
  }
  await want(new Set());
  await sleep(2500); // hold on the view from the nest
  const summary = await page.evaluate(() => {
    const sim = canopy.sim, counts = {};
    for (const e of sim.events) counts[e.type] = (counts[e.type] || 0) + 1;
    return { reachedGoal: sim.reachedGoal, simTime: +sim.time.toFixed(2), events: counts, mangoes: sim.mangoes?.filter?.(m => m.taken).length ?? null };
  });
  results[variant] = { ...summary, approachJumps: jumps, wallSeconds: +((Date.now() - t0) / 1000).toFixed(1), modeLog: log };
  const vid = page.video();
  await ctx.close();
  await vid.saveAs(`${OUT}/${variant}.webm`);
  await vid.delete();
  console.log(variant, JSON.stringify(results[variant]).slice(0, 400));
}
await writeFile(`${OUT}/results.json`, JSON.stringify(results, null, 2));
await browser.close();
