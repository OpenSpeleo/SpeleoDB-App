import { describe, it, expect } from 'vitest';
import { parseGeolocationError, PERMISSION_DENIED_SENTINEL } from './geolocationError';
import type { GeolocationErrorInfo } from './geolocationError';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errWithCode(code: string) {
  const e = new Error('plugin error');
  (e as Error & { code: string }).code = code;
  return e;
}

function plainObjWithCode(code: string) {
  return { message: 'plugin error', code };
}

// ---------------------------------------------------------------------------
// Permission Denied (0003, 0008)
// ---------------------------------------------------------------------------

describe('Permission Denied errors', () => {
  const codes = ['OS-PLUG-GLOC-0003', 'OS-PLUG-GLOC-0008'];

  it.each(codes)('code %s maps to "Location Permission Required"', (code) => {
    const info = parseGeolocationError(errWithCode(code), 'android');
    expect(info.title).toBe('Location Permission Required');
    expect(info.iconColor).toBe('amber');
  });

  it('shows iOS-specific instructions on ios', () => {
    const info = parseGeolocationError(errWithCode('OS-PLUG-GLOC-0003'), 'ios');
    expect(info.instructions).toContain('Settings');
    expect(info.instructions).toContain('While Using the App');
  });

  it('shows Android-specific instructions on android', () => {
    const info = parseGeolocationError(errWithCode('OS-PLUG-GLOC-0003'), 'android');
    expect(info.instructions).toContain('Settings');
    expect(info.instructions).toContain('Permissions');
  });

  it('shows browser instructions on web', () => {
    const info = parseGeolocationError(errWithCode('OS-PLUG-GLOC-0003'), 'web');
    expect(info.instructions).toContain('browser');
  });
});

// ---------------------------------------------------------------------------
// Location Disabled (0007, 0009, 0016, 0017)
// ---------------------------------------------------------------------------

describe('Location Disabled errors', () => {
  const codes = [
    'OS-PLUG-GLOC-0007',
    'OS-PLUG-GLOC-0009',
    'OS-PLUG-GLOC-0016',
    'OS-PLUG-GLOC-0017',
  ];

  it.each(codes)('code %s maps to "Location Services Disabled"', (code) => {
    const info = parseGeolocationError(errWithCode(code), 'android');
    expect(info.title).toBe('Location Services Disabled');
    expect(info.iconColor).toBe('amber');
  });

  it('shows iOS instructions on ios', () => {
    const info = parseGeolocationError(errWithCode('OS-PLUG-GLOC-0007'), 'ios');
    expect(info.instructions).toContain('Privacy');
  });

  it('shows Android instructions on android', () => {
    const info = parseGeolocationError(errWithCode('OS-PLUG-GLOC-0007'), 'android');
    expect(info.instructions).toContain('Location');
  });
});

// ---------------------------------------------------------------------------
// Timeout (0010)
// ---------------------------------------------------------------------------

describe('Timeout error', () => {
  it('maps to "Could Not Determine Location"', () => {
    const info = parseGeolocationError(errWithCode('OS-PLUG-GLOC-0010'), 'android');
    expect(info.title).toBe('Could Not Determine Location');
    expect(info.iconColor).toBe('blue');
    expect(info.instructions).toContain('outdoors');
  });

  it('timeout is platform-independent', () => {
    const ios = parseGeolocationError(errWithCode('OS-PLUG-GLOC-0010'), 'ios');
    const android = parseGeolocationError(errWithCode('OS-PLUG-GLOC-0010'), 'android');
    expect(ios.title).toBe(android.title);
    expect(ios.instructions).toBe(android.instructions);
  });
});

// ---------------------------------------------------------------------------
// Google Play Services (0014, 0015)
// ---------------------------------------------------------------------------

describe('Google Play Services errors', () => {
  it.each(['OS-PLUG-GLOC-0014', 'OS-PLUG-GLOC-0015'])(
    'code %s maps to "Google Play Services Required"',
    (code) => {
      const info = parseGeolocationError(errWithCode(code), 'android');
      expect(info.title).toBe('Google Play Services Required');
      expect(info.iconColor).toBe('red');
      expect(info.instructions).toContain('Google Play Store');
    },
  );
});

// ---------------------------------------------------------------------------
// Position Unavailable / fallback (0002, unknown)
// ---------------------------------------------------------------------------

describe('Position Unavailable fallback', () => {
  it('code 0002 maps to "Location Unavailable"', () => {
    const info = parseGeolocationError(errWithCode('OS-PLUG-GLOC-0002'), 'android');
    expect(info.title).toBe('Location Unavailable');
    expect(info.iconColor).toBe('red');
  });

  it('unknown code falls back to "Location Unavailable"', () => {
    const info = parseGeolocationError(errWithCode('OS-PLUG-GLOC-9999'), 'ios');
    expect(info.title).toBe('Location Unavailable');
  });
});

// ---------------------------------------------------------------------------
// Edge cases: non-Error input
// ---------------------------------------------------------------------------

describe('non-standard error inputs', () => {
  it('handles plain object with code', () => {
    const info = parseGeolocationError(plainObjWithCode('OS-PLUG-GLOC-0003'), 'android');
    expect(info.title).toBe('Location Permission Required');
  });

  it('handles bare code string', () => {
    const info = parseGeolocationError('OS-PLUG-GLOC-0010', 'android');
    expect(info.title).toBe('Could Not Determine Location');
  });

  it('handles null gracefully', () => {
    const info = parseGeolocationError(null, 'android');
    expect(info.title).toBe('Location Unavailable');
  });

  it('handles undefined gracefully', () => {
    const info = parseGeolocationError(undefined, 'ios');
    expect(info.title).toBe('Location Unavailable');
  });

  it('handles a plain Error without code', () => {
    const info = parseGeolocationError(new Error('boom'), 'android');
    expect(info.title).toBe('Location Unavailable');
  });

  it('handles PERMISSION_DENIED_SENTINEL', () => {
    const info = parseGeolocationError(PERMISSION_DENIED_SENTINEL, 'ios');
    expect(info.title).toBe('Location Permission Required');
    expect(info.iconColor).toBe('amber');
  });
});

// ---------------------------------------------------------------------------
// Structural: every result satisfies the interface shape
// ---------------------------------------------------------------------------

describe('return shape', () => {
  const scenarios: Array<[string, unknown]> = [
    ['permission denied', errWithCode('OS-PLUG-GLOC-0003')],
    ['location disabled', errWithCode('OS-PLUG-GLOC-0007')],
    ['timeout', errWithCode('OS-PLUG-GLOC-0010')],
    ['play services', errWithCode('OS-PLUG-GLOC-0015')],
    ['position unavailable', errWithCode('OS-PLUG-GLOC-0002')],
    ['null input', null],
  ];

  it.each(scenarios)('%s returns all required fields', (_label, err) => {
    const info: GeolocationErrorInfo = parseGeolocationError(err, 'android');
    expect(typeof info.title).toBe('string');
    expect(typeof info.description).toBe('string');
    expect(typeof info.instructions).toBe('string');
    expect(['amber', 'blue', 'red']).toContain(info.iconColor);
    expect(info.title.length).toBeGreaterThan(0);
    expect(info.description.length).toBeGreaterThan(0);
    expect(info.instructions.length).toBeGreaterThan(0);
  });
});
