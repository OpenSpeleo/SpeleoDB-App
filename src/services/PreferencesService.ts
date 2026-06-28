/**
 * Non-secret user preferences persistence. Authentication tokens are accepted
 * only as a legacy migration input and are never returned or newly written.
 * Single localStorage key; can be swapped for @capacitor/preferences later.
 */

import { DEFAULT_MAP_LAYER_ID, MAP_LAYERS, PREFERENCES } from '../constants';
import { isMapLayerId, type MapLayerId } from '../types/mapLayer';
import {
  DEFAULT_MAP_COLOR_MODE,
  isMapColorMode,
  type MapColorMode,
} from '../types/mapColorMode';
import {
  DEFAULT_MEASUREMENT_UNIT,
  isMeasurementUnit,
  type MeasurementUnit,
} from '../types/measurementUnit';
import type { SessionMetadataStore } from './SecureSessionStore';

const LEGACY_PLAINTEXT_CREDENTIALS_KEY = 'speleo_users_db';

export interface UserPreferences {
  email?: string;
  instance?: string;
  hasStoredSession?: boolean;
  projectVisibility?: Record<string, boolean>;
  countryVisibility?: Record<string, boolean>;
  countryCollapsed?: Record<string, boolean>;
  landmarkCollectionVisibility?: Record<string, boolean>;
  landmarkCollectionCollapsed?: Record<string, boolean>;
  /**
   * Per-GPS-track map visibility. Unlike projects/landmarks, GPS tracks default
   * to HIDDEN: a missing key means NOT visible, so only tracks the user has
   * explicitly toggled on are drawn.
   */
  gpsTrackVisibility?: Record<string, boolean>;
  hasCompletedGuidedTour?: boolean;
  showLandmarks?: boolean;
  colorMode?: MapColorMode;
  measurementUnit?: MeasurementUnit;
  /** Currently selected map tile layer id. */
  selectedMapLayerId?: MapLayerId;
  /**
   * Per-layer offline sync opt-in. Missing keys imply OFF for non-forced
   * layers; the forced (satellite) layer is always treated as ON regardless of
   * the stored value.
   */
  layerOfflineSync?: Record<string, boolean>;
  lastSyncedAt?: number;
  /** True when the user has approved letting tile prefetch exceed the cache cap. */
  tileCacheOverLimitApproved?: boolean;
  /**
   * True once the user has been shown the storage-overflow prompt at least once.
   * Gates the one-time auto popup so it never auto-reappears across app starts.
   */
  tileCacheOverLimitPromptAcknowledged?: boolean;
}

interface StoredPreferences extends UserPreferences {
  /** Legacy-only migration input. Normal preference writes preserve but never create it. */
  token?: string;
}

function clearStoredPreferencesSilently(): void {
  try {
    localStorage.removeItem(getStorageKey());
  } catch {
    // no-op; callers still receive a safe in-memory fallback.
  }
}

function getStorageKey(): string {
  return PREFERENCES.STORAGE_KEY;
}

function normalizeBooleanRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object') return {};

  const normalized: Record<string, boolean> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (!key) continue;
    if (typeof val === 'boolean') {
      normalized[key] = val;
    }
  }
  return normalized;
}

const normalizeProjectVisibility = normalizeBooleanRecord;
const normalizeCountryVisibility = normalizeBooleanRecord;
const normalizeCountryCollapsed = normalizeBooleanRecord;
const normalizeLandmarkCollectionVisibility = normalizeBooleanRecord;
const normalizeGpsTrackVisibility = normalizeBooleanRecord;
const normalizeLandmarkCollectionCollapsed = normalizeBooleanRecord;

function normalizeGuidedTourCompletion(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  return undefined;
}

function normalizeShowLandmarks(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  return undefined;
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  return undefined;
}

function normalizeColorMode(value: unknown): MapColorMode | undefined {
  if (isMapColorMode(value)) return value;
  return undefined;
}

function normalizeMeasurementUnit(value: unknown): MeasurementUnit | undefined {
  if (isMeasurementUnit(value)) return value;
  return undefined;
}

