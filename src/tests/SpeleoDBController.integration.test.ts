/**
 * Integration tests for SpeleoDBController.
 *
 * Exercises the full stack: Controller -> SpeleoDBService -> HttpClient -> network.
 * Uses real credentials from .env. Skipped when API_TEST_ENABLED != "true".
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HttpClient } from '../services/HttpClient';
import { SpeleoDBService } from '../services/SpeleoDBService';
import { SpeleoDBController, type PreferencesPort } from '../controllers/SpeleoDBController';
import { PREFERENCES } from '../constants';
import { canRunIntegrationTests, TEST_ENV } from './env';

/** In-memory preferences (mirrors PreferencesService without touching localStorage). */
function createMemoryPrefs(initial?: Partial<{ email: string; token: string; instance: string }>): PreferencesPort {
  let store: { email?: string; token?: string; instance?: string } = { ...initial };
  return {
    getPreferences: () => ({
      ...store,
      instance: store.instance ?? PREFERENCES.DEFAULT_INSTANCE,
    }),
    setPreferences: (p) => { store = { ...store, ...p }; },
    clearPreferences: () => { store = {}; },
  };
}

describe.runIf(canRunIntegrationTests)('SpeleoDBController [integration]', () => {
  const instance = TEST_ENV.instanceUrl!;
  const email = TEST_ENV.email!;
  const password = TEST_ENV.password!;
  const oauthToken = TEST_ENV.oauthToken!;

  let controller: SpeleoDBController;
  let prefs: PreferencesPort;

  beforeEach(() => {
    const http = new HttpClient();
    const service = new SpeleoDBService(http);
    prefs = createMemoryPrefs();
    controller = new SpeleoDBController(service, prefs);
  });

  // ---- login ----------------------------------------------------------------

  describe('login', () => {
    it('authenticates with real credentials and sets auth state', async () => {
      const result = await controller.login({ email, password, instance });

      expect(result.success).toBe(true);
      expect(result.token).toBeTruthy();
      expect(result.user).toBeDefined();
      expect(result.user?.email).toBeTruthy();

      // Controller state is updated
      expect(controller.isAuthenticated()).toBe(true);
      expect(controller.isOnline).toBe(true);
      expect(controller.currentUser).not.toBeNull();

      // Preferences are persisted
      const saved = prefs.getPreferences();
      expect(saved.token).toBe(result.token);
      expect(saved.email).toBeTruthy();
      expect(saved.instance).toBe(instance);
    }, TEST_ENV.timeoutMs);

    it('rejects wrong password', async () => {
      const result = await controller.login({ email, password: 'wrong-password', instance });

      expect(result.success).toBe(false);
      expect(controller.isAuthenticated()).toBe(false);
    }, TEST_ENV.timeoutMs);
  });

  // ---- validateSession ------------------------------------------------------

  describe('validateSession', () => {
    it('returns "ok" when preferences hold a valid token', async () => {
      // Seed preferences with the known-good OAuth token from .env
      prefs.setPreferences({ token: oauthToken, instance, email });

      const http = new HttpClient();
      const service = new SpeleoDBService(http);
      const ctrl = new SpeleoDBController(service, prefs);

      const result = await ctrl.validateSession();

      expect(result).toBe('ok');
      expect(ctrl.isOnline).toBe(true);
    }, TEST_ENV.timeoutMs);

    it('returns "unauthorized" for an invalid token', async () => {
      prefs.setPreferences({ token: 'invalid-token', instance, email });

      const http = new HttpClient();
      const service = new SpeleoDBService(http);
      const ctrl = new SpeleoDBController(service, prefs);

      const result = await ctrl.validateSession();

      expect(result).toBe('unauthorized');
    }, TEST_ENV.timeoutMs);

    it('validates a token obtained from a fresh login()', async () => {
      const loginResult = await controller.login({ email, password, instance });
      expect(loginResult.success).toBe(true);

      // Build a new controller that will restore session from prefs
      const http = new HttpClient();
      const service = new SpeleoDBService(http);
      const freshCtrl = new SpeleoDBController(service, prefs);

      // freshCtrl restored the session from prefs — now validate it
      expect(freshCtrl.isAuthenticated()).toBe(true);
      const result = await freshCtrl.validateSession();
      expect(result).toBe('ok');
      expect(freshCtrl.isOnline).toBe(true);
    }, TEST_ENV.timeoutMs);
  });

  // ---- logout ---------------------------------------------------------------

  describe('logout after real login', () => {
    it('clears auth state after a real login', async () => {
      await controller.login({ email, password, instance });
      expect(controller.isAuthenticated()).toBe(true);

      controller.logout();

      expect(controller.isAuthenticated()).toBe(false);
      expect(controller.currentUser).toBeNull();
      expect(prefs.getPreferences().token).toBeUndefined();
    }, TEST_ENV.timeoutMs);
  });
});
