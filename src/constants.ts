/**
 * Centralized constants for API, HTTP, and preferences.
 * Add only what the app uses to keep the file maintainable.
 */

// ==================== API ENDPOINTS ====================
const BASE_PATH = '/api/v1';
export const API = {
  BASE_PATH,
  AUTH_TOKEN_ENDPOINT: BASE_PATH + '/user/auth-token/',
} as const;

// ==================== HTTP STATUS CODES ====================
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  UNAUTHORIZED: 401,
  UNPROCESSABLE_ENTITY: 422,
} as const;

// ==================== HTTP HEADERS ====================
export const HEADERS = {
  CONTENT_TYPE: 'Content-Type',
  ACCEPT: 'Accept',
  AUTHORIZATION: 'Authorization',
  APPLICATION_JSON: 'application/json',
  APPLICATION_JSON_UTF8: 'application/json; charset=UTF-8',
  TOKEN_PREFIX: 'Token ',
} as const;

// ==================== USER PREFERENCES ====================
export const PREFERENCES = {
  STORAGE_KEY: 'speleo_user_preferences',
  PREF_EMAIL: 'email',
  PREF_TOKEN: 'token',
  PREF_INSTANCE: 'instance',
  DEFAULT_INSTANCE: 'https://www.speleodb.org',
} as const;

// ==================== NETWORK ====================
export const NETWORK = {
  REQUEST_TIMEOUT_MS: 10000,
} as const;
