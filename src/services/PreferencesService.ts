/**
 * User preferences persistence (email, token, SDB instance).
 * Single localStorage key; can be swapped for @capacitor/preferences later.
 */

import { PREFERENCES } from '../constants';

export interface UserPreferences {
  email?: string;
  token?: string;
  instance?: string;
  projectVisibility?: Record<string, boolean>;
  hasCompletedGuidedTour?: boolean;
  showLandmarks?: boolean;
}

function getStorageKey(): string {
  return PREFERENCES.STORAGE_KEY;
}

function defaultInstance(): string {
  return PREFERENCES.DEFAULT_INSTANCE;
}

function normalizeProjectVisibility(
  value: unknown,
): Record<string, boolean> {
  if (!value || typeof value !== 'object') return {};

  const normalized: Record<string, boolean> = {};
  for (const [key, visible] of Object.entries(value as Record<string, unknown>)) {
    if (!key) continue;
    if (typeof visible === 'boolean') {
      normalized[key] = visible;
    }
  }
  return normalized;
}

function normalizeGuidedTourCompletion(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  return undefined;
}

function normalizeShowLandmarks(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  return undefined;
}

function readRawPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (!raw) {
      return {
        instance: defaultInstance(),
        projectVisibility: {},
        hasCompletedGuidedTour: undefined,
        showLandmarks: undefined,
      };
    }

    const parsed = JSON.parse(raw) as UserPreferences;
    return {
      email: parsed.email,
      token: parsed.token,
      instance: parsed.instance ?? defaultInstance(),
      projectVisibility: normalizeProjectVisibility(parsed.projectVisibility),
      hasCompletedGuidedTour: normalizeGuidedTourCompletion(parsed.hasCompletedGuidedTour),
      showLandmarks: normalizeShowLandmarks(parsed.showLandmarks),
    };
  } catch {
    return {
      instance: defaultInstance(),
      projectVisibility: {},
      hasCompletedGuidedTour: undefined,
      showLandmarks: undefined,
    };
  }
}

function writePreferences(next: UserPreferences): void {
  localStorage.setItem(getStorageKey(), JSON.stringify(next));
}

type PreferencesMutation = (current: UserPreferences) => UserPreferences;

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
      const next: UserPreferences = {
        email: mutated.email,
        token: mutated.token,
        instance: mutated.instance ?? defaultInstance(),
        projectVisibility: normalizeProjectVisibility(mutated.projectVisibility),
        hasCompletedGuidedTour: normalizeGuidedTourCompletion(mutated.hasCompletedGuidedTour),
        showLandmarks: normalizeShowLandmarks(mutated.showLandmarks),
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
  return readRawPreferences();
}

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
    hasCompletedGuidedTour:
      prefs.hasCompletedGuidedTour === undefined
        ? current.hasCompletedGuidedTour
        : normalizeGuidedTourCompletion(prefs.hasCompletedGuidedTour),
    showLandmarks:
      prefs.showLandmarks === undefined
        ? current.showLandmarks
        : normalizeShowLandmarks(prefs.showLandmarks),
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
 * Clears all stored user preferences.
 */
export function clearPreferences(): void {
  try {
    localStorage.removeItem(getStorageKey());
  } catch (error) {
    console.error('Failed to clear preferences:', error);
  }
}
