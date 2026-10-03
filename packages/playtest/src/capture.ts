// Frame-stepped deterministic capture. The page starts paused; we drive the
// sim with window.__game.step(n) and screenshot between steps, so output is
// identical however slow the machine is (SwiftShader included) and the video
// plays at true speed.
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { launchBrowser } from './browser.js';
import type { Decision, Policy, PolicyContext } from './contract.js';
import { writeJson } from './report.js';
import { contactSheet, framesToMp4, strip } from './video.js';

export interface ScriptStep {
  tick: number;
  action: string;
  type: 'down' | 'up' | 'tap';
}

export interface CaptureRun {
  name: string;
  /** Page URL; `paused=1` is added so the game waits for step(). */
  url: string;
  outDir: string;
  /** Total sim steps to run. */
  ticks: number;
  /** Screenshot every n steps (default 1 → one frame per step). */
  every?: number;
  /** Input, by sim tick, sent as real key events before that tick's step. */
  script?: ScriptStep[];
  viewport?: { width: number; height: number };
  deviceScaleFactor?: number;
  /** Encode the frames to mp4 at this fps (default sim hz / every; 0 to skip). */
  fps?: number;
  hz?: number;
  /** Contact sheet of N evenly spaced frames, `cols` across (default 12 / 4). */
  sheet?: { frames: number; cols: number; width?: number } | false;
  /** Filmstrip of N evenly spaced frames. */
  strip?: { frames: number; width?: number } | false;
  keepFrames?: boolean;
  /** Closed-loop pilot in frame-stepped mode: called every `policyEvery`
   *  ticks (default `every`) with the game state; holds and taps go in as
   *  real key events before the next step. Deterministic, since it only sees
   *  sim state. (The sailing lab's recorder steers this way.) */
  policy?: Policy;
  policyEvery?: number;
  /** Captions and one-off actions by tick; each logs the state it saw. */
  beats?: { tick: number; caption?: string; run?: (page: Page) => Promise<void> }[];
  /** Frame format (jpeg is several times faster to write). Default png. */
  format?: 'png' | 'jpeg';
  /** Extra CSS for the page (hide HUD, title screens). */
  css?: string;
  /** Runs once the game is ready and paused, before tick 0 (teleport, enable input). */
  setup?: (page: Page) => Promise<void>;
  browser?: Browser;
}

export interface CaptureResult {
  name: string;
  frames: number;
  hashes: { tick: number; hash: string | null }[];
  finalState: unknown;
  /** Beat log: tick, caption and the state at that moment. */
  log: { tick: number; caption?: string; state: unknown }[];
  video?: string;
  sheet?: string;
  strip?: string;
}

