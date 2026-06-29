export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '[::1]';
}

export function parseSafeHttpUrl(value: string): URL {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new TypeError('Only HTTP(S) URLs are supported');
  }
  if (parsed.username || parsed.password) {
    throw new TypeError('URLs must not contain embedded credentials');
  }
  return parsed;
}

/** Canonicalizes a SpeleoDB instance to an origin suitable for API paths. */
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
  if (!/^\/*$/.test(parsed.pathname) || parsed.search || parsed.hash) {
    throw new TypeError(
      'SpeleoDB instance must be an origin URL without a path, query, or fragment',
    );
  }
  return parsed.origin;
}
