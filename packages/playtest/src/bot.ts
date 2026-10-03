// Closed-loop real-time bot: read the game's state, ask the policy what to
// press, press real keys, repeat. Playwright records the session to video.
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { launchBrowser } from './browser.js';
import type { Decision, Policy, PolicyContext } from './contract.js';
import { KeyHands } from './keys.js';
import { RunLog, writeJson } from './report.js';
import { webmToMp4 } from './video.js';

export interface BotRun<S = any> {
  /** Name for output files (`<name>.mp4`, `<name>.json`). */
  name: string;
  url: string;
  policy: Policy<S>;
  outDir: string;
  /** Wall-clock limit in seconds (default 60). */
  limitS?: number;
  /** Decision interval in ms when the policy doesn't say (default 45). */
  pollMs?: number;
  viewport?: { width: number; height: number };
  /** Record video (default true). mp4 needs ffmpeg; set mp4: false to keep webm. */
  video?: boolean;
  mp4?: boolean;
  /** Pause before play starts and after it ends, so viewers get their bearings (ms). */
  leadInMs?: number;
  leadOutMs?: number;
  /** Override how state is read (default `window.__game.state()`); runs in the
   *  page. With it, play starts once it returns without throwing. */
  readState?: () => S;
  /** Action → keys, when the page doesn't expose `window.__game.actions`. */
  actions?: Record<string, readonly string[]>;
  /** Pick numbers out of each state for the metrics timeline. */
  metrics?: (state: S) => Record<string, unknown>;
  /** State fields whose changes go in the event log (e.g. ['mode']). */
  watch?: (keyof S & string)[];
  /** Summary computed in the page at the end. */
  summarize?: () => unknown;
  params?: Record<string, string>;
  browser?: Browser;
}

export interface BotResult {
  name: string;
  done: boolean;
  wallSeconds: number;
  decisions: number;
  keyPresses: number;
  summary: unknown;
  gameEvents: unknown[];
  log: ReturnType<RunLog['toJSON']>;
  video?: string;
}

const defaultRead = () => {
  const g = window.__game;
  if (!g) throw new Error('window.__game missing');
  return g.state();
};

export async function runBot<S = any>(run: BotRun<S>): Promise<BotResult> {
  const viewport = run.viewport ?? { width: 1280, height: 720 };
  const browser = run.browser ?? (await launchBrowser());
  const tmpDir = join(run.outDir, `.video-${run.name}`);
  await mkdir(run.outDir, { recursive: true });
  const ctx = await browser.newContext({ viewport, ...(run.video !== false ? { recordVideo: { dir: tmpDir, size: viewport } } : {}) });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let result: BotResult;
  try {
    result = await play(page, run, errors);
  } finally {
    const video = page.video();
    await ctx.close();
    if (video && run.video !== false) {
      const webm = join(run.outDir, `${run.name}.webm`);
      await video.saveAs(webm);
      await video.delete();
      if (run.mp4 !== false) {
        const mp4 = join(run.outDir, `${run.name}.mp4`);
        await webmToMp4(webm, mp4);
        await rm(webm);
        result!.video = mp4;
      } else result!.video = webm;
    }
    await rm(tmpDir, { recursive: true, force: true });
    if (!run.browser) await browser.close();
  }
  await writeJson(join(run.outDir, `${run.name}.json`), result!);
  return result!;
}

async function play<S>(page: Page, run: BotRun<S>, errors: string[]): Promise<BotResult> {
  await page.goto(run.url);
  if (run.readState) {
    const probe = `(() => { try { return !!(${run.readState.toString()})(); } catch { return false; } })()`;
    await page.waitForFunction(probe, null, { timeout: 30_000 });
  } else await page.waitForFunction(() => !!window.__game, null, { timeout: 30_000 });
  const actions = run.actions ?? (await page.evaluate(() => window.__game!.actions as Record<string, string[]>));
  const hands = new KeyHands(page, actions);
  await page.click('body').catch(() => {});
  if (run.leadInMs ?? 1000) await page.waitForTimeout(run.leadInMs ?? 1000);

  const log = new RunLog();
  const ctx: PolicyContext = { t: 0, memory: {}, params: run.params ?? {} };
  const read = run.readState ?? (defaultRead as () => S);
  const limit = (run.limitS ?? 60) * 1000;
  const t0 = Date.now();
  let decisions = 0;
  let done = false;
  while (Date.now() - t0 < limit) {
    if (errors.length) { log.event(ctx.t, 'pageerror', { message: errors.shift() }); }
    const state = await page.evaluate(read);
    ctx.t = (Date.now() - t0) / 1000;
    if (run.metrics) log.sample(ctx.t, run.metrics(state));
    for (const k of run.watch ?? []) log.change(ctx.t, k, (state as any)[k]);
    const d: Decision = run.policy(state, ctx);
    decisions++;
    if (d.note) log.event(ctx.t, 'note', { note: d.note });
    if (d.done) { done = true; break; }
    await hands.hold(d.hold ?? []);
    for (const a of d.tap ?? []) await hands.tap(a);
    await page.waitForTimeout(d.waitMs ?? run.pollMs ?? 45);
  }
  await hands.releaseAll();
  log.event((Date.now() - t0) / 1000, done ? 'done' : 'timeout');
  await page.waitForTimeout(run.leadOutMs ?? 2000);
  const summary = run.summarize ? await page.evaluate(run.summarize) : null;
  const gameEvents = await page.evaluate(() => window.__game?.events?.() ?? []);
  return { name: run.name, done, wallSeconds: +((Date.now() - t0) / 1000).toFixed(1), decisions, keyPresses: hands.presses,
    summary, gameEvents, log: log.toJSON() };
}

/** Run several named variants in one browser, one video each. */
export async function runBots<S>(runs: BotRun<S>[]): Promise<Record<string, BotResult>> {
  const browser = await launchBrowser();
  const out: Record<string, BotResult> = {};
  try {
    for (const r of runs) out[r.name] = await runBot({ ...r, browser });
  } finally {
    await browser.close();
  }
  return out;
}

