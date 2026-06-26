import { describe, it, expect } from 'vitest';
import {
  aggregateSamples,
  isAcceptableSample,
  accuracyScore,
  DEFAULT_AVERAGING_CONFIG,
  type AccuracySample,
  type AveragingConfig,
} from './gpsAveraging';

const config: AveragingConfig = DEFAULT_AVERAGING_CONFIG;

function sample(overrides: Partial<AccuracySample> = {}): AccuracySample {
  return {
    latitude: 45,
    longitude: -73,
    altitude: 100,
    accuracy: 5,
    altitudeAccuracy: 8,
    timestamp: 0,
    ...overrides,
  };
}

describe('isAcceptableSample', () => {
  it('rejects non-finite or out-of-range coordinates', () => {
    expect(isAcceptableSample(sample({ latitude: NaN }), config)).toBe(false);
    expect(isAcceptableSample(sample({ longitude: Infinity }), config)).toBe(false);
    expect(isAcceptableSample(sample({ latitude: 91 }), config)).toBe(false);
    expect(isAcceptableSample(sample({ longitude: -181 }), config)).toBe(false);
  });

  it('rejects fixes worse than the accuracy cap', () => {
    expect(isAcceptableSample(sample({ accuracy: config.maxAccuracyMeters + 1 }), config)).toBe(false);
    expect(isAcceptableSample(sample({ accuracy: -1 }), config)).toBe(false);
  });

  it('accepts fixes with no accuracy reported', () => {
    expect(isAcceptableSample(sample({ accuracy: null }), config)).toBe(true);
    expect(isAcceptableSample(sample({ accuracy: undefined }), config)).toBe(true);
  });
});

describe('accuracyScore', () => {
  it('is 1 at/under good and the floor at/over poor', () => {
    expect(accuracyScore(config.goodAccuracyMeters, config)).toBe(1);
    expect(accuracyScore(1, config)).toBe(1);
    expect(accuracyScore(config.poorAccuracyMeters, config)).toBe(config.accuracyFloorScore);
    expect(accuracyScore(1000, config)).toBe(config.accuracyFloorScore);
  });

  it('is monotonic decreasing between good and poor', () => {
    const a = accuracyScore(10, config);
    const b = accuracyScore(20, config);
    const c = accuracyScore(30, config);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });

  it('handles unknown accuracy as a midpoint', () => {
    const score = accuracyScore(null, config);
    expect(score).toBeGreaterThan(config.accuracyFloorScore);
    expect(score).toBeLessThan(1);
  });
});

