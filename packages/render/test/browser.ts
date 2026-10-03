// Runs a test page in the preinstalled Chromium (WebGL on SwiftShader) via a
// vite dev server, and returns whatever the page puts on window.__result.
import { createServer, type ViteDevServer } from 'vite';
import type { Browser } from 'playwright-core';
import { launchBrowser } from '../../playtest/src/browser.js';

const root = new URL('../../..', import.meta.url).pathname;
const src = (p: string) => `${root}packages/${p}/src/index.ts`;

export interface Rig { server: ViteDevServer; browser: Browser; base: string; close(): Promise<void> }

export async function startRig(): Promise<Rig> {
  const server = await createServer({
    root, logLevel: 'error', configFile: false,
    server: { port: 0, host: '127.0.0.1', watch: null },
    resolve: { alias: { '@gamekit/core': src('core'), '@gamekit/render': src('render'), '@gamekit/physics': src('physics') } },
    optimizeDeps: { include: ['three', 'three/addons/postprocessing/EffectComposer.js'] },
  });
  await server.listen();
  const addr = server.httpServer!.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/packages/render/test/pages/`;
  const browser = await launchBrowser();
  return { server, browser, base, close: async () => { await browser.close(); await server.close(); } };
}

export async function runPage<T = any>(rig: Rig, page: string, timeout = 60_000): Promise<T> {
  const ctx = await rig.browser.newContext({ viewport: { width: 256, height: 256 } });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('404')) errors.push(m.text());
  });
  try {
    await p.goto(rig.base + page);
    await p.waitForFunction(() => (window as any).__result !== undefined || (window as any).__error !== undefined, null, { timeout });
    const err = await p.evaluate(() => (window as any).__error);
    if (err) throw new Error(`${page}: ${err}\n${errors.join('\n')}`);
    const result = await p.evaluate(() => (window as any).__result);
    return { ...result, consoleErrors: errors } as T;
  } finally {
    await ctx.close();
  }
}
