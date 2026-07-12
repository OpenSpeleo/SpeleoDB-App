import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  root: repoRoot,
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    include: ['benchmarks/sync-wall-clock.test.tsx'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    onConsoleLog(log) {
      if (log.startsWith('[project-geojson:bbox]')) return false;
      if (log.startsWith('[project-sync:timing]')) return false;
    },
  },
});
