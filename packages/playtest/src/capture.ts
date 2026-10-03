// Frame-stepped deterministic capture. The page starts paused; we drive the
// sim with window.__game.step(n) and screenshot between steps, so output is
// identical however slow the machine is (SwiftShader included) and the video
// plays at true speed.
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser } from 'playwright-core';
import { launchBrowser } from './browser.js';
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
  browser?: Browser;
}

export interface CaptureResult {
  name: string;
  frames: number;
  hashes: { tick: number; hash: string | null }[];
  finalState: unknown;
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
  let finalState: unknown;
  try {
    const url = new URL(run.url);
    url.searchParams.set('paused', '1');
    await page.goto(url.href);
    await page.waitForFunction(() => typeof window.__game?.step === 'function', null, { timeout: 30_000 });
    await page.evaluate(() => window.__game!.pause?.());
    const actions = await page.evaluate(() => window.__game!.actions as Record<string, string[]>);
    const key = (a: string) => actions[a]?.[0] ?? (() => { throw new Error(`no key for ${a}`); })();
    const script = [...(run.script ?? [])].sort((a, b) => a.tick - b.tick);
    let si = 0;
    const shot = async (tick: number) => {
      const f = join(framesDir, `frame_${String(files.length).padStart(5, '0')}.png`);
      await page.screenshot({ path: f });
      files.push(f);
      hashes.push({ tick, hash: await page.evaluate(() => window.__game!.hash?.() ?? null) });
    };
    await page.evaluate(() => window.__game!.step!(0));
    await shot(0);
    for (let tick = 0; tick < run.ticks; ) {
      // Keys for every tick in this chunk must land before the step that samples them.
      const n = Math.min(every, run.ticks - tick);
      for (let k = 0; k < n; k++, tick++) {
        while (si < script.length && script[si].tick <= tick) {
          const s = script[si++];
          if (s.type !== 'up') await page.keyboard.down(key(s.action));
          if (s.type !== 'down') await page.keyboard.up(key(s.action));
        }
        await page.evaluate(() => window.__game!.step!(1));
      }
      await shot(tick);
    }
    finalState = await page.evaluate(() => window.__game!.state());
  } finally {
    await ctx.close();
    if (!run.browser) await browser.close();
  }
  const result: CaptureResult = { name: run.name, frames: files.length, hashes, finalState };
  const fps = run.fps ?? hz / every;
  if (fps > 0) {
    result.video = join(run.outDir, `${run.name}.mp4`);
    await framesToMp4(join(framesDir, 'frame_%05d.png'), fps, result.video);
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
