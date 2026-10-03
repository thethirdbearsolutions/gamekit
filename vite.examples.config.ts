// Serves every package's examples/ at http://localhost:5199/packages/<pkg>/examples/
import { defineConfig } from 'vite';

const src = (p: string) => new URL(`./packages/${p}/src/index.ts`, import.meta.url).pathname;

export default defineConfig({
  server: { port: 5199, strictPort: true, host: '127.0.0.1', watch: { ignored: ['**/out/**', '**/captures/**', '**/dist/**'] } },
  resolve: {
    alias: {
      '@gamekit/core': src('core'),
      '@gamekit/physics': src('physics'),
      '@gamekit/render': src('render'),
    },
  },
});
