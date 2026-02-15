import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.speleodb.app',
  appName: 'SpeleoDB',
  webDir: 'dist',
  server: {
    hostname: 'www.speleodb.org',
    androidScheme: 'https',
  },
  plugins: {
    // Use native HTTP for fetch/XHR on iOS and Android so API calls bypass the web view and avoid CORS.
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
