import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Resolve @wt/engine to its TypeScript source in tests so engine edits are picked
// up without a rebuild. (Production and dev use the built dist via package exports.)
export default defineConfig({
  resolve: {
    alias: {
      '@wt/engine': fileURLToPath(new URL('../../packages/engine/src/index.ts', import.meta.url)),
    },
  },
});
