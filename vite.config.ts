/// <reference types="vitest" />

import legacy from '@vitejs/plugin-legacy'
import react from '@vitejs/plugin-react'
import { createLogger, defineConfig, loadEnv, type LogErrorOptions, type LogOptions } from 'vite'

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

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load ALL env vars (empty prefix = no filtering) so tests can access
  // SPELEODB_* and API_* values via process.env.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      legacy(),
    ],
    customLogger: baseLogger,
    build: {
      // Vite's default is 500 kB, calibrated for web apps where every kB is a
      // network round-trip cost. This is a Capacitor mobile app: the JS ships
      // inside the IPA/APK and there is no first-load network, so the real
      // cost is parse/compile time on the device. A meaningful regression
      // threshold here is "did someone land a substantial new dependency?".
      //
      // Current main chunk is ~2.56 MB minified (~635 kB gzip). Top
      // contributors: maplibre-gl, @ionic/react, @sentry/*, react/react-dom.
      // 3000 kB gives ~17% headroom over today; anything past that means a
      // material new dep landed and someone should look at lazy-loading it
      // (driver.js and Sentry are the obvious first candidates).
      chunkSizeWarningLimit: 3000,
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/setupTests.ts',
      env,
    },
  };
})
