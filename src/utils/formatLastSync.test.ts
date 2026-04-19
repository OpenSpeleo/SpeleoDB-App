import { describe, it, expect } from 'vitest';
import { formatLastSync } from './formatLastSync';

describe('formatLastSync', () => {
  it('returns "Never" for null', () => {
    expect(formatLastSync(null)).toBe('Never');
  });

  it('returns "Never" for undefined', () => {
    expect(formatLastSync(undefined)).toBe('Never');
  });

  it('returns "Never" for non-finite numbers', () => {
    expect(formatLastSync(NaN)).toBe('Never');
    expect(formatLastSync(Infinity)).toBe('Never');
    expect(formatLastSync(-Infinity)).toBe('Never');
  });

  it('returns "Never" for zero or negative epoch', () => {
    expect(formatLastSync(0)).toBe('Never');
    expect(formatLastSync(-1)).toBe('Never');
  });

  it('returns a non-empty locale string for a valid epoch', () => {
    const epoch = Date.UTC(2026, 3, 18, 14, 30); // Apr 18, 2026, 14:30 UTC
    const result = formatLastSync(epoch);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe('Never');
  });

  it('matches the device-locale string from toLocaleString for the same epoch', () => {
    const epoch = Date.UTC(2026, 3, 18, 14, 30);
    const expected = new Date(epoch).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    expect(formatLastSync(epoch)).toBe(expected);
  });
});
