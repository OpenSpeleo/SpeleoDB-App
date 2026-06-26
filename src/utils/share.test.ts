import { describe, it, expect } from 'vitest';
import { isShareCancellation } from './share';

describe('isShareCancellation', () => {
  it('detects cancel strings', () => {
    expect(isShareCancellation('Share canceled')).toBe(true);
    expect(isShareCancellation('User cancelled the share')).toBe(true);
  });

  it('detects cancel in an error message', () => {
    expect(isShareCancellation(new Error('Share cancelled'))).toBe(true);
    expect(isShareCancellation({ message: 'cancel' })).toBe(true);
  });

  it('returns false for genuine failures', () => {
    expect(isShareCancellation(new Error('bridge unavailable'))).toBe(false);
    expect(isShareCancellation(new Error('Operation cannot cancel previous export'))).toBe(false);
    expect(isShareCancellation('boom')).toBe(false);
    expect(isShareCancellation(null)).toBe(false);
    expect(isShareCancellation(undefined)).toBe(false);
  });
});
