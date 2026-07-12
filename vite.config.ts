/// <reference types="vitest" />

import legacy from '@vitejs/plugin-legacy'
import react from '@vitejs/plugin-react'
import {
  createLogger,
  defineConfig,
  loadEnv,
  type LogErrorOptions,
  type LogOptions,
  type PluginOption,
} from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.dirname(fileURLToPath(import.meta.url))

// Custom logger that drops a single class of third-party noise while leaving
// every other build message intact: lightningcss (Vite 8's CSS minifier) does
// not recognize `:host-context([dir=rtl])` (a valid Web Components Shadow DOM
// Level 3 pseudo-class) and emits a warning for every Ionic RTL utility rule
// it sees in @ionic/react/css/* (40+ messages per build). Our app has no RTL
// support so the rules these selectors guard are dead at runtime regardless.
// Filtering here is surgical: only messages containing BOTH `lightningcss`
// and `host-context` are dropped; any other warning/info from any source --
// including future lightningcss messages about other selectors -- is preserved.
const baseLogger = createLogger()
const isLightningCssHostContextNoise = (msg: string): boolean =>
  msg.includes('lightningcss') && msg.includes('host-context')
const originalWarn = baseLogger.warn.bind(baseLogger)
const originalWarnOnce = baseLogger.warnOnce.bind(baseLogger)
const originalInfo = baseLogger.info.bind(baseLogger)
baseLogger.warn = (msg: string, options?: LogErrorOptions) => {
  if (isLightningCssHostContextNoise(msg)) return
  originalWarn(msg, options)
}
baseLogger.warnOnce = (msg: string, options?: LogErrorOptions) => {
  if (isLightningCssHostContextNoise(msg)) return
  originalWarnOnce(msg, options)
}
baseLogger.info = (msg: string, options?: LogOptions) => {
  if (isLightningCssHostContextNoise(msg)) return
  originalInfo(msg, options)
}

const BUNDLE_BUDGET = {
  maxEntryChunkBytes: 450_000,
  maxInitialJsBytes: 1_200_000,
  maxLazyChunkBytes: 1_900_000,
} as const

function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

