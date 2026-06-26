import { describe, it, expect, vi } from 'vitest';
import {
  createDefaultGnssStatusProvider,
  UNSUPPORTED_GNSS_SNAPSHOT,
} from './GnssStatusProvider';

describe('default GnssStatusProvider', () => {
  it('reports unsupported (iOS/web have no public satellite API)', () => {
    const provider = createDefaultGnssStatusProvider();
    expect(provider.isSupported()).toBe(false);
  });

  it('emits the unsupported snapshot on start and is a no-op on stop', () => {
    const provider = createDefaultGnssStatusProvider();
    const cb = vi.fn();
    provider.start(cb);
    expect(cb).toHaveBeenCalledWith(UNSUPPORTED_GNSS_SNAPSHOT);
    expect(() => provider.stop()).not.toThrow();
  });

  it('the unsupported snapshot has no constellations and unknown multi-band', () => {
    expect(UNSUPPORTED_GNSS_SNAPSHOT).toEqual({
      supported: false,
      multiBand: null,
      constellations: [],
    });
  });
});
