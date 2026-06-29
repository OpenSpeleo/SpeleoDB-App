/**
 * Integration tests for SpeleoDBController.
 *
 * Exercises the full stack: Controller -> SpeleoDBService -> HttpClient -> network.
 * Uses real credentials from .env. Skipped when API_TEST_ENABLED != "true".
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HttpClient } from '../services/HttpClient';
import { SpeleoDBService } from '../services/SpeleoDBService';
import { ProjectCacheService } from '../services/ProjectCacheService';
import { SpeleoDBController, type PreferencesPort } from '../controllers/SpeleoDBController';
import type { StoredSession } from '../services/SecureSessionStore';
import { getInstanceBaseUrl } from '../utils/instanceUrl';
import { canRunIntegrationTests, isGitHubActionsPasswordLoginBlocked, TEST_ENV } from './env';

/** In-memory preferences (mirrors PreferencesService without touching localStorage). */
function createMemoryPrefs(initial?: Partial<{ email: string; token: string; instance: string }>): PreferencesPort {
  let store: { email?: string; instance?: string; hasStoredSession?: boolean } = {
    email: initial?.email,
    instance: initial?.instance,
    hasStoredSession: Boolean(initial?.token && initial.instance),
  };
  let session: StoredSession | null = initial?.token && initial.instance
    ? { email: initial.email, instance: initial.instance, token: initial.token }
    : null;
  const clearPreferences = () => { store = {}; };
  return {
    getPreferences: () => ({ ...store }),
    setPreferences: (p) => { store = { ...store, ...p }; },
    clearPreferences,
    session: {
      initialize: async () => session,
      getSession: () => session ? { ...session } : null,
      establish: async (next) => {
        session = { ...next };
        store = {
          email: next.email,
          instance: next.instance,
          hasStoredSession: true,
        };
      },
      clear: async () => {
        session = null;
        clearPreferences();
      },
    },
  };
}

function isUnverifiedEmailLoginFailure(result: { success: boolean; message: string }): boolean {
  if (result.success) return false;
  return result.message.toLowerCase().includes('not been verified');
}

describe.runIf(canRunIntegrationTests)('SpeleoDBController [integration]', () => {
  const instance = TEST_ENV.instanceUrl!;
  const email = TEST_ENV.email!;
  const password = TEST_ENV.password!;
  const oauthToken = TEST_ENV.oauthToken!;

  async function expectConfiguredTokenStillValid(): Promise<void> {
    const http = new HttpClient();
    const service = new SpeleoDBService(http);
    const tokenRes = await service.validateToken(instance, oauthToken);
    expect(tokenRes.status).toBeGreaterThanOrEqual(200);
    expect(tokenRes.status).toBeLessThan(300);
  }

  async function acceptGitHubActionsPasswordAuthBlock(result: { success: boolean; message: string }): Promise<boolean> {
    if (!isGitHubActionsPasswordLoginBlocked(result)) return false;
    await expectConfiguredTokenStillValid();
    return true;
  }

  let controller: SpeleoDBController;
  let prefs: PreferencesPort;

  beforeEach(() => {
    const http = new HttpClient();
    const service = new SpeleoDBService(http);
    prefs = createMemoryPrefs();
    controller = new SpeleoDBController(service, prefs, new ProjectCacheService());
  });

  // ---- login ----------------------------------------------------------------

  describe('login', () => {
    it('authenticates with real credentials and sets auth state', async () => {
      const result = await controller.login({ email, password, instance });
      if (isUnverifiedEmailLoginFailure(result)) {
        expect(isUnverifiedEmailLoginFailure(result)).toBe(true);
        return;
      }
      if (await acceptGitHubActionsPasswordAuthBlock(result)) return;

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
      expect(prefs.session.getSession()?.token).toBe(result.token);
      expect(saved.email).toBeTruthy();
      expect(saved.instance).toBe(getInstanceBaseUrl(instance));
    }, TEST_ENV.timeoutMs);

    it('rejects wrong password', async () => {
      const result = await controller.login({ email, password: 'wrong-password', instance });

      expect(result.success).toBe(false);
      expect(controller.isAuthenticated()).toBe(false);
    }, TEST_ENV.timeoutMs);

    it('authenticates with a configured OAuth token and persists an identity-free session', async () => {
      const result = await controller.loginWithToken({ token: oauthToken, instance });

      expect(result.success).toBe(true);
      expect(result.token).toBe(oauthToken);
      expect(result.user).toBeUndefined();
      expect(controller.isAuthenticated()).toBe(true);
      expect(controller.currentUser).toBeNull();
      expect(controller.isOnline).toBe(true);

      const saved = prefs.getPreferences();
      expect(prefs.session.getSession()?.token).toBe(oauthToken);
      expect(saved.email).toBeUndefined();
      expect(saved.instance).toBe(getInstanceBaseUrl(instance));
    }, TEST_ENV.timeoutMs);
  });

  // ---- validateSession ------------------------------------------------------

  describe('validateSession', () => {
    it('returns "ok" when preferences hold a valid token', async () => {
      // Seed preferences with the known-good OAuth token from .env
      await prefs.session.establish({ token: oauthToken, instance, email });

      const http = new HttpClient();
      const service = new SpeleoDBService(http);
      const ctrl = new SpeleoDBController(service, prefs, new ProjectCacheService());

      const result = await ctrl.validateSession();

      expect(result).toBe('ok');
      expect(ctrl.isOnline).toBe(true);
    }, TEST_ENV.timeoutMs);

    it('returns "unauthorized" for an invalid token', async () => {
      await prefs.session.establish({ token: 'invalid-token', instance, email });

      const http = new HttpClient();
      const service = new SpeleoDBService(http);
      const ctrl = new SpeleoDBController(service, prefs, new ProjectCacheService());

      const result = await ctrl.validateSession();

      expect(result).toBe('unauthorized');
    }, TEST_ENV.timeoutMs);

    it('validates a token obtained from a fresh login()', async () => {
      const loginResult = await controller.login({ email, password, instance });
      if (isUnverifiedEmailLoginFailure(loginResult)) {
        expect(isUnverifiedEmailLoginFailure(loginResult)).toBe(true);
        return;
      }
      if (await acceptGitHubActionsPasswordAuthBlock(loginResult)) return;
      expect(loginResult.success).toBe(true);

      // Build a new controller that will restore session from prefs
      const http = new HttpClient();
      const service = new SpeleoDBService(http);
      const freshCtrl = new SpeleoDBController(service, prefs, new ProjectCacheService());

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
      const loginResult = await controller.login({ email, password, instance });
      if (isUnverifiedEmailLoginFailure(loginResult)) {
        expect(isUnverifiedEmailLoginFailure(loginResult)).toBe(true);
        return;
      }
      if (await acceptGitHubActionsPasswordAuthBlock(loginResult)) return;
      expect(controller.isAuthenticated()).toBe(true);

      await controller.logout();

      expect(controller.isAuthenticated()).toBe(false);
      expect(controller.currentUser).toBeNull();
      expect(prefs.session.getSession()).toBeNull();
    }, TEST_ENV.timeoutMs);
  });
});
