import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPreferences,
  setPreferences,
  clearPreferences,
  getProjectVisibilityPreferences,
  setProjectVisibilityPreference,
  setProjectVisibilityPreferences,
  getCountryVisibilityPreferences,
  setCountryVisibilityPreference,
  setCountryVisibilityPreferences,
  getCountryCollapsedPreferences,
  setCountryCollapsedPreference,
  getLandmarkCollectionVisibilityPreferences,
  setLandmarkCollectionVisibilityPreference,
  setLandmarkCollectionVisibilityPreferences,
  getLandmarkCollectionCollapsedPreferences,
  setLandmarkCollectionCollapsedPreference,
  getGpsTrackVisibilityPreferences,
  setGpsTrackVisibilityPreference,
  getHasCompletedGuidedTour,
  setHasCompletedGuidedTour,
  getShowLandmarks,
  setShowLandmarks,
  getTileCacheOverLimitApproved,
  setTileCacheOverLimitApproved,
  getTileCacheOverLimitPromptAcknowledged,
  setTileCacheOverLimitPromptAcknowledged,
  getColorMode,
  setColorMode,
  getMeasurementUnit,
  setMeasurementUnit,
  getSelectedMapLayerId,
  setSelectedMapLayerId,
  getLayerOfflineSyncPreferences,
  isLayerOfflineSyncEnabled,
  setLayerOfflineSyncPreference,
  sessionMetadataStore,
  removeLegacyPlaintextCredentials,
  type UserPreferences,
} from './PreferencesService';
import { DEFAULT_MAP_LAYER_ID, PREFERENCES } from '../constants';

