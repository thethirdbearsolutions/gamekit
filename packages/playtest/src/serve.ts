// Minimal static file server for playtesting a built game (or a test page)
// without a dev server.
import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary',
  '.hdr': 'application/octet-stream', '.ktx2': 'image/ktx2',
};

export async function serveStatic(dir: string, port = 0): Promise<{ url: string; server: Server; close: () => Promise<void> }> {
  const root = resolve(dir);
  const server = createServer(async (req, res) => {
    try {
      let p = normalize(join(root, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)));
      if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
      if ((await stat(p)).isDirectory()) p = join(p, 'index.html');
      res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' }).end(await readFile(p));
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const addr = server.address();
  const url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : port}/`;
  return { url, server, close: () => new Promise((r) => server.close(() => r())) };
}
