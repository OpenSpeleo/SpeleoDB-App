import React from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App';
import { AppErrorBoundary } from './monitoring/AppErrorBoundary';
import { initSentry } from './monitoring/sentry';
import { appSessionStore } from './services/AppSessionStore';
import { removeLegacyPlaintextCredentials } from './services/PreferencesService';
import { installDiagnosticRedaction } from './utils/errorDiagnostics';

/**
 * On Android the WebView always returns 0 for CSS `env(safe-area-inset-*)`.
 * Capacitor 8's built-in SystemBars plugin injects accurate values as inline
 * CSS custom properties on <html>, but only on Android 15+ (API 35).
 *
 * We set a sensible default here BEFORE React renders so the UI never sits
 * flush against the system navigation bar.  On Android 15+ the SystemBars
 * plugin will overwrite our defaults with the real values once its
 * DOMContentLoaded → onDOMReady callback chain completes.
 */
function initAndroidSafeArea(): void {
  if (Capacitor.getPlatform() !== 'android') return;
  document.documentElement.style.setProperty('--safe-area-inset-bottom', '40px');
}

function registerServiceWorker(): void {
  if (import.meta.env.DEV) return;
  if (!('serviceWorker' in navigator)) return;
  if (Capacitor.isNativePlatform()) {
    // Native Capacitor builds already ship local assets; service workers can
    // introduce stale chunk issues across app updates in WebView.
    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister())),
      )
      .catch(() => {});
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('Service worker registration failed:', error);
    });
  });
}

async function bootstrap(): Promise<void> {
  installDiagnosticRedaction();
  initSentry();
  initAndroidSafeArea();
  try {
    removeLegacyPlaintextCredentials();
    await appSessionStore.initialize();
  } catch {
    // Fail closed to the login screen. Native storage details and credentials
    // must never be written to diagnostics.
    console.error('Secure session initialization failed.');
  }

  const container = document.getElementById('root');
  const root = createRoot(container!);
  root.render(
    <React.StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </React.StrictMode>,
  );
  registerServiceWorker();
}

void bootstrap();