describe('PreferencesService', () => {
  const VALID_INSTANCE = 'https://example.org';

  function seedValidAuth(): void {
    sessionMetadataStore.commit({
      email: 'auth-user@example.com',
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
      expect(prefs.hasStoredSession).toBeUndefined();
      expect(prefs.hasCompletedGuidedTour).toBeUndefined();
    });

    it('preserves non-secret preferences without inventing a session', () => {
      localStorage.setItem(
        PREFERENCES.STORAGE_KEY,
        JSON.stringify({ email: 'a@b.com' })
      );
      const prefs = getPreferences();
      expect(prefs.instance).toBeUndefined();
      expect(prefs.email).toBe('a@b.com');
      expect(prefs.hasStoredSession).toBeUndefined();
    });

    it('returns stored instance when present', () => {
      setPreferences({ instance: 'https://custom.example.com' });
      const prefs = getPreferences();
      expect(prefs.instance).toBe('https://custom.example.com');
    });

    it('scrubs invalid auth metadata without erasing unrelated preferences', () => {
      localStorage.setItem(
        PREFERENCES.STORAGE_KEY,
        JSON.stringify({
          email: 'a@b.com',
          projectVisibility: { retained: false },
          token: 'tok',
        })
      );

      const prefs = getPreferences();
      expect(prefs.instance).toBeUndefined();
      expect(prefs.email).toBeUndefined();
      expect(prefs.projectVisibility).toEqual({ retained: false });
      expect(localStorage.getItem(PREFERENCES.STORAGE_KEY)).not.toContain('tok');
    });
  });

  describe('setPreferences', () => {
    it('round-trips only non-secret session metadata', () => {
      const data: UserPreferences = {
        email: 'user@example.com',
        instance: 'https://www.speleodb.org',
        hasStoredSession: true,
      };
      setPreferences(data);
      const prefs = getPreferences();
      expect(prefs.email).toBe(data.email);
      expect(prefs.instance).toBe(data.instance);
      expect(prefs.hasStoredSession).toBe(true);
      expect(localStorage.getItem(PREFERENCES.STORAGE_KEY)).not.toContain('secret-token');
    });

    it('merges partial updates', () => {
      setPreferences({ email: 'first@x.com', instance: 'https://first.org' });
      setPreferences({ email: 'second@x.com' });
      const prefs = getPreferences();
      expect(prefs.email).toBe('second@x.com');
      expect(prefs.instance).toBe('https://first.org');
    });

    it('keeps projectVisibility across unrelated partial updates', () => {
      seedValidAuth();
      setProjectVisibilityPreference('p1', false);
      setPreferences({ instance: 'https://example.org' });
      const prefs = getPreferences();
      expect(prefs.projectVisibility).toEqual({ p1: false });
    });

    it('keeps guided tour completion across unrelated partial updates', () => {
      seedValidAuth();
      setHasCompletedGuidedTour(true);
      setPreferences({ instance: 'https://example.org' });
      const prefs = getPreferences();
      expect(prefs.hasCompletedGuidedTour).toBe(true);
    });
  });

  describe('session metadata migration adapter', () => {
    it('exposes a legacy token only to the migration boundary', () => {
      localStorage.setItem(PREFERENCES.STORAGE_KEY, JSON.stringify({
        email: 'legacy@example.com',
        instance: VALID_INSTANCE,
        token: 'legacy-secret',
      }));

      expect(sessionMetadataStore.read()).toEqual({
        email: 'legacy@example.com',
        hasStoredSession: false,
        instance: VALID_INSTANCE,
        legacyToken: 'legacy-secret',
      });
      expect(getPreferences()).not.toHaveProperty('token');
    });

    it('atomically replaces a legacy token with non-secret session metadata', () => {
      localStorage.setItem(PREFERENCES.STORAGE_KEY, JSON.stringify({
        instance: VALID_INSTANCE,
        projectVisibility: { p1: false },
        token: 'legacy-secret',
      }));

      sessionMetadataStore.commit({ email: 'new@example.com', instance: VALID_INSTANCE });

      const raw = JSON.parse(localStorage.getItem(PREFERENCES.STORAGE_KEY) ?? '{}');
      expect(raw).not.toHaveProperty('token');
      expect(raw).toMatchObject({
        email: 'new@example.com',
        hasStoredSession: true,
        instance: VALID_INSTANCE,
        projectVisibility: { p1: false },
      });
    });

    it('strictly clears session metadata without erasing unrelated preferences', () => {
      seedValidAuth();
      setProjectVisibilityPreference('retained', false);

      sessionMetadataStore.clear();

      expect(sessionMetadataStore.read()).toMatchObject({
        email: undefined,
        hasStoredSession: false,
        legacyToken: undefined,
      });
      expect(getProjectVisibilityPreferences()).toEqual({ retained: false });
    });
  });

  describe('legacy credential cleanup', () => {
    it('deletes the plaintext password database without touching unrelated storage', () => {
      localStorage.setItem('speleo_users_db', JSON.stringify({
        'legacy@example.com': { password: 'plaintext' },
      }));
      localStorage.setItem('unrelated', 'retained');

      removeLegacyPlaintextCredentials();

      expect(localStorage.getItem('speleo_users_db')).toBeNull();
      expect(localStorage.getItem('unrelated')).toBe('retained');
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
        instance: 'https://example.org',
        hasStoredSession: true,
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
      setPreferences({ email: 'x@y.com', instance: 'https://x.org' });
      setCountryVisibilityPreference('FR', false);
      setCountryCollapsedPreference('FR', true);
      clearPreferences();
      const prefs = getPreferences();
      expect(prefs.email).toBeUndefined();
      expect(prefs.instance).toBeUndefined();
      expect(getHasCompletedGuidedTour()).toBe(false);
      expect(getShowLandmarks()).toBe(true);
      expect(getColorMode()).toBe('project');
      expect(getMeasurementUnit()).toBe('meters');
      expect(getCountryVisibilityPreferences()).toEqual({});
      expect(getCountryCollapsedPreferences()).toEqual({});
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
        Promise.resolve().then(() => setPreferences({ email: 'user@example.com', instance: VALID_INSTANCE })),
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
      setPreferences({ instance: 'https://example.org' });
      expect(getShowLandmarks()).toBe(false);
    });

    it('survives rapid sequential updates with other preferences', async () => {
      seedValidAuth();
      await Promise.all([
        Promise.resolve().then(() => setShowLandmarks(false)),
        Promise.resolve().then(() => setProjectVisibilityPreference('p1', true)),
        Promise.resolve().then(() => setPreferences({ email: 'user@example.com', instance: VALID_INSTANCE })),
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
      setPreferences({ instance: 'https://example.org' });
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
      setPreferences({ instance: 'https://example.org' });
      expect(getMeasurementUnit()).toBe('meters');
    });
  });

  describe('country visibility preferences', () => {
    it('returns empty map when missing', () => {
      expect(getCountryVisibilityPreferences()).toEqual({});
    });

    it('persists single country visibility', () => {
      seedValidAuth();
      setCountryVisibilityPreference('FR', false);
      expect(getCountryVisibilityPreferences()).toEqual({ FR: false });
    });

    it('ignores empty country code', () => {
      seedValidAuth();
      setCountryVisibilityPreference('', false);
      expect(getCountryVisibilityPreferences()).toEqual({});
    });

    it('bulk update merges and preserves other preferences', () => {
      setPreferences({
        email: 'u@example.com',
        instance: 'https://example.org',
        hasStoredSession: true,
      });
      setCountryVisibilityPreferences({ FR: false, US: true });
      setCountryVisibilityPreference('CA', false);

      expect(getCountryVisibilityPreferences()).toEqual({
        FR: false,
        US: true,
        CA: false,
      });
      expect(getPreferences().email).toBe('u@example.com');
    });

    it('survives interleaved rapid writes (queue invariant)', async () => {
      seedValidAuth();
      await Promise.all([
        Promise.resolve().then(() => setCountryVisibilityPreference('FR', false)),
        Promise.resolve().then(() => setProjectVisibilityPreference('p1', true)),
        Promise.resolve().then(() =>
          setCountryVisibilityPreferences({ US: true, CA: false }),
        ),
      ]);

      expect(getCountryVisibilityPreferences()).toEqual({
        FR: false,
        US: true,
        CA: false,
      });
      expect(getProjectVisibilityPreferences()).toEqual({ p1: true });
    });

    it('drops non-boolean entries when reading from storage', () => {
      seedValidAuth();
      const stored = JSON.parse(
        localStorage.getItem(PREFERENCES.STORAGE_KEY) ?? '{}',
      );
      stored.countryVisibility = { FR: false, US: 'maybe', CA: 1, '': true };
      localStorage.setItem(PREFERENCES.STORAGE_KEY, JSON.stringify(stored));

      expect(getCountryVisibilityPreferences()).toEqual({ FR: false });
    });

    it('preserves country visibility across unrelated partial updates', () => {
      seedValidAuth();
      setCountryVisibilityPreference('FR', false);
      setPreferences({ instance: 'https://example.org' });
      expect(getCountryVisibilityPreferences()).toEqual({ FR: false });
    });
  });

  describe('country collapsed preferences', () => {
    it('returns empty map when missing', () => {
      expect(getCountryCollapsedPreferences()).toEqual({});
    });

    it('persists single country collapse state', () => {
      seedValidAuth();
      setCountryCollapsedPreference('FR', true);
      expect(getCountryCollapsedPreferences()).toEqual({ FR: true });
    });

    it('ignores empty country code', () => {
      seedValidAuth();
      setCountryCollapsedPreference('', true);
      expect(getCountryCollapsedPreferences()).toEqual({});
    });

    it('merges multiple sequential updates and preserves other preferences', () => {
      setPreferences({
        email: 'u@example.com',
        instance: 'https://example.org',
        hasStoredSession: true,
      });
      setCountryCollapsedPreference('FR', true);
      setCountryCollapsedPreference('US', false);

      expect(getCountryCollapsedPreferences()).toEqual({ FR: true, US: false });
      expect(getPreferences().email).toBe('u@example.com');
    });

    it('survives interleaved rapid writes (queue invariant)', async () => {
      seedValidAuth();
      await Promise.all([
        Promise.resolve().then(() => setCountryCollapsedPreference('FR', true)),
        Promise.resolve().then(() => setCountryVisibilityPreference('FR', false)),
        Promise.resolve().then(() => setCountryCollapsedPreference('US', true)),
      ]);

      expect(getCountryCollapsedPreferences()).toEqual({ FR: true, US: true });
      expect(getCountryVisibilityPreferences()).toEqual({ FR: false });
    });

    it('preserves country collapse across unrelated partial updates', () => {
      seedValidAuth();
      setCountryCollapsedPreference('FR', true);
      setPreferences({ instance: 'https://example.org' });
      expect(getCountryCollapsedPreferences()).toEqual({ FR: true });
    });
  });

  describe('landmark collection visibility preferences', () => {
    it('returns empty map when missing (default-visible semantics)', () => {
      expect(getLandmarkCollectionVisibilityPreferences()).toEqual({});
    });

    it('persists single collection visibility', () => {
      seedValidAuth();
      setLandmarkCollectionVisibilityPreference('col-1', false);
      expect(getLandmarkCollectionVisibilityPreferences()).toEqual({ 'col-1': false });
    });

    it('ignores empty collection id', () => {
      seedValidAuth();
      setLandmarkCollectionVisibilityPreference('', false);
      expect(getLandmarkCollectionVisibilityPreferences()).toEqual({});
    });

    it('persists multiple collections at once (bulk show/hide all)', () => {
      seedValidAuth();
      setLandmarkCollectionVisibilityPreferences({ 'col-1': false, 'col-2': true });
      expect(getLandmarkCollectionVisibilityPreferences()).toEqual({
        'col-1': false,
        'col-2': true,
      });
    });

    it('drops non-boolean values when persisting in bulk', () => {
      seedValidAuth();
      setLandmarkCollectionVisibilityPreferences({
        'col-1': false,
        'col-2': 'nope' as unknown as boolean,
      });
      expect(getLandmarkCollectionVisibilityPreferences()).toEqual({ 'col-1': false });
    });

    it('preserves collection visibility across unrelated partial updates', () => {
      seedValidAuth();
      setLandmarkCollectionVisibilityPreference('col-1', false);
      setPreferences({ instance: 'https://example.org' });
      expect(getLandmarkCollectionVisibilityPreferences()).toEqual({ 'col-1': false });
    });

    it('GPS track visibility defaults to empty (hidden = missing key)', () => {
      expect(getGpsTrackVisibilityPreferences()).toEqual({});
    });

    it('persists GPS track visibility per id', () => {
      seedValidAuth();
      setGpsTrackVisibilityPreference('g1', true);
      expect(getGpsTrackVisibilityPreferences()).toEqual({ g1: true });
      setGpsTrackVisibilityPreference('g1', false);
      expect(getGpsTrackVisibilityPreferences()).toEqual({ g1: false });
    });

    it('ignores an empty GPS track id and survives unrelated updates', () => {
      seedValidAuth();
      setGpsTrackVisibilityPreference('', true);
      expect(getGpsTrackVisibilityPreferences()).toEqual({});
      setGpsTrackVisibilityPreference('g2', true);
      setPreferences({ instance: 'https://example.org' });
      expect(getGpsTrackVisibilityPreferences()).toEqual({ g2: true });
    });
  });

  describe('landmark collection collapsed preferences', () => {
    it('returns empty map when missing', () => {
      expect(getLandmarkCollectionCollapsedPreferences()).toEqual({});
    });

    it('persists single collection collapse state', () => {
      seedValidAuth();
      setLandmarkCollectionCollapsedPreference('col-1', true);
      expect(getLandmarkCollectionCollapsedPreferences()).toEqual({ 'col-1': true });
    });

    it('ignores empty collection id', () => {
      seedValidAuth();
      setLandmarkCollectionCollapsedPreference('', true);
      expect(getLandmarkCollectionCollapsedPreferences()).toEqual({});
    });
  });

  describe('lastSyncedAt preferences', () => {
    it('is undefined when missing', () => {
      seedValidAuth();
      expect(getPreferences().lastSyncedAt).toBeUndefined();
    });

    it('round-trips a finite positive epoch', () => {
      setPreferences({
        email: 'u@example.com',
        instance: VALID_INSTANCE,
        lastSyncedAt: 1_710_000_000_000,
      });
      expect(getPreferences().lastSyncedAt).toBe(1_710_000_000_000);
    });

    it('drops non-numeric values from storage', () => {
      seedValidAuth();
      const stored = JSON.parse(
        localStorage.getItem(PREFERENCES.STORAGE_KEY) ?? '{}',
      );
      stored.lastSyncedAt = 'yesterday';
      localStorage.setItem(PREFERENCES.STORAGE_KEY, JSON.stringify(stored));

      expect(getPreferences().lastSyncedAt).toBeUndefined();
    });

    it('drops non-finite or non-positive values from storage', () => {
      seedValidAuth();
      const stored = JSON.parse(
        localStorage.getItem(PREFERENCES.STORAGE_KEY) ?? '{}',
      );
      stored.lastSyncedAt = -1;
      localStorage.setItem(PREFERENCES.STORAGE_KEY, JSON.stringify(stored));
      expect(getPreferences().lastSyncedAt).toBeUndefined();

      stored.lastSyncedAt = 0;
      localStorage.setItem(PREFERENCES.STORAGE_KEY, JSON.stringify(stored));
      expect(getPreferences().lastSyncedAt).toBeUndefined();

      stored.lastSyncedAt = Number.POSITIVE_INFINITY;
      localStorage.setItem(PREFERENCES.STORAGE_KEY, JSON.stringify(stored));
      expect(getPreferences().lastSyncedAt).toBeUndefined();
    });

    it('preserves lastSyncedAt across unrelated partial updates', () => {
      setPreferences({
        email: 'u@example.com',
        instance: VALID_INSTANCE,
        lastSyncedAt: 1_710_000_000_000,
      });
      setPreferences({ instance: VALID_INSTANCE });
      expect(getPreferences().lastSyncedAt).toBe(1_710_000_000_000);
    });

    it('clearPreferences wipes lastSyncedAt', () => {
      setPreferences({
        email: 'u@example.com',
        instance: VALID_INSTANCE,
        lastSyncedAt: 1_710_000_000_000,
      });
      clearPreferences();
      expect(getPreferences().lastSyncedAt).toBeUndefined();
    });
  });

  describe('tile-cache overflow consent preferences', () => {
    it('defaults both flags to false when missing', () => {
      seedValidAuth();
      expect(getTileCacheOverLimitApproved()).toBe(false);
      expect(getTileCacheOverLimitPromptAcknowledged()).toBe(false);
    });

    it('round-trips the approved flag', () => {
      seedValidAuth();
      setTileCacheOverLimitApproved(true);
      expect(getTileCacheOverLimitApproved()).toBe(true);
      setTileCacheOverLimitApproved(false);
      expect(getTileCacheOverLimitApproved()).toBe(false);
    });

    it('round-trips the acknowledged flag', () => {
      seedValidAuth();
      setTileCacheOverLimitPromptAcknowledged(true);
      expect(getTileCacheOverLimitPromptAcknowledged()).toBe(true);
    });

    it('updating one flag does not clobber the other', () => {
      seedValidAuth();
      setTileCacheOverLimitPromptAcknowledged(true);
      setTileCacheOverLimitApproved(true);
      expect(getTileCacheOverLimitPromptAcknowledged()).toBe(true);
      expect(getTileCacheOverLimitApproved()).toBe(true);

      setTileCacheOverLimitApproved(false);
      expect(getTileCacheOverLimitApproved()).toBe(false);
      // Acknowledged survives an approval toggle (revoke keeps it set).
      expect(getTileCacheOverLimitPromptAcknowledged()).toBe(true);
    });

    it('drops non-boolean stored values', () => {
      seedValidAuth();
      const stored = JSON.parse(localStorage.getItem(PREFERENCES.STORAGE_KEY) ?? '{}');
      stored.tileCacheOverLimitApproved = 'yes';
      stored.tileCacheOverLimitPromptAcknowledged = 1;
      localStorage.setItem(PREFERENCES.STORAGE_KEY, JSON.stringify(stored));

      expect(getTileCacheOverLimitApproved()).toBe(false);
      expect(getTileCacheOverLimitPromptAcknowledged()).toBe(false);
    });

    it('clearPreferences wipes both flags', () => {
      seedValidAuth();
      setTileCacheOverLimitApproved(true);
      setTileCacheOverLimitPromptAcknowledged(true);
      clearPreferences();
      expect(getTileCacheOverLimitApproved()).toBe(false);
      expect(getTileCacheOverLimitPromptAcknowledged()).toBe(false);
    });
  });

  describe('map tile layer preferences', () => {
    it('defaults the selected layer to satellite', () => {
      expect(getSelectedMapLayerId()).toBe(DEFAULT_MAP_LAYER_ID);
    });

    it('round-trips a valid selected layer and ignores invalid ones', () => {
      seedValidAuth();
      setSelectedMapLayerId('esri-world-hillshade');
      expect(getSelectedMapLayerId()).toBe('esri-world-hillshade');

      const stored = JSON.parse(localStorage.getItem(PREFERENCES.STORAGE_KEY) ?? '{}');
      stored.selectedMapLayerId = 'not-a-layer';
      localStorage.setItem(PREFERENCES.STORAGE_KEY, JSON.stringify(stored));
      expect(getSelectedMapLayerId()).toBe(DEFAULT_MAP_LAYER_ID);
    });

    it('treats the forced satellite layer as always enabled', () => {
      seedValidAuth();
      expect(isLayerOfflineSyncEnabled('esri-satellite')).toBe(true);
      // Attempting to disable the forced layer is ignored.
      setLayerOfflineSyncPreference('esri-satellite', false);
      expect(isLayerOfflineSyncEnabled('esri-satellite')).toBe(true);
    });

    it('defaults extra layers to off and round-trips opt-in', () => {
      seedValidAuth();
      expect(isLayerOfflineSyncEnabled('esri-world-hillshade')).toBe(false);

      setLayerOfflineSyncPreference('esri-world-hillshade', true);
      expect(isLayerOfflineSyncEnabled('esri-world-hillshade')).toBe(true);
      expect(getLayerOfflineSyncPreferences()).toEqual({ 'esri-world-hillshade': true });

      setLayerOfflineSyncPreference('esri-world-hillshade', false);
      expect(isLayerOfflineSyncEnabled('esri-world-hillshade')).toBe(false);
    });

    it('does not clobber other layer opt-ins when toggling one', () => {
      seedValidAuth();
      setLayerOfflineSyncPreference('esri-world-hillshade', true);
      setLayerOfflineSyncPreference('esri-world-hillshade-dark', true);
      expect(getLayerOfflineSyncPreferences()).toEqual({
        'esri-world-hillshade': true,
        'esri-world-hillshade-dark': true,
      });
    });

    it('clearPreferences wipes layer preferences', () => {
      seedValidAuth();
      setSelectedMapLayerId('esri-world-hillshade');
      setLayerOfflineSyncPreference('esri-world-hillshade', true);
      clearPreferences();
      expect(getSelectedMapLayerId()).toBe(DEFAULT_MAP_LAYER_ID);
      expect(getLayerOfflineSyncPreferences()).toEqual({});
    });
  });
});
