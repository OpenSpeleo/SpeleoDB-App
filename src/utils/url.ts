import { Browser } from '@capacitor/browser';

/**
 * Opens a URL in the platform's external browser.
 * Uses Chrome Custom Tabs on Android, SFSafariViewController on iOS,
 * and window.open on web — avoids the broken target="_blank" WebView path.
 */
export async function openExternalUrl(url: string): Promise<void> {
  await Browser.open({ url });
}

/**
 * Normalizes instance base URL (trim, default https, no trailing slash).
 */
export function getInstanceBaseUrl(instance: string): string {
  const base = instance.trim();
  const withScheme =
    base.startsWith('http://') || base.startsWith('https://')
      ? base
      : `https://${base}`;
  return withScheme.replace(/\/+$/, '');
}

export const INSTANCE_PATHS = {
  SIGNUP: '/signup/',
  PASSWORD_RESET: '/account/password/reset/',
} as const;
