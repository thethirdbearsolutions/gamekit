// A static index.html over a run directory: every mp4, sheet and strip, with
// the JSON results beside them. Open it straight from disk.
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export async function writeGallery(outDir: string, title = 'playtest run'): Promise<string> {
  const files = (await readdir(outDir)).sort();
  const cards = files.filter((f) => /\.(mp4|webm|png)$/.test(f)).map((f) => {
    const media = f.endsWith('.png') ? `<img src="${esc(f)}" loading="lazy">` : `<video src="${esc(f)}" controls muted loop preload="metadata"></video>`;
    return `<figure>${media}<figcaption>${esc(f)}</figcaption></figure>`;
  });
  const json = files.filter((f) => f.endsWith('.json')).map((f) => `<li><a href="${esc(f)}">${esc(f)}</a></li>`);
  const html = `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:14px system-ui;background:#111;color:#ddd;margin:1.5rem}figure{margin:0 0 1.5rem}
img,video{max-width:100%;border:1px solid #333}figcaption{color:#999;font-size:12px}a{color:#8cf}</style>
<h1>${esc(title)}</h1><ul>${json.join('')}</ul>${cards.join('\n')}`;
  const path = join(outDir, 'index.html');
  await writeFile(path, html);
  return path;
}