function normalizeSelectedMapLayerId(value: unknown): MapLayerId | undefined {
  if (isMapLayerId(value)) return value;
  return undefined;
}

const normalizeLayerOfflineSync = normalizeBooleanRecord;

function normalizeLastSyncedAt(value: unknown): number | undefined {
  if (typeof value !== 'number') return undefined;
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function emptyPreferences(): StoredPreferences {
  return {
    instance: undefined,
    hasStoredSession: undefined,
    projectVisibility: {},
    countryVisibility: {},
    countryCollapsed: {},
    landmarkCollectionVisibility: {},
    landmarkCollectionCollapsed: {},
    gpsTrackVisibility: {},
    hasCompletedGuidedTour: undefined,
    showLandmarks: undefined,
    colorMode: undefined,
    measurementUnit: undefined,
    selectedMapLayerId: undefined,
    layerOfflineSync: {},
    lastSyncedAt: undefined,
    tileCacheOverLimitApproved: undefined,
    tileCacheOverLimitPromptAcknowledged: undefined,
  };
}

function readRawPreferences(): StoredPreferences {
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (!raw) {
      clearStoredPreferencesSilently();
      return emptyPreferences();
    }

    const parsed = JSON.parse(raw) as StoredPreferences;
    const hasLegacyToken = typeof parsed.token === 'string' && parsed.token.trim().length > 0;
    const hasStoredSession = parsed.hasStoredSession === true;
    const hasInstance = typeof parsed.instance === 'string' && parsed.instance.trim().length > 0;
    const hasInvalidSessionMetadata = (hasLegacyToken || hasStoredSession) && !hasInstance;
    const normalized: StoredPreferences = {
      email: hasInvalidSessionMetadata ? undefined : parsed.email,
      token: hasLegacyToken && !hasInvalidSessionMetadata ? parsed.token : undefined,
      instance: hasInstance ? parsed.instance : undefined,
      hasStoredSession: (hasStoredSession && !hasInvalidSessionMetadata) || undefined,
      projectVisibility: normalizeProjectVisibility(parsed.projectVisibility),
      countryVisibility: normalizeCountryVisibility(parsed.countryVisibility),
      countryCollapsed: normalizeCountryCollapsed(parsed.countryCollapsed),
      landmarkCollectionVisibility: normalizeLandmarkCollectionVisibility(
        parsed.landmarkCollectionVisibility,
      ),
      landmarkCollectionCollapsed: normalizeLandmarkCollectionCollapsed(
        parsed.landmarkCollectionCollapsed,
      ),
      gpsTrackVisibility: normalizeGpsTrackVisibility(parsed.gpsTrackVisibility),
      hasCompletedGuidedTour: normalizeGuidedTourCompletion(parsed.hasCompletedGuidedTour),
      showLandmarks: normalizeShowLandmarks(parsed.showLandmarks),
      colorMode: normalizeColorMode(parsed.colorMode),
      measurementUnit: normalizeMeasurementUnit(parsed.measurementUnit),
      selectedMapLayerId: normalizeSelectedMapLayerId(parsed.selectedMapLayerId),
      layerOfflineSync: normalizeLayerOfflineSync(parsed.layerOfflineSync),
      lastSyncedAt: normalizeLastSyncedAt(parsed.lastSyncedAt),
      tileCacheOverLimitApproved: normalizeOptionalBoolean(parsed.tileCacheOverLimitApproved),
      tileCacheOverLimitPromptAcknowledged: normalizeOptionalBoolean(
        parsed.tileCacheOverLimitPromptAcknowledged,
      ),
    };
    if (hasInvalidSessionMetadata) {
      // Scrub unusable authentication data without destroying unrelated user
      // settings. If this write fails, the catch below removes the unsafe raw
      // record rather than leaving a plaintext token behind.
      writePreferences(normalized);
    }
    return normalized;
  } catch {
    clearStoredPreferencesSilently();
    return emptyPreferences();
  }
}

function writePreferences(next: StoredPreferences): void {
  localStorage.setItem(getStorageKey(), JSON.stringify(next));
}

type PreferencesMutation = (current: StoredPreferences) => StoredPreferences;

