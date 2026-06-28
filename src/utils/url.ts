import { Browser } from '@capacitor/browser';

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '[::1]';
}

function parseSafeHttpUrl(value: string): URL {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new TypeError('Only HTTP(S) URLs are supported');
  }
  if (parsed.username || parsed.password) {
    throw new TypeError('URLs must not contain embedded credentials');
  }
  return parsed;
}

/**
 * Opens a URL in the platform's external browser.
 * Uses Chrome Custom Tabs on Android, SFSafariViewController on iOS,
 * and window.open on web — avoids the broken target="_blank" WebView path.
 */
export async function openExternalUrl(url: string): Promise<void> {
  const parsed = parseSafeHttpUrl(url);
  const allowDevelopmentHttp = import.meta.env.DEV && isLoopbackHostname(parsed.hostname);
  if (parsed.protocol !== 'https:' && !allowDevelopmentHttp) {
    throw new TypeError('External URLs must use HTTPS');
  }
  await Browser.open({ url: parsed.toString() });
}

/**
 * Normalizes instance base URL (trim, default https, no trailing slash).
 */
export function getInstanceBaseUrl(
  instance: string,
  allowInsecureLoopback = import.meta.env.DEV,
): string {
  const base = instance.trim();
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(base) ? base : `https://${base}`;
  const parsed = parseSafeHttpUrl(withScheme);
  if (
    parsed.protocol === 'http:'
    && !(allowInsecureLoopback && isLoopbackHostname(parsed.hostname))
  ) {
    parsed.protocol = 'https:';
  }
  return parsed.toString().replace(/\/+$/, '');
}

export const INSTANCE_PATHS = {
  SIGNUP: '/signup/',
  PASSWORD_RESET: '/account/password/reset/',
} as const;
