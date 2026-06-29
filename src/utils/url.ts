import { Browser } from '@capacitor/browser';
import {
  isLoopbackHostname,
  parseSafeHttpUrl,
} from './instanceUrl';

export { getInstanceBaseUrl } from './instanceUrl';

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

export const INSTANCE_PATHS = {
  SIGNUP: '/signup/',
  PASSWORD_RESET: '/account/password/reset/',
} as const;