const mutationQueue: PreferencesMutation[] = [];
let isProcessingQueue = false;

/**
 * Serialize preference mutations so rapid updates cannot overwrite each other.
 * This queue is synchronous, deterministic, and safe for bursty UI updates.
 */
function enqueuePreferencesMutation(mutation: PreferencesMutation): void {
  mutationQueue.push(mutation);
  if (isProcessingQueue) return;

  isProcessingQueue = true;
  try {
    while (mutationQueue.length > 0) {
      const nextMutation = mutationQueue.shift()!;
      const current = readRawPreferences();
      const mutated = nextMutation(current);
      const next: StoredPreferences = {
        email: mutated.email,
        token: mutated.token,
        instance: mutated.instance,
        hasStoredSession: mutated.hasStoredSession === true || undefined,
        projectVisibility: normalizeProjectVisibility(mutated.projectVisibility),
        countryVisibility: normalizeCountryVisibility(mutated.countryVisibility),
        countryCollapsed: normalizeCountryCollapsed(mutated.countryCollapsed),
        landmarkCollectionVisibility: normalizeLandmarkCollectionVisibility(
          mutated.landmarkCollectionVisibility,
        ),
        landmarkCollectionCollapsed: normalizeLandmarkCollectionCollapsed(
          mutated.landmarkCollectionCollapsed,
        ),
        gpsTrackVisibility: normalizeGpsTrackVisibility(mutated.gpsTrackVisibility),
        hasCompletedGuidedTour: normalizeGuidedTourCompletion(mutated.hasCompletedGuidedTour),
        showLandmarks: normalizeShowLandmarks(mutated.showLandmarks),
        colorMode: normalizeColorMode(mutated.colorMode),
        measurementUnit: normalizeMeasurementUnit(mutated.measurementUnit),
        selectedMapLayerId: normalizeSelectedMapLayerId(mutated.selectedMapLayerId),
        layerOfflineSync: normalizeLayerOfflineSync(mutated.layerOfflineSync),
        lastSyncedAt: normalizeLastSyncedAt(mutated.lastSyncedAt),
        tileCacheOverLimitApproved: normalizeOptionalBoolean(mutated.tileCacheOverLimitApproved),
        tileCacheOverLimitPromptAcknowledged: normalizeOptionalBoolean(
          mutated.tileCacheOverLimitPromptAcknowledged,
        ),
      };
      writePreferences(next);
    }
  } catch (error) {
    console.error('Failed to save preferences:', error);
  } finally {
    isProcessingQueue = false;
  }
}

/**
 * Returns current preferences. Applies default instance when missing.
 */
export function getPreferences(): UserPreferences {
  const { token: _legacyToken, ...preferences } = readRawPreferences();
  return preferences;
}

/** Strict metadata adapter used by SecureSessionStore's transactional boundary. */
export const sessionMetadataStore: SessionMetadataStore = {
  read: () => {
    const stored = readRawPreferences();
    return {
      email: stored.email,
      instance: stored.instance,
      hasStoredSession: stored.hasStoredSession === true,
      legacyToken: stored.token,
    };
  },
  commit: ({ email, instance }) => {
    const current = readRawPreferences();
    writePreferences({
      ...current,
      email,
      instance,
      hasStoredSession: true,
      token: undefined,
    });
  },
  clear: () => {
    const current = readRawPreferences();
    writePreferences({
      ...current,
      email: undefined,
      hasStoredSession: undefined,
      token: undefined,
    });
  },
};

/**
 * Merges partial preferences into storage. Does not log or expose token.
 */
