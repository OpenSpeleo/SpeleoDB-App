import { defineConfig } from 'vitest/config';
import { searchForWorkspaceRoot } from 'vite';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const maplibrePackageRoot = path.dirname(createRequire(import.meta.url).resolve('maplibre-gl/package.json'));

export default defineConfig({
  root: repoRoot,
  server: { fs: { allow: [searchForWorkspaceRoot(repoRoot), maplibrePackageRoot] } },
  test: {
    globals: true,
    environment: 'jsdom',
    pool: 'forks',
    execArgv: ['--preload', path.join(repoRoot, 'scripts/jsdom-runtime.mjs')],
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
