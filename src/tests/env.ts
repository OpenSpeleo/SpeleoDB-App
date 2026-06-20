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
  !!TEST_ENV.password &&
  !!TEST_ENV.oauthToken;

export const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

function extractAuthFailureMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const asRecord = payload as Record<string, unknown>;
  const detail = asRecord.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  const message = asRecord.message;
  if (typeof message === 'string' && message.trim()) return message;
  const errors = asRecord.errors;
  if (!errors || typeof errors !== 'object') return undefined;
  const nonFieldErrors = (errors as Record<string, unknown>).non_field_errors;
  if (Array.isArray(nonFieldErrors)) {
    const first = nonFieldErrors[0];
    if (typeof first === 'string' && first.trim()) return first;
  }
  return undefined;
}

export function isUnverifiedEmailAuthFailure(status: number, payload: unknown): boolean {
  if (status !== 400) return false;
  const message = extractAuthFailureMessage(payload);
  if (!message) return false;
  return message.toLowerCase().includes('email address has not been verified');
}

export function isGitHubActionsForbiddenAuthFailure(status: number): boolean {
  return isGitHubActions && status === 403;
}

export function isGitHubActionsPasswordLoginBlocked(
  result: { success: boolean; message: string },
): boolean {
  if (!isGitHubActions || result.success) return false;
  const message = result.message.toLowerCase();
  return message.includes('forbidden') || message.includes('permission') || message.includes('login failed');
}