export function setPreferences(prefs: Partial<UserPreferences>): void {
  enqueuePreferencesMutation((current) => ({
    ...current,
    ...prefs,
    projectVisibility:
      prefs.projectVisibility === undefined
        ? current.projectVisibility
        : normalizeProjectVisibility(prefs.projectVisibility),
    countryVisibility:
      prefs.countryVisibility === undefined
        ? current.countryVisibility
        : normalizeCountryVisibility(prefs.countryVisibility),
    countryCollapsed:
      prefs.countryCollapsed === undefined
        ? current.countryCollapsed
        : normalizeCountryCollapsed(prefs.countryCollapsed),
    landmarkCollectionVisibility:
      prefs.landmarkCollectionVisibility === undefined
        ? current.landmarkCollectionVisibility
        : normalizeLandmarkCollectionVisibility(prefs.landmarkCollectionVisibility),
    landmarkCollectionCollapsed:
      prefs.landmarkCollectionCollapsed === undefined
        ? current.landmarkCollectionCollapsed
        : normalizeLandmarkCollectionCollapsed(prefs.landmarkCollectionCollapsed),
    gpsTrackVisibility:
      prefs.gpsTrackVisibility === undefined
        ? current.gpsTrackVisibility
        : normalizeGpsTrackVisibility(prefs.gpsTrackVisibility),
    hasCompletedGuidedTour:
      prefs.hasCompletedGuidedTour === undefined
        ? current.hasCompletedGuidedTour
        : normalizeGuidedTourCompletion(prefs.hasCompletedGuidedTour),
    showLandmarks:
      prefs.showLandmarks === undefined
        ? current.showLandmarks
        : normalizeShowLandmarks(prefs.showLandmarks),
    colorMode:
      prefs.colorMode === undefined
        ? current.colorMode
        : normalizeColorMode(prefs.colorMode),
    measurementUnit:
      prefs.measurementUnit === undefined
        ? current.measurementUnit
        : normalizeMeasurementUnit(prefs.measurementUnit),
    selectedMapLayerId:
      prefs.selectedMapLayerId === undefined
        ? current.selectedMapLayerId
        : normalizeSelectedMapLayerId(prefs.selectedMapLayerId),
    layerOfflineSync:
      prefs.layerOfflineSync === undefined
        ? current.layerOfflineSync
        : normalizeLayerOfflineSync(prefs.layerOfflineSync),
    lastSyncedAt:
      prefs.lastSyncedAt === undefined
        ? current.lastSyncedAt
        : normalizeLastSyncedAt(prefs.lastSyncedAt),
    tileCacheOverLimitApproved:
      prefs.tileCacheOverLimitApproved === undefined
        ? current.tileCacheOverLimitApproved
        : normalizeOptionalBoolean(prefs.tileCacheOverLimitApproved),
    tileCacheOverLimitPromptAcknowledged:
      prefs.tileCacheOverLimitPromptAcknowledged === undefined
        ? current.tileCacheOverLimitPromptAcknowledged
        : normalizeOptionalBoolean(prefs.tileCacheOverLimitPromptAcknowledged),
  }));
}

/**
 * Read persisted project visibility map. Missing keys imply visible (true).
 */
export function getProjectVisibilityPreferences(): Record<string, boolean> {
  return { ...(getPreferences().projectVisibility ?? {}) };
}

/**
 * Persist visibility for one project ID.
 */
export function setProjectVisibilityPreference(
  projectId: string,
  visible: boolean,
): void {
  if (!projectId) return;
  setProjectVisibilityPreferences({ [projectId]: visible });
}

/**
 * Persist visibility for multiple projects at once.
 */
export function setProjectVisibilityPreferences(
  updates: Record<string, boolean>,
): void {
  const safeUpdates = normalizeProjectVisibility(updates);
  if (Object.keys(safeUpdates).length === 0) return;

  enqueuePreferencesMutation((current) => ({
    ...current,
    projectVisibility: {
      ...(current.projectVisibility ?? {}),
      ...safeUpdates,
    },
  }));
}

/**
 * Read persisted country visibility map. Missing keys imply visible (true).
 *
 * The country gate is the second factor in the AND that determines whether a
 * project is shown on the map; the per-project preference is the first.
 */
export function getCountryVisibilityPreferences(): Record<string, boolean> {
  return { ...(getPreferences().countryVisibility ?? {}) };
}

/**
 * Persist visibility for one country code.
 */
export function setCountryVisibilityPreference(
  country: string,
  visible: boolean,
): void {
  if (!country) return;
  setCountryVisibilityPreferences({ [country]: visible });
}

/**
 * Persist visibility for multiple countries at once (used by `Show all`).
 */
