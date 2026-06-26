import { describe, it, expect } from 'vitest';
import { shouldAcceptFix } from './gpsSampling';

const START = 1_000_000;

describe('shouldAcceptFix', () => {
  it('drops fixes older than the session start (replayed last-known location)', () => {
    expect(
      shouldAcceptFix(START - 1, { sessionStartMs: START, lastAcceptedMs: null, minIntervalMs: 1000 }),
    ).toBe(false);
  });

  it('keeps the first in-session fix immediately (no last accepted yet)', () => {
    expect(
      shouldAcceptFix(START, { sessionStartMs: START, lastAcceptedMs: null, minIntervalMs: 15_000 }),
    ).toBe(true);
  });

  it('drops non-finite timestamps instead of poisoning the throttle state', () => {
    expect(
      shouldAcceptFix(Number.NaN, { sessionStartMs: START, lastAcceptedMs: null, minIntervalMs: 1000 }),
    ).toBe(false);
    expect(
      shouldAcceptFix(Number.POSITIVE_INFINITY, {
        sessionStartMs: START,
        lastAcceptedMs: START,
        minIntervalMs: 1000,
      }),
    ).toBe(false);
  });

  it('drops a fix that arrives sooner than minIntervalMs after the last accepted', () => {
    expect(
      shouldAcceptFix(START + 14_999, {
        sessionStartMs: START,
        lastAcceptedMs: START,
        minIntervalMs: 15_000,
      }),
    ).toBe(false);
  });

  it('keeps a fix once minIntervalMs has elapsed', () => {
    expect(
      shouldAcceptFix(START + 15_000, {
        sessionStartMs: START,
        lastAcceptedMs: START,
        minIntervalMs: 15_000,
      }),
    ).toBe(true);
  });

  it('honors different cadences (1s averaging vs 15s recording)', () => {
    const base = { sessionStartMs: START, lastAcceptedMs: START };
    // Averaging cadence (~1/sec).
    expect(shouldAcceptFix(START + 1000, { ...base, minIntervalMs: 1000 })).toBe(true);
    // Recording cadence (~1/15s) drops the same fix.
    expect(shouldAcceptFix(START + 1000, { ...base, minIntervalMs: 15_000 })).toBe(false);
  });
});
