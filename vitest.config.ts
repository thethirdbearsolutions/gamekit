import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@gamekit/core': new URL('./packages/core/src/index.ts', import.meta.url).pathname,
      '@gamekit/physics': new URL('./packages/physics/src/index.ts', import.meta.url).pathname,
      '@gamekit/render': new URL('./packages/render/src/index.ts', import.meta.url).pathname,
      '@gamekit/playtest': new URL('./packages/playtest/src/index.ts', import.meta.url).pathname,
    },
  },
  test: { include: ['packages/*/test/**/*.test.ts'], testTimeout: 60_000 },
});