export function setCountryVisibilityPreferences(
  updates: Record<string, boolean>,
): void {
  const safeUpdates = normalizeCountryVisibility(updates);
  if (Object.keys(safeUpdates).length === 0) return;

  enqueuePreferencesMutation((current) => ({
    ...current,
    countryVisibility: {
      ...(current.countryVisibility ?? {}),
      ...safeUpdates,
    },
  }));
}

/**
 * Read persisted country collapsed map. Missing keys imply expanded (false).
 */
export function getCountryCollapsedPreferences(): Record<string, boolean> {
  return { ...(getPreferences().countryCollapsed ?? {}) };
}

/**
 * Persist collapsed state for one country code.
 */
export function setCountryCollapsedPreference(
  country: string,
  collapsed: boolean,
): void {
  if (!country) return;
  enqueuePreferencesMutation((current) => ({
    ...current,
    countryCollapsed: {
      ...(current.countryCollapsed ?? {}),
      [country]: collapsed,
    },
  }));
}

/**
 * Read persisted landmark collection visibility map. Missing keys imply
 * visible (true), mirroring the project visibility semantics.
 */
export function getLandmarkCollectionVisibilityPreferences(): Record<string, boolean> {
  return { ...(getPreferences().landmarkCollectionVisibility ?? {}) };
}

/**
 * Persist visibility for one landmark collection ID.
 */
export function setLandmarkCollectionVisibilityPreference(
  collectionId: string,
  visible: boolean,
): void {
  if (!collectionId) return;
  setLandmarkCollectionVisibilityPreferences({ [collectionId]: visible });
}

/**
 * Persist visibility for multiple landmark collections at once (used by the
 * panel's `Show all` / `Hide all` bulk actions).
 */
export function setLandmarkCollectionVisibilityPreferences(
  updates: Record<string, boolean>,
): void {
  const safeUpdates = normalizeLandmarkCollectionVisibility(updates);
  if (Object.keys(safeUpdates).length === 0) return;

  enqueuePreferencesMutation((current) => ({
    ...current,
    landmarkCollectionVisibility: {
      ...(current.landmarkCollectionVisibility ?? {}),
      ...safeUpdates,
    },
  }));
}

/**
 * Read persisted GPS-track visibility map. Unlike projects/landmarks, missing
 * keys imply HIDDEN (false): GPS tracks default to off and are only drawn once
 * the user explicitly toggles them on.
 */
export function getGpsTrackVisibilityPreferences(): Record<string, boolean> {
  return { ...(getPreferences().gpsTrackVisibility ?? {}) };
}

/** Persist visibility for one GPS track id. */
export function setGpsTrackVisibilityPreference(trackId: string, visible: boolean): void {
  if (!trackId) return;
  enqueuePreferencesMutation((current) => ({
    ...current,
    gpsTrackVisibility: {
      ...(current.gpsTrackVisibility ?? {}),
      [trackId]: visible,
    },
  }));
}

/**
 * Read persisted landmark collection collapsed map. Missing keys imply
 * expanded (false).
 */
export function getLandmarkCollectionCollapsedPreferences(): Record<string, boolean> {
  return { ...(getPreferences().landmarkCollectionCollapsed ?? {}) };
}

/**
 * Persist collapsed state for one landmark collection ID.
 */
export function setLandmarkCollectionCollapsedPreference(
  collectionId: string,
  collapsed: boolean,
): void {
  if (!collectionId) return;
  enqueuePreferencesMutation((current) => ({
    ...current,
    landmarkCollectionCollapsed: {
      ...(current.landmarkCollectionCollapsed ?? {}),
      [collectionId]: collapsed,
    },
  }));
}

/**
 * Read guided tour completion flag.
 */
export function getHasCompletedGuidedTour(): boolean {
  return getPreferences().hasCompletedGuidedTour === true;
}

/**
 * Persist guided tour completion flag.
 */
export function setHasCompletedGuidedTour(completed: boolean): void {
  setPreferences({ hasCompletedGuidedTour: completed });
}

/**
 * Read landmark visibility preference. Defaults to true (shown) when missing.
 */
