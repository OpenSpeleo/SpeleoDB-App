import { describe, it, expect } from 'vitest';
import { API, HTTP_STATUS, HEADERS, PREFERENCES, NETWORK, MAP, COLORS } from './constants';

describe('constants', () => {
  describe('API', () => {
    it('has BASE_PATH /api/v2', () => {
      expect(API.BASE_PATH).toBe('/api/v2');
    });

    it('has AUTH_TOKEN_ENDPOINT containing /user/auth-token/', () => {
      expect(API.AUTH_TOKEN_ENDPOINT).toContain('/user/auth-token/');
      expect(API.AUTH_TOKEN_ENDPOINT).toBe('/api/v2/user/auth-token/');
    });
  });

  describe('HTTP_STATUS', () => {
    it('has expected status codes', () => {
      expect(HTTP_STATUS.OK).toBe(200);
      expect(HTTP_STATUS.CREATED).toBe(201);
      expect(HTTP_STATUS.UNAUTHORIZED).toBe(401);
      expect(HTTP_STATUS.UNPROCESSABLE_ENTITY).toBe(422);
    });
  });

  describe('HEADERS', () => {
    it('has CONTENT_TYPE and AUTHORIZATION', () => {
      expect(HEADERS.CONTENT_TYPE).toBe('Content-Type');
      expect(HEADERS.AUTHORIZATION).toBe('Authorization');
    });

    it('has APPLICATION_JSON and TOKEN_PREFIX', () => {
      expect(HEADERS.APPLICATION_JSON).toBe('application/json');
      expect(HEADERS.TOKEN_PREFIX).toBe('Token ');
    });
  });

  describe('PREFERENCES', () => {
    it('has STORAGE_KEY and pref keys', () => {
      expect(PREFERENCES.STORAGE_KEY).toBe('speleo_user_preferences');
      expect(PREFERENCES.PREF_EMAIL).toBe('email');
      expect(PREFERENCES.PREF_TOKEN).toBe('token');
      expect(PREFERENCES.PREF_INSTANCE).toBe('instance');
    });
  });

  describe('NETWORK', () => {
    it('has REQUEST_TIMEOUT_MS', () => {
      expect(NETWORK.REQUEST_TIMEOUT_MS).toBe(10000);
    });

    it('has STARTUP_AUTH_TIMEOUT_MS of 10s for spotty networks', () => {
      expect(NETWORK.STARTUP_AUTH_TIMEOUT_MS).toBe(10000);
    });
  });

  describe('MAP', () => {
    it('has STYLE_URL as a non-empty string', () => {
      expect(typeof MAP.STYLE_URL).toBe('string');
      expect(MAP.STYLE_URL.length).toBeGreaterThan(0);
    });

    it('has DEFAULT_CENTER as [longitude, latitude]', () => {
      expect(MAP.DEFAULT_CENTER).toHaveLength(2);
      expect(MAP.DEFAULT_CENTER[0]).toBeGreaterThanOrEqual(-180);
      expect(MAP.DEFAULT_CENTER[0]).toBeLessThanOrEqual(180);
      expect(MAP.DEFAULT_CENTER[1]).toBeGreaterThanOrEqual(-90);
      expect(MAP.DEFAULT_CENTER[1]).toBeLessThanOrEqual(90);
    });

    it('has DEFAULT_ZOOM as a positive number', () => {
      expect(MAP.DEFAULT_ZOOM).toBeGreaterThan(0);
    });

    it('has MAX_ZOOM greater than or equal to DEFAULT_ZOOM', () => {
      expect(MAP.MAX_ZOOM).toBeGreaterThanOrEqual(MAP.DEFAULT_ZOOM);
    });

    it('caps MAX_ZOOM at 19.9 for satellite reliability', () => {
      expect(MAP.MAX_ZOOM).toBe(19.9);
    });

    it('locks map orientation to north-up defaults', () => {
      expect(MAP.NORTH_UP_ORIENTATION.bearing).toBe(0);
      expect(MAP.NORTH_UP_ORIENTATION.pitch).toBe(0);
    });

    it('disables rotation and pitch interactions for locked maps', () => {
      expect(MAP.ROTATION_LOCK_INTERACTIONS.dragRotate).toBe(false);
      expect(MAP.ROTATION_LOCK_INTERACTIONS.touchPitch).toBe(false);
      expect(MAP.ROTATION_LOCK_INTERACTIONS.pitchWithRotate).toBe(false);
      expect(MAP.ROTATION_LOCK_INTERACTIONS.keyboard).toBe(false);
      expect(MAP.ROTATION_LOCK_INTERACTIONS.maxPitch).toBe(0);
    });
  });

  describe('COLORS', () => {
    it('exposes a neutral fallback for missing project colors', () => {
      expect(COLORS.FALLBACK).toBe('#94a3b8');
    });

    it('uses a valid 6-digit hex string for the fallback', () => {
      expect(COLORS.FALLBACK).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });
});
