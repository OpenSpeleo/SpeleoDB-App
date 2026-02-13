import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.ionic.starter',
  appName: 'SpeleoDB',
  webDir: 'dist',
  plugins: {
    // Use native HTTP for fetch/XHR on iOS and Android so API calls bypass the web view and avoid CORS.
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