export function getShowLandmarks(): boolean {
  return getPreferences().showLandmarks !== false;
}

/**
 * Persist landmark visibility preference.
 */
export function setShowLandmarks(visible: boolean): void {
  setPreferences({ showLandmarks: visible });
}

/**
 * Read whether the user approved exceeding the tile-cache cap. Default false.
 */
export function getTileCacheOverLimitApproved(): boolean {
  return getPreferences().tileCacheOverLimitApproved === true;
}

/**
 * Persist whether the user approved exceeding the tile-cache cap.
 */
export function setTileCacheOverLimitApproved(approved: boolean): void {
  setPreferences({ tileCacheOverLimitApproved: approved });
}

/**
 * Read whether the storage-overflow prompt has already been shown + answered.
 * Default false. Gates the one-time auto popup.
 */
export function getTileCacheOverLimitPromptAcknowledged(): boolean {
  return getPreferences().tileCacheOverLimitPromptAcknowledged === true;
}

/**
 * Persist that the storage-overflow prompt has been shown + answered.
 */
export function setTileCacheOverLimitPromptAcknowledged(acknowledged: boolean): void {
  setPreferences({ tileCacheOverLimitPromptAcknowledged: acknowledged });
}

/**
 * Read map color mode preference. Defaults to project coloring when missing.
 */
export function getColorMode(): MapColorMode {
  return getPreferences().colorMode ?? DEFAULT_MAP_COLOR_MODE;
}

/**
 * Persist map color mode preference.
 */
export function setColorMode(mode: MapColorMode): void {
  setPreferences({ colorMode: mode });
}

/**
 * Read map measurement unit. Defaults to meters when missing.
 */
export function getMeasurementUnit(): MeasurementUnit {
  return getPreferences().measurementUnit ?? DEFAULT_MEASUREMENT_UNIT;
}

/**
 * Persist map measurement unit preference.
 */
export function setMeasurementUnit(unit: MeasurementUnit): void {
  setPreferences({ measurementUnit: unit });
}

/**
 * Read the selected map tile layer id. Defaults to the satellite layer.
 */
export function getSelectedMapLayerId(): MapLayerId {
  return getPreferences().selectedMapLayerId ?? DEFAULT_MAP_LAYER_ID;
}

/**
 * Persist the selected map tile layer id.
 */
export function setSelectedMapLayerId(layerId: MapLayerId): void {
  setPreferences({ selectedMapLayerId: layerId });
}

/**
 * Read the full per-layer offline sync map (raw stored values, no forcing).
 */
export function getLayerOfflineSyncPreferences(): Record<string, boolean> {
  return { ...(getPreferences().layerOfflineSync ?? {}) };
}

/**
 * True when a layer's tiles should be synced for offline use. Forced layers
 * (satellite) are always enabled; other layers default to OFF until opted in.
 */
export function isLayerOfflineSyncEnabled(layerId: string): boolean {
  const layer = MAP_LAYERS.find((entry) => entry.id === layerId);
  if (layer?.forcedOffline) return true;
  return getPreferences().layerOfflineSync?.[layerId] === true;
}

/**
 * Persist offline sync opt-in for a single layer. Forced layers are ignored
 * (they are always enabled).
 */
export function setLayerOfflineSyncPreference(layerId: string, enabled: boolean): void {
  if (!layerId) return;
  const layer = MAP_LAYERS.find((entry) => entry.id === layerId);
  if (layer?.forcedOffline) return;
  enqueuePreferencesMutation((current) => ({
    ...current,
    layerOfflineSync: {
      ...(current.layerOfflineSync ?? {}),
      [layerId]: enabled,
    },
  }));
}

/**
 * Clears all stored user preferences.
 */
export function clearPreferences(): void {
  try {
    localStorage.removeItem(getStorageKey());
  } catch (error) {
    console.error('Failed to clear preferences:', error);
  }
}

/** Remove credential residue created by pre-secure-storage app versions. */
export function removeLegacyPlaintextCredentials(): void {
  localStorage.removeItem(LEGACY_PLAINTEXT_CREDENTIALS_KEY);
}
