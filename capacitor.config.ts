import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "org.speleodb.app",
  appName: "SpeleoDB",
  webDir: "dist",
  // Native bridge debug logging includes plugin arguments. Credentials cross
  // that bridge, so native logging must remain disabled in every build type.
  loggingBehavior: "none",
  server: {
    hostname: "www.speleodb.org",
    androidScheme: "https",
  },
  android: {
    // Required by @capacitor-community/background-geolocation: without the
    // legacy bridge, Android halts WebView location updates ~5 min after the
    // app is backgrounded. See the plugin README / issue #89.
    useLegacyBridge: true,
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: "#0f172a",
      showSpinner: false,
    },
  }
};

export default config;
