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
  getShowLandmarks,
  setShowLandmarks,
  getColorMode,
  setColorMode,
  getMeasurementUnit,
  setMeasurementUnit,
  type UserPreferences,
} from './PreferencesService';
import { PREFERENCES } from '../constants';

describe('PreferencesService', () => {
  const VALID_INSTANCE = 'https://example.org';

  function seedValidAuth(): void {
    setPreferences({
      email: 'auth-user@example.com',
      token: 'auth-token',
      instance: VALID_INSTANCE,
    });
  }

  beforeEach(() => {
    clearPreferences();
  });

  describe('getPreferences', () => {
    it('returns no instance when storage is empty', () => {
      const prefs = getPreferences();
      expect(prefs.instance).toBeUndefined();
      expect(prefs.email).toBeUndefined();
      expect(prefs.token).toBeUndefined();
      expect(prefs.hasCompletedGuidedTour).toBeUndefined();
    });

    it('keeps instance undefined when stored object has no auth token', () => {
      localStorage.setItem(
        PREFERENCES.STORAGE_KEY,
        JSON.stringify({ email: 'a@b.com' })
      );
      const prefs = getPreferences();
      expect(prefs.instance).toBeUndefined();
      expect(prefs.email).toBeUndefined();
      expect(prefs.token).toBeUndefined();
    });

    it('returns stored instance when present', () => {
      setPreferences({ token: 'tok', instance: 'https://custom.example.com' });
      const prefs = getPreferences();
      expect(prefs.instance).toBe('https://custom.example.com');
    });

    it('clears invalid auth preferences when instance is missing', () => {
      localStorage.setItem(
        PREFERENCES.STORAGE_KEY,
        JSON.stringify({ email: 'a@b.com', token: 'tok' })
      );

      const prefs = getPreferences();
      expect(prefs.instance).toBeUndefined();
      expect(prefs.email).toBeUndefined();
      expect(prefs.token).toBeUndefined();
      expect(localStorage.getItem(PREFERENCES.STORAGE_KEY)).toBeNull();
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
      setPreferences({ email: 'first@x.com', token: 'old-token', instance: 'https://first.org' });
      setPreferences({ token: 'new-token' });
      const prefs = getPreferences();
      expect(prefs.email).toBe('first@x.com');
      expect(prefs.instance).toBe('https://first.org');
      expect(prefs.token).toBe('new-token');
    });

    it('keeps projectVisibility across unrelated partial updates', () => {
      seedValidAuth();
      setProjectVisibilityPreference('p1', false);
      setPreferences({ token: 'tok', instance: 'https://example.org' });
      const prefs = getPreferences();
      expect(prefs.token).toBe('tok');
      expect(prefs.projectVisibility).toEqual({ p1: false });
    });

    it('keeps guided tour completion across unrelated partial updates', () => {
      seedValidAuth();
      setHasCompletedGuidedTour(true);
      setPreferences({ token: 'tok', instance: 'https://example.org' });
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
      seedValidAuth();
      setProjectVisibilityPreference('11111111-1111-1111-1111-111111111111', false);
      expect(getProjectVisibilityPreferences()).toEqual({
        '11111111-1111-1111-1111-111111111111': false,
      });
    });

    it('bulk updates merge and preserve other preferences', () => {
      setPreferences({
        email: 'user@example.com',
        token: 'tok',
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
      seedValidAuth();
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
    it('wipes storage so getPreferences has no auth instance', () => {
      setPreferences({ email: 'x@y.com', token: 't', instance: 'https://x.org' });
      clearPreferences();
      const prefs = getPreferences();
      expect(prefs.email).toBeUndefined();
      expect(prefs.token).toBeUndefined();
      expect(prefs.instance).toBeUndefined();
      expect(getHasCompletedGuidedTour()).toBe(false);
      expect(getShowLandmarks()).toBe(true);
      expect(getColorMode()).toBe('project');
      expect(getMeasurementUnit()).toBe('meters');
    });
  });

  describe('guided tour completion preferences', () => {
    it('defaults to false when missing', () => {
      expect(getHasCompletedGuidedTour()).toBe(false);
    });

    it('stores and reads true', () => {
      seedValidAuth();
      setHasCompletedGuidedTour(true);
      expect(getHasCompletedGuidedTour()).toBe(true);
    });

    it('stores and reads false', () => {
      seedValidAuth();
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
      seedValidAuth();
      await Promise.all([
        Promise.resolve().then(() => setHasCompletedGuidedTour(true)),
        Promise.resolve().then(() => setProjectVisibilityPreference('p1', true)),
        Promise.resolve().then(() => setPreferences({ email: 'user@example.com', token: 'auth-token', instance: VALID_INSTANCE })),
      ]);

      const prefs = getPreferences();
      expect(prefs.email).toBe('user@example.com');
      expect(prefs.projectVisibility).toEqual({ p1: true });
      expect(getHasCompletedGuidedTour()).toBe(true);
    });
  });

  describe('show landmarks preferences', () => {
    it('defaults to true when missing', () => {
      expect(getShowLandmarks()).toBe(true);
    });

    it('stores and reads false', () => {
      seedValidAuth();
      setShowLandmarks(false);
      expect(getShowLandmarks()).toBe(false);
    });

    it('stores and reads true', () => {
      seedValidAuth();
      setShowLandmarks(false);
      setShowLandmarks(true);
      expect(getShowLandmarks()).toBe(true);
    });

    it('ignores non-boolean values from storage', () => {
      localStorage.setItem(
        PREFERENCES.STORAGE_KEY,
        JSON.stringify({ showLandmarks: 'yes' }),
      );
      expect(getShowLandmarks()).toBe(true);
    });

    it('preserves value across unrelated partial updates', () => {
      seedValidAuth();
      setShowLandmarks(false);
      setPreferences({ token: 'tok', instance: 'https://example.org' });
      const prefs = getPreferences();
      expect(prefs.token).toBe('tok');
      expect(getShowLandmarks()).toBe(false);
    });

    it('survives rapid sequential updates with other preferences', async () => {
      seedValidAuth();
      await Promise.all([
        Promise.resolve().then(() => setShowLandmarks(false)),
        Promise.resolve().then(() => setProjectVisibilityPreference('p1', true)),
        Promise.resolve().then(() => setPreferences({ email: 'user@example.com', token: 'auth-token', instance: VALID_INSTANCE })),
      ]);

      const prefs = getPreferences();
      expect(prefs.email).toBe('user@example.com');
      expect(prefs.projectVisibility).toEqual({ p1: true });
      expect(getShowLandmarks()).toBe(false);
    });
  });

  describe('color mode preferences', () => {
    it('defaults to project when missing', () => {
      expect(getColorMode()).toBe('project');
    });

    it('stores and reads depth', () => {
      seedValidAuth();
      setColorMode('depth');
      expect(getColorMode()).toBe('depth');
    });

    it('stores and reads project', () => {
      seedValidAuth();
      setColorMode('depth');
      setColorMode('project');
      expect(getColorMode()).toBe('project');
    });

    it('ignores invalid storage values', () => {
      localStorage.setItem(
        PREFERENCES.STORAGE_KEY,
        JSON.stringify({ colorMode: 'invalid' }),
      );
      expect(getColorMode()).toBe('project');
    });

    it('preserves value across unrelated updates', () => {
      seedValidAuth();
      setColorMode('depth');
      setPreferences({ token: 'tok', instance: 'https://example.org' });
      expect(getColorMode()).toBe('depth');
    });
  });

  describe('measurement unit preferences', () => {
    it('defaults to meters when missing', () => {
      expect(getMeasurementUnit()).toBe('meters');
    });

    it('stores and reads meters', () => {
      seedValidAuth();
      setMeasurementUnit('meters');
      expect(getMeasurementUnit()).toBe('meters');
    });

    it('stores and reads feet', () => {
      seedValidAuth();
      setMeasurementUnit('meters');
      setMeasurementUnit('feet');
      expect(getMeasurementUnit()).toBe('feet');
    });

    it('ignores invalid storage values', () => {
      localStorage.setItem(
        PREFERENCES.STORAGE_KEY,
        JSON.stringify({ measurementUnit: 'invalid' }),
      );
      expect(getMeasurementUnit()).toBe('meters');
    });

    it('preserves value across unrelated updates', () => {
      seedValidAuth();
      setMeasurementUnit('meters');
      setPreferences({ token: 'tok', instance: 'https://example.org' });
      expect(getMeasurementUnit()).toBe('meters');
    });
  });
});