export async function capture(run: CaptureRun): Promise<CaptureResult> {
  const every = run.every ?? 1;
  const hz = run.hz ?? 60;
  const viewport = run.viewport ?? { width: 1280, height: 720 };
  const framesDir = join(run.outDir, `${run.name}-frames`);
  await mkdir(framesDir, { recursive: true });
  const browser = run.browser ?? (await launchBrowser());
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: run.deviceScaleFactor ?? 1 });
  const page = await ctx.newPage();
  const files: string[] = [];
  const hashes: CaptureResult['hashes'] = [];
  const log: CaptureResult['log'] = [];
  let finalState: unknown;
  try {
    const url = new URL(run.url);
    url.searchParams.set('paused', '1');
    await page.goto(url.href);
    await page.waitForFunction(() => typeof window.__game?.step === 'function', null, { timeout: 30_000 });
    await page.evaluate(() => window.__game!.pause?.());
    if (run.css) await page.addStyleTag({ content: run.css });
    if (run.setup) await run.setup(page);
    const actions = await page.evaluate(() => window.__game!.actions as Record<string, string[]>);
    const key = (a: string) => actions[a]?.[0] ?? (() => { throw new Error(`no key for ${a}`); })();
    const script = [...(run.script ?? [])].sort((a, b) => a.tick - b.tick);
    let si = 0;
    const beats = [...(run.beats ?? [])].sort((a, b) => a.tick - b.tick);
    let bi = 0;
    const held = new Set<string>();
    const ctx: PolicyContext = { t: 0, memory: {}, params: {} };
    const policyEvery = run.policyEvery ?? every;
    if (beats.length) await page.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'gamekit-caption';
      d.style.cssText = 'position:fixed;left:16px;bottom:24px;max-width:60%;padding:8px 12px;border-radius:8px;background:rgba(16,20,28,.78);color:#f3eee4;font:15px/1.35 ui-monospace,monospace;z-index:2147483647;display:none';
      document.body.appendChild(d);
    });
    const applyDecision = async (d: Decision) => {
      const want = new Set((d.hold ?? []).map(key));
      for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
      for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
      // A tap is down and up before the next step: the game's input map latches it.
      for (const a of d.tap ?? []) { await page.keyboard.down(key(a)); await page.keyboard.up(key(a)); }
    };
    const ext = run.format === 'jpeg' ? 'jpg' : 'png';
    const shot = async (tick: number) => {
      const f = join(framesDir, `frame_${String(files.length).padStart(5, '0')}.${ext}`);
      await page.screenshot({ path: f, ...(ext === 'jpg' ? { type: 'jpeg' as const, quality: 90 } : {}) });
      files.push(f);
      hashes.push({ tick, hash: await page.evaluate(() => window.__game!.hash?.() ?? null) });
    };
    await page.evaluate(() => window.__game!.step!(0));
    await shot(0);
    for (let tick = 0; tick < run.ticks; ) {
      // Keys for a tick land before the step that samples them; ticks with
      // no input between them run as one batch (one render, not n).
      const target = Math.min(tick + every, run.ticks);
      while (tick < target) {
        while (si < script.length && script[si].tick <= tick) {
          const s = script[si++];
          if (s.type !== 'up') await page.keyboard.down(key(s.action));
          if (s.type !== 'down') await page.keyboard.up(key(s.action));
        }
        while (bi < beats.length && beats[bi].tick <= tick) {
          const b = beats[bi++];
          if (b.caption !== undefined) await page.evaluate((c) => { const el = document.getElementById('gamekit-caption')!; el.textContent = c; el.style.display = c ? 'block' : 'none'; }, b.caption);
          if (b.run) await b.run(page);
          log.push({ tick, caption: b.caption, state: await page.evaluate(() => window.__game!.state()) });
        }
        if (run.policy && tick % policyEvery === 0) {
          ctx.t = tick / hz;
          await applyDecision(run.policy(await page.evaluate(() => window.__game!.state()), ctx));
        }
        const nexts = [si < script.length ? script[si].tick : Infinity, bi < beats.length ? beats[bi].tick : Infinity,
          run.policy ? (Math.floor(tick / policyEvery) + 1) * policyEvery : Infinity];
        const next = Math.max(Math.min(...nexts), tick + 1);
        const n = Math.min(target, next) - tick;
        await page.evaluate((k) => window.__game!.step!(k), n);
        tick += n;
      }
      await shot(tick);
    }
    finalState = await page.evaluate(() => window.__game!.state());
  } finally {
    await ctx.close();
    if (!run.browser) await browser.close();
  }
  const result: CaptureResult = { name: run.name, frames: files.length, hashes, finalState, log };
  const fps = run.fps ?? hz / every;
  if (fps > 0) {
    result.video = join(run.outDir, `${run.name}.mp4`);
    await framesToMp4(join(framesDir, `frame_%05d.${run.format === 'jpeg' ? 'jpg' : 'png'}`), fps, result.video);
  }
  const pick = (n: number) => Array.from({ length: Math.min(n, files.length) }, (_, i) =>
    files[Math.round((i * (files.length - 1)) / Math.max(1, Math.min(n, files.length) - 1))]);
  const sheet = run.sheet === undefined ? { frames: 12, cols: 4 } : run.sheet;
  if (sheet) {
    result.sheet = join(run.outDir, `${run.name}-sheet.png`);
    await contactSheet(pick(sheet.frames), result.sheet, sheet.cols, sheet.width ?? 320);
  }
  if (run.strip) {
    result.strip = join(run.outDir, `${run.name}-strip.png`);
    await strip(pick(run.strip.frames), result.strip, run.strip.width ?? 240);
  }
  if (!run.keepFrames) await rm(framesDir, { recursive: true, force: true });
  await writeJson(join(run.outDir, `${run.name}-capture.json`), result);
  return result;
}