describe('aggregateSamples', () => {
  it('returns null when there are no acceptable samples', () => {
    expect(aggregateSamples([], config)).toBeNull();
    expect(aggregateSamples([sample({ latitude: NaN })], config)).toBeNull();
  });

  it('averages a single sample to itself', () => {
    const result = aggregateSamples([sample({ latitude: 10, longitude: 20 })], config, 0);
    expect(result?.latitude).toBeCloseTo(10, 9);
    expect(result?.longitude).toBeCloseTo(20, 9);
    expect(result?.sampleCount).toBe(1);
  });

  it('weights more accurate fixes more heavily (inverse variance)', () => {
    // One very accurate fix at lat 0, one poor fix at lat 10.
    const result = aggregateSamples(
      [
        sample({ latitude: 0, longitude: 0, accuracy: 1, timestamp: 0 }),
        sample({ latitude: 10, longitude: 0, accuracy: 10, timestamp: 1000 }),
      ],
      config,
      1000,
    );
    // Weighted toward the accurate (lat 0) fix: well under the midpoint of 5.
    expect(result!.latitude).toBeLessThan(1);
  });

  it('combined horizontal accuracy improves with more fixes', () => {
    const one = aggregateSamples([sample({ accuracy: 10, timestamp: 0 })], config, 0);
    const four = aggregateSamples(
      [
        sample({ accuracy: 10, timestamp: 0 }),
        sample({ accuracy: 10, timestamp: 1 }),
        sample({ accuracy: 10, timestamp: 2 }),
        sample({ accuracy: 10, timestamp: 3 }),
      ],
      config,
      3,
    );
    expect(four!.horizontalAccuracyMeters!).toBeLessThan(one!.horizontalAccuracyMeters!);
    // 4 fixes of 10 m -> 10/sqrt(4) = 5 m.
    expect(four!.horizontalAccuracyMeters!).toBeCloseTo(5, 5);
  });

  it('reports null horizontal accuracy when no fix had accuracy', () => {
    const result = aggregateSamples([sample({ accuracy: null })], config, 0);
    expect(result?.horizontalAccuracyMeters).toBeNull();
  });

  it('averages altitude only over fixes that report it', () => {
    const result = aggregateSamples(
      [
        sample({ altitude: 100, altitudeAccuracy: 5, timestamp: 0 }),
        sample({ altitude: null, timestamp: 1 }),
      ],
      config,
      1,
    );
    expect(result?.altitude).toBeCloseTo(100, 6);
  });

  it('returns null altitude when no fix reports it', () => {
    const result = aggregateSamples([sample({ altitude: null })], config, 0);
    expect(result?.altitude).toBeNull();
  });

  it('counts rejected outliers without dropping the result', () => {
    const result = aggregateSamples(
      [sample({ timestamp: 0 }), sample({ accuracy: 999, timestamp: 1 })],
      config,
      1,
    );
    expect(result?.sampleCount).toBe(1);
    expect(result?.rejectedCount).toBe(1);
  });

  it('confidence increases with elapsed time (fixed accuracy + samples)', () => {
    const samples = Array.from({ length: 60 }, (_, i) =>
      sample({ accuracy: 5, timestamp: i }),
    );
    const early = aggregateSamples(samples, config, 10_000)!;
    const late = aggregateSamples(samples, config, 120_000)!;
    expect(late.confidence).toBeGreaterThan(early.confidence);
  });

  it('confidence increases with sample count (fixed accuracy + time)', () => {
    const few = aggregateSamples(
      [sample({ timestamp: 0 }), sample({ timestamp: 120_000 })],
      config,
      120_000,
    )!;
    const many = aggregateSamples(
      Array.from({ length: 60 }, (_, i) => sample({ timestamp: i === 59 ? 120_000 : 0 })),
      config,
      120_000,
    )!;
    expect(many.confidence).toBeGreaterThanOrEqual(few.confidence);
  });

  it('grows slowly early (eased): half-time + half-samples is well under 50%', () => {
    // Half the target samples, spanning half the target time, with good accuracy.
    const half = config.targetSamples / 2;
    const samples = Array.from({ length: half }, (_, i) =>
      sample({ accuracy: 3, timestamp: i === half - 1 ? config.targetMs / 2 : 0 }),
    );
    const result = aggregateSamples(samples, config, config.targetMs / 2)!;
    // Linear base would be 0.5 -> 50%; the easing exponent pulls it well below.
    expect(result.confidence).toBeLessThan(30);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('reaches ~100 only at target time AND target samples with good accuracy', () => {
    const samples = Array.from({ length: config.targetSamples }, (_, i) =>
      sample({ accuracy: 3, timestamp: i === config.targetSamples - 1 ? config.targetMs : 0 }),
    );
    const result = aggregateSamples(samples, config, config.targetMs)!;
    expect(result.confidence).toBe(100);
  });

  it('marks stable once minMs and minSamples are reached', () => {
    const samples = Array.from({ length: config.minSamples }, (_, i) =>
      sample({ timestamp: i === config.minSamples - 1 ? config.minMs : 0 }),
    );
    const result = aggregateSamples(samples, config, config.minMs)!;
    expect(result.isStable).toBe(true);
  });

  it('is not stable before the minimums', () => {
    const result = aggregateSamples([sample({ timestamp: 0 })], config, 1000)!;
    expect(result.isStable).toBe(false);
  });

  it('defaults elapsed time to the last sample timestamp when now is omitted', () => {
    const result = aggregateSamples(
      [sample({ timestamp: 1000 }), sample({ timestamp: 5000 })],
      config,
    )!;
    expect(result.elapsedMs).toBe(4000);
  });
});
