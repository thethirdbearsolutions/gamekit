// ffmpeg helpers: webm → mp4, frame sequence → mp4, contact sheets and strips.
import { spawn } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export function ffmpeg(args: string[], bin = process.env.FFMPEG ?? 'ffmpeg'): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${args.join(' ')} failed (${code}): ${err}`))));
  });
}

/** H.264 mp4 that plays everywhere (even dimensions, yuv420p, faststart). */
const MP4 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart',
  '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'];

export function webmToMp4(webm: string, mp4: string): Promise<void> {
  return ffmpeg(['-i', webm, ...MP4, mp4]);
}

/** `pattern` like dir/frame_%05d.png. */
export function framesToMp4(pattern: string, fps: number, mp4: string): Promise<void> {
  return ffmpeg(['-framerate', String(fps), '-i', pattern, ...MP4, mp4]);
}

/** Tile images into one sheet, `cols` across, each scaled to `width` px.
 *  Empty cells at the end are left black. */
export async function contactSheet(files: string[], out: string, cols: number, width = 320): Promise<void> {
  if (files.length === 0) throw new Error('contactSheet: no frames');
  const rows = Math.ceil(files.length / cols);
  const list = join(dirname(out), `.${basename(out)}.txt`);
  await writeFile(list, files.map((f) => `file '${resolve(f).replace(/'/g, "'\\''")}'`).join('\n'));
  try {
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `scale=${width}:-2,tile=${cols}x${rows}:padding=4:color=black`,
      '-frames:v', '1', '-update', '1', out]);
  } finally {
    await rm(list, { force: true });
  }
}

/** One row of frames (a filmstrip). */
export function strip(files: string[], out: string, width = 240): Promise<void> {
  return contactSheet(files, out, files.length, width);
}
