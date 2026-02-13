/// <reference types="vitest" />

import legacy from '@vitejs/plugin-legacy'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

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
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/setupTests.ts',
      env,
    },
  };
})
