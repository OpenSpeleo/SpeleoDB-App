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
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#0f172a',
      showSpinner: false,
    },
  },
};

export default config;
