import { describe, expect, it } from 'vitest';
import {
  getAppleMarketingModelName,
  getAppleMarketingModelOrIdentifier,
} from './appleDeviceModelMap';

describe('appleDeviceModelMap', () => {
  it('maps iPhone hardware identifier to marketing name', () => {
    expect(getAppleMarketingModelName('iPhone16,2')).toBe('iPhone 15 Pro Max');
  });

  it('maps iPad hardware identifier to marketing name', () => {
    expect(getAppleMarketingModelName('iPad16,6')).toBe('iPad Pro 13-inch (M4)');
  });

  it('returns undefined for unknown identifiers', () => {
    expect(getAppleMarketingModelName('iPhone999,9')).toBeUndefined();
  });

  it('falls back to raw identifier for unknown model', () => {
    expect(getAppleMarketingModelOrIdentifier('iPhone20,4')).toBe('iPhone20,4');
  });
});
