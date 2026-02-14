import React from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { addIcons } from 'ionicons';
import { arrowDownOutline } from 'ionicons/icons';
import * as SentryReact from '@sentry/react';
import App from './App';
import { initSentry } from './monitoring/sentry';

addIcons({
  'arrow-down-outline': arrowDownOutline,
});

initSentry();

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

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(
  <React.StrictMode>
    <SentryReact.ErrorBoundary fallback={<div>Something went wrong.</div>}>
      <App />
    </SentryReact.ErrorBoundary>
  </React.StrictMode>
);

registerServiceWorker();