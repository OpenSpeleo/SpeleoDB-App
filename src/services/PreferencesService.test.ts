import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPreferences,
  setPreferences,
  clearPreferences,
  getProjectVisibilityPreferences,
  setProjectVisibilityPreference,
  setProjectVisibilityPreferences,
  getHasCompletedGuidedTour,
  setHasCompletedGuidedTour,
  type UserPreferences,
} from './PreferencesService';
import { PREFERENCES } from '../constants';

describe('PreferencesService', () => {
  beforeEach(() => {
    clearPreferences();
  });

  describe('getPreferences', () => {
    it('returns default instance when storage is empty', () => {
      const prefs = getPreferences();
      expect(prefs.instance).toBe(PREFERENCES.DEFAULT_INSTANCE);
      expect(prefs.email).toBeUndefined();
      expect(prefs.token).toBeUndefined();
      expect(prefs.hasCompletedGuidedTour).toBeUndefined();
    });

    it('applies default instance when stored object has no instance', () => {
      localStorage.setItem(
        PREFERENCES.STORAGE_KEY,
        JSON.stringify({ email: 'a@b.com', token: 't1' })
      );
      const prefs = getPreferences();
      expect(prefs.instance).toBe(PREFERENCES.DEFAULT_INSTANCE);
      expect(prefs.email).toBe('a@b.com');
      expect(prefs.token).toBe('t1');
    });

    it('returns stored instance when present', () => {
      setPreferences({ instance: 'https://custom.example.com' });
      const prefs = getPreferences();
      expect(prefs.instance).toBe('https://custom.example.com');
    });
  });

  describe('setPreferences', () => {
    it('round-trips email, token, instance', () => {
      const data: UserPreferences = {
        email: 'user@example.com',
        token: 'secret-token',
        instance: 'https://www.speleodb.org',
      };
      setPreferences(data);
      const prefs = getPreferences();
      expect(prefs.email).toBe(data.email);
      expect(prefs.token).toBe(data.token);
      expect(prefs.instance).toBe(data.instance);
    });

    it('merges partial updates', () => {
      setPreferences({ email: 'first@x.com', instance: 'https://first.org' });
      setPreferences({ token: 'new-token' });
      const prefs = getPreferences();
      expect(prefs.email).toBe('first@x.com');
      expect(prefs.instance).toBe('https://first.org');
      expect(prefs.token).toBe('new-token');
    });

    it('keeps projectVisibility across unrelated partial updates', () => {
      setProjectVisibilityPreference('p1', false);
      setPreferences({ token: 'tok' });
      const prefs = getPreferences();
      expect(prefs.token).toBe('tok');
      expect(prefs.projectVisibility).toEqual({ p1: false });
    });

    it('keeps guided tour completion across unrelated partial updates', () => {
      setHasCompletedGuidedTour(true);
      setPreferences({ token: 'tok' });
      const prefs = getPreferences();
      expect(prefs.token).toBe('tok');
      expect(prefs.hasCompletedGuidedTour).toBe(true);
    });
  });

  describe('project visibility preferences', () => {
    it('returns empty map when missing', () => {
      expect(getProjectVisibilityPreferences()).toEqual({});
    });

    it('stores and reads single project visibility', () => {
      setProjectVisibilityPreference('11111111-1111-1111-1111-111111111111', false);
      expect(getProjectVisibilityPreferences()).toEqual({
        '11111111-1111-1111-1111-111111111111': false,
      });
    });

    it('bulk updates merge and preserve other preferences', () => {
      setPreferences({
        email: 'user@example.com',
        instance: 'https://example.org',
      });
      setProjectVisibilityPreferences({
        p1: true,
        p2: false,
      });
      setProjectVisibilityPreference('p3', true);

      const prefs = getPreferences();
      expect(prefs.email).toBe('user@example.com');
      expect(prefs.instance).toBe('https://example.org');
      expect(prefs.projectVisibility).toEqual({
        p1: true,
        p2: false,
        p3: true,
      });
    });

    it('handles rapid sequential updates without dropping entries', async () => {
      const ids = ['p1', 'p2', 'p3', 'p4', 'p5'];
      await Promise.all(
        ids.map((id, index) =>
          Promise.resolve().then(() => {
            setProjectVisibilityPreference(id, index % 2 === 0);
          }),
        ),
      );

      expect(getProjectVisibilityPreferences()).toEqual({
        p1: true,
        p2: false,
        p3: true,
        p4: false,
        p5: true,
      });
    });
  });

  describe('clearPreferences', () => {
    it('wipes storage so getPreferences returns defaults', () => {
      setPreferences({ email: 'x@y.com', token: 't', instance: 'https://x.org' });
      clearPreferences();
      const prefs = getPreferences();
      expect(prefs.email).toBeUndefined();
      expect(prefs.token).toBeUndefined();
      expect(prefs.instance).toBe(PREFERENCES.DEFAULT_INSTANCE);
      expect(getHasCompletedGuidedTour()).toBe(false);
    });
  });

  describe('guided tour completion preferences', () => {
    it('defaults to false when missing', () => {
      expect(getHasCompletedGuidedTour()).toBe(false);
    });

    it('stores and reads true', () => {
      setHasCompletedGuidedTour(true);
      expect(getHasCompletedGuidedTour()).toBe(true);
    });

    it('stores and reads false', () => {
      setHasCompletedGuidedTour(true);
      setHasCompletedGuidedTour(false);
      expect(getHasCompletedGuidedTour()).toBe(false);
    });

    it('ignores non-boolean values from storage', () => {
      localStorage.setItem(
        PREFERENCES.STORAGE_KEY,
        JSON.stringify({ hasCompletedGuidedTour: 'yes' }),
      );
      expect(getHasCompletedGuidedTour()).toBe(false);
    });

    it('survives rapid sequential updates', async () => {
      await Promise.all([
        Promise.resolve().then(() => setHasCompletedGuidedTour(true)),
        Promise.resolve().then(() => setProjectVisibilityPreference('p1', true)),
        Promise.resolve().then(() => setPreferences({ email: 'user@example.com' })),
      ]);

      const prefs = getPreferences();
      expect(prefs.email).toBe('user@example.com');
      expect(prefs.projectVisibility).toEqual({ p1: true });
      expect(getHasCompletedGuidedTour()).toBe(true);
    });
  });
});
