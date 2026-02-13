/**
 * Integration tests for SpeleoDBService.
 *
 * These tests make REAL HTTP calls against the SpeleoDB instance
 * configured in .env. They are skipped automatically when
 * API_TEST_ENABLED is not "true" or credentials are missing.
 */

import { describe, it, expect } from 'vitest';
import { HttpClient } from '../services/HttpClient';
import { SpeleoDBService } from '../services/SpeleoDBService';
import { HTTP_STATUS } from '../constants';
import { canRunIntegrationTests, TEST_ENV } from './env';

describe.runIf(canRunIntegrationTests)('SpeleoDBService [integration]', () => {
  const http = new HttpClient();
  const service = new SpeleoDBService(http);

  // These are read from .env — guaranteed non-null by canRunIntegrationTests guard.
  const instance = TEST_ENV.instanceUrl!;
  const email = TEST_ENV.email!;
  const password = TEST_ENV.password!;
  const oauthToken = TEST_ENV.oauthToken!;

  // ---- authenticate ---------------------------------------------------------

  describe('authenticate', () => {
    it('returns 200 and a token for valid credentials', async () => {
      const res = await service.authenticate(instance, email, password);

      expect(res.status).toBe(HTTP_STATUS.OK);
      expect(res.data).toBeDefined();
      expect(res.data.token).toBeTruthy();
      expect(typeof res.data.token).toBe('string');
      expect(res.data.user).toBeTruthy();
    }, TEST_ENV.timeoutMs);

    it('returns 400/401 for wrong password', async () => {
      const res = await service.authenticate(instance, email, 'definitely-wrong-password');

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }, TEST_ENV.timeoutMs);

    it('returns 400/401 for non-existent email', async () => {
      const res = await service.authenticate(instance, 'nonexistent-user-xyz@speleodb.org', 'any');

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }, TEST_ENV.timeoutMs);
  });

  // ---- validateToken --------------------------------------------------------

  describe('validateToken', () => {
    it('returns 2xx for a valid OAuth token from .env', async () => {
      const res = await service.validateToken(instance, oauthToken);

      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
    }, TEST_ENV.timeoutMs);

    it('returns 4xx for a bogus token', async () => {
      const res = await service.validateToken(instance, 'bogus-token-that-does-not-exist');

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }, TEST_ENV.timeoutMs);

    it('validates a freshly-obtained token from authenticate()', async () => {
      const authRes = await service.authenticate(instance, email, password);
      expect(authRes.status).toBe(HTTP_STATUS.OK);

      const freshToken = authRes.data.token;
      const validateRes = await service.validateToken(instance, freshToken);

      expect(validateRes.status).toBeGreaterThanOrEqual(200);
      expect(validateRes.status).toBeLessThan(300);
    }, TEST_ENV.timeoutMs);
  });
});