function createBundleBudgetPlugin(options: {
  legacyEnabled: boolean
  enforceBudget: boolean
}): PluginOption {
  return {
    name: 'bundle-budget',
    generateBundle(_outputOptions, bundle) {
      const chunks = Object.values(bundle).filter((entry) => entry.type === 'chunk')
      const chunkByFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
      const mainEntry = chunks.find((chunk) => chunk.facadeModuleId?.endsWith('/src/main.tsx'))
        ?? chunks.find((chunk) => chunk.isEntry)

      if (!mainEntry) return

      const visited = new Set<string>()
      const collectInitialChunks = (fileName: string): typeof chunks => {
        if (visited.has(fileName)) return []
        visited.add(fileName)

        const chunk = chunkByFileName.get(fileName)
        if (!chunk) return []

        return [
          chunk,
          ...chunk.imports.flatMap((importedFile) => collectInitialChunks(importedFile)),
        ]
      }

      const initialChunks = collectInitialChunks(mainEntry.fileName)
      const allChunkStats = chunks
        .map((chunk) => ({
          fileName: chunk.fileName,
          name: chunk.name,
          isEntry: chunk.isEntry,
          bytes: Buffer.byteLength(chunk.code, 'utf8'),
        }))
        .sort((left, right) => right.bytes - left.bytes)
      const mainEntryStats = allChunkStats.find((chunk) => chunk.fileName === mainEntry.fileName)
      const largestLazyChunk = allChunkStats.find((chunk) => !chunk.isEntry)
      const initialJsBytes = initialChunks.reduce(
        (sum, chunk) => sum + Buffer.byteLength(chunk.code, 'utf8'),
        0,
      )

      this.emitFile({
        type: 'asset',
        fileName: 'bundle-stats.json',
        source: JSON.stringify({
          legacyEnabled: options.legacyEnabled,
          enforceBudget: options.enforceBudget,
          budgets: BUNDLE_BUDGET,
          mainEntry: mainEntryStats,
          initialJsBytes,
          initialChunkFiles: initialChunks.map((chunk) => chunk.fileName),
          largestLazyChunk,
          chunks: allChunkStats,
        }, null, 2),
      })

      if (
        options.enforceBudget &&
        mainEntryStats &&
        mainEntryStats.bytes > BUNDLE_BUDGET.maxEntryChunkBytes
      ) {
        this.error(
          `[bundle-budget] Main entry chunk ${mainEntryStats.fileName} is ${formatBytes(mainEntryStats.bytes)} (budget ${formatBytes(BUNDLE_BUDGET.maxEntryChunkBytes)}).`,
        )
      }

      if (options.enforceBudget && initialJsBytes > BUNDLE_BUDGET.maxInitialJsBytes) {
        this.error(
          `[bundle-budget] Initial JS graph is ${formatBytes(initialJsBytes)} (budget ${formatBytes(BUNDLE_BUDGET.maxInitialJsBytes)}).`,
        )
      }

      if (
        options.enforceBudget &&
        largestLazyChunk &&
        largestLazyChunk.bytes > BUNDLE_BUDGET.maxLazyChunkBytes
      ) {
        this.error(
          `[bundle-budget] Largest lazy chunk ${largestLazyChunk.fileName} is ${formatBytes(largestLazyChunk.bytes)} (budget ${formatBytes(BUNDLE_BUDGET.maxLazyChunkBytes)}).`,
        )
      }
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load ALL env vars (empty prefix = no filtering) so tests can access
  // SPELEODB_* and API_* values via process.env.
  const env = loadEnv(mode, process.cwd(), '')
  const enableLegacyPlugin = env.VITE_ENABLE_LEGACY_PLUGIN === 'true'
  const enforceBundleBudget = env.VITE_ENFORCE_BUNDLE_BUDGET !== 'false'

  return {
    plugins: [
      react(),
      enableLegacyPlugin && legacy(),
      createBundleBudgetPlugin({
        legacyEnabled: enableLegacyPlugin,
        enforceBudget: enforceBundleBudget,
      }),
    ],
    customLogger: baseLogger,
    resolve: {
      alias: {
        events: path.resolve(repoRoot, 'src/polyfills/node-events.ts'),
        url: path.resolve(repoRoot, 'src/polyfills/node-url.ts'),
      },
    },
    build: {
      // The app ships inside Capacitor, so cold-start parse/compile time matters
      // more than transfer size. The explicit bundle-budget plugin above enforces
      // measured limits for the main entry, the initial JS graph, and the
      // heaviest lazy chunk while also writing dist/bundle-stats.json.
      // Disable Vite's automatic modulepreload injection so auth-only dynamic
      // imports do not get eagerly pulled back into the startup graph.
      modulePreload: false,
      chunkSizeWarningLimit: Math.ceil(BUNDLE_BUDGET.maxLazyChunkBytes / 1024),
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/setupTests.ts',
      env,
      coverage: {
        provider: 'v8',
        thresholds: {
          // Audited July 2026 repository floors. Keep a small deterministic
          // margin below the measured baseline while preventing regression.
          statements: 90,
          branches: 82,
          functions: 92,
          lines: 92,
          perFile: false,
          autoUpdate: false,
          // Critical authority, transition, replay, and transaction seams use
          // their own measured floors so strong local coverage cannot be hidden
          // by the global aggregate.
          'src/controllers/GpsRecordingCoordinator.ts': {
            statements: 97,
            branches: 91,
            functions: 100,
            lines: 100,
          },
          'src/controllers/SessionCoordinator.ts': {
            statements: 100,
            branches: 100,
            functions: 100,
            lines: 100,
          },
          'src/offline/OfflineOpQueue.ts': {
            statements: 82,
            branches: 65,
            functions: 93,
            lines: 83,
          },
          'src/services/CacheStore.ts': {
            statements: 81,
            branches: 69,
            functions: 88,
            lines: 81,
          },
        },
      },
      onConsoleLog(log) {
        if (log.startsWith('[project-geojson:bbox]')) return false
        if (log.startsWith('[project-geojson:timing]')) return false
        if (log.startsWith('[dashboard-map:timing]')) return false
      },
      // Scope the runner to the mobile app's own tests. The nested `SpeleoDB/`
      // Django web reference is read-only and ships its own test runner; its
      // error-path `console.error` calls trip this repo's consoleGuard when
      // swept in by vitest's default glob, so they are intentionally excluded.
      include: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'quality/**/*.test.ts',
      ],
    },
  };
})
