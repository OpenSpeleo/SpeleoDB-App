import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPreferences,
  setPreferences,
  clearPreferences,
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
  });

  describe('clearPreferences', () => {
    it('wipes storage so getPreferences returns defaults', () => {
      setPreferences({ email: 'x@y.com', token: 't', instance: 'https://x.org' });
      clearPreferences();
      const prefs = getPreferences();
      expect(prefs.email).toBeUndefined();
      expect(prefs.token).toBeUndefined();
      expect(prefs.instance).toBe(PREFERENCES.DEFAULT_INSTANCE);
    });
  });
});
