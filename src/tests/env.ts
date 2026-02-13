/**
 * Typed access to .env test configuration.
 *
 * Values are loaded by Vitest via loadEnv() in vite.config.ts.
 * When .env is missing or a value is the placeholder from .env.dist,
 * the helpers here return undefined so tests can skip gracefully.
 */

const PLACEHOLDERS = new Set([
  'your-oauth-token-here',
  'your-email@example.com',
  'your-password-here',
]);

function env(key: string): string | undefined {
  const value = process.env[key]?.trim();
  if (!value || PLACEHOLDERS.has(value)) return undefined;
  return value;
}

export const TEST_ENV = {
  /** Base instance URL, e.g. "www.speleodb.org" */
  get instanceUrl() { return env('SPELEODB_INSTANCE_URL'); },

  /** Pre-authenticated OAuth token */
  get oauthToken() { return env('SPELEODB_OAUTH_TOKEN'); },

  /** Login email */
  get email() { return env('SPELEODB_EMAIL'); },

  /** Login password */
  get password() { return env('SPELEODB_PASSWORD'); },

  /** Request timeout in ms (default 10 000) */
  get timeoutMs() { return Number(env('API_TIMEOUT_MS') ?? 10_000); },

  /** Whether integration tests are enabled */
  get enabled() { return env('API_TEST_ENABLED') === 'true'; },
} as const;

/**
 * True when the .env file provides enough data to run integration tests.
 * Use with `describe.runIf(canRunIntegrationTests)`.
 */
export const canRunIntegrationTests =
  TEST_ENV.enabled &&
  !!TEST_ENV.instanceUrl &&
  !!TEST_ENV.email &&
  !!TEST_ENV.password;
