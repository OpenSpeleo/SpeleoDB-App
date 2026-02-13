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
