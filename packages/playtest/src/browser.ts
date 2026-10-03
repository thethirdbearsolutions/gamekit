// Launch the preinstalled Chromium (never `playwright install`). WebGL runs on
// SwiftShader so headless containers render the same as a desktop GPU would,
// only slower.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type LaunchOptions } from 'playwright-core';

export function findChromium(root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'): string {
  const env = process.env.GAMEKIT_CHROMIUM;
  if (env) return env;
  if (existsSync(join(root, 'chromium'))) {
    const direct = join(root, 'chromium');
    if (existsSync(join(direct, 'chrome'))) return join(direct, 'chrome');
  }
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) {
    for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const p = join(root, d, sub);
      if (existsSync(p)) return p;
    }
  }
  throw new Error(`No Chromium under ${root}; set GAMEKIT_CHROMIUM to an executable`);
}

export const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export function launchBrowser(opts: LaunchOptions = {}): Promise<Browser> {
  return chromium.launch({ executablePath: findChromium(), ...opts, args: [...GL_ARGS, ...(opts.args ?? [])] });
}
