/**
 * User preferences persistence (email, token, SDB instance).
 * Single localStorage key; can be swapped for @capacitor/preferences later.
 */

import { PREFERENCES } from '../constants';

export interface UserPreferences {
  email?: string;
  token?: string;
  instance?: string;
}

function getStorageKey(): string {
  return PREFERENCES.STORAGE_KEY;
}

function defaultInstance(): string {
  return PREFERENCES.DEFAULT_INSTANCE;
}

/**
 * Returns current preferences. Applies default instance when missing.
 */
export function getPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (!raw) {
      return { instance: defaultInstance() };
    }
    const parsed = JSON.parse(raw) as UserPreferences;
    return {
      ...parsed,
      instance: parsed.instance ?? defaultInstance(),
    };
  } catch {
    return { instance: defaultInstance() };
  }
}

/**
 * Merges partial preferences into storage. Does not log or expose token.
 */
export function setPreferences(prefs: Partial<UserPreferences>): void {
  try {
    const current = getPreferences();
    const next: UserPreferences = {
      ...current,
      ...prefs,
    };
    localStorage.setItem(getStorageKey(), JSON.stringify(next));
  } catch (error) {
    console.error('Failed to save preferences:', error);
  }
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
