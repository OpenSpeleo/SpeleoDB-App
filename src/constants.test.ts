import { describe, it, expect } from 'vitest';
import { API, HTTP_STATUS, HEADERS, PREFERENCES, NETWORK } from './constants';

describe('constants', () => {
  describe('API', () => {
    it('has BASE_PATH /api/v1', () => {
      expect(API.BASE_PATH).toBe('/api/v1');
    });

    it('has AUTH_TOKEN_ENDPOINT containing /user/auth-token/', () => {
      expect(API.AUTH_TOKEN_ENDPOINT).toContain('/user/auth-token/');
      expect(API.AUTH_TOKEN_ENDPOINT).toBe('/api/v1/user/auth-token/');
    });
  });

  describe('HTTP_STATUS', () => {
    it('has expected status codes', () => {
      expect(HTTP_STATUS.OK).toBe(200);
      expect(HTTP_STATUS.CREATED).toBe(201);
      expect(HTTP_STATUS.UNAUTHORIZED).toBe(401);
      expect(HTTP_STATUS.UNPROCESSABLE_ENTITY).toBe(422);
    });
  });

  describe('HEADERS', () => {
    it('has CONTENT_TYPE and AUTHORIZATION', () => {
      expect(HEADERS.CONTENT_TYPE).toBe('Content-Type');
      expect(HEADERS.AUTHORIZATION).toBe('Authorization');
    });

    it('has APPLICATION_JSON and TOKEN_PREFIX', () => {
      expect(HEADERS.APPLICATION_JSON).toBe('application/json');
      expect(HEADERS.TOKEN_PREFIX).toBe('Token ');
    });
  });

  describe('PREFERENCES', () => {
    it('has DEFAULT_INSTANCE as https://www.speleodb.org', () => {
      expect(PREFERENCES.DEFAULT_INSTANCE).toBe('https://www.speleodb.org');
    });

    it('has STORAGE_KEY and pref keys', () => {
      expect(PREFERENCES.STORAGE_KEY).toBe('speleo_user_preferences');
      expect(PREFERENCES.PREF_EMAIL).toBe('email');
      expect(PREFERENCES.PREF_TOKEN).toBe('token');
      expect(PREFERENCES.PREF_INSTANCE).toBe('instance');
    });
  });

  describe('NETWORK', () => {
    it('has REQUEST_TIMEOUT_MS', () => {
      expect(NETWORK.REQUEST_TIMEOUT_MS).toBe(10000);
    });
  });
});
