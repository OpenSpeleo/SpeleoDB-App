/**
 * Pure GPS averaging math.
 *
 * Aggregates a stream of position fixes into a single high-confidence point
 * using inverse-variance weighting (more accurate fixes count more), and models
 * a 0-100 confidence that grows with elapsed time and sample count and is
 * scaled by the achieved horizontal accuracy. Deterministic and IO-free so it
 * can be exhaustively unit-tested. See docs/gps-tracks.md.
 */

import { GPS } from '../constants';

// ==================== Shapes ====================

export interface AccuracySample {
  latitude: number;
  longitude: number;
  altitude?: number | null;
  /** Horizontal accuracy in meters (radius). */
  accuracy?: number | null;
  altitudeAccuracy?: number | null;
  /** Epoch ms. */
  timestamp: number;
}

export interface AveragingConfig {
  minMs: number;
  targetMs: number;
  minSamples: number;
  targetSamples: number;
  /** Reject samples with horizontal accuracy worse than this (meters). */
  maxAccuracyMeters: number;
  goodAccuracyMeters: number;
  poorAccuracyMeters: number;
  accuracyFloorScore: number;
  /** Easing exponent (>= 1) applied to the time+sample progress base. */
  confidenceExponent: number;
}

export interface AveragingResult {
  latitude: number;
  longitude: number;
  altitude: number | null;
  /** Aggregated horizontal accuracy (meters); null when no fix had accuracy. */
  horizontalAccuracyMeters: number | null;
  /** Aggregated vertical accuracy (meters); null when unavailable. */
  verticalAccuracyMeters: number | null;
  sampleCount: number;
  /** Samples rejected as outliers / invalid. */
  rejectedCount: number;
  elapsedMs: number;
  /** Integer 0-100. */
  confidence: number;
  /** True once minMs + minSamples are both reached (safe to save). */
  isStable: boolean;
}

export const DEFAULT_AVERAGING_CONFIG: AveragingConfig = {
  minMs: GPS.AVERAGING_MIN_MS,
  targetMs: GPS.AVERAGING_TARGET_MS,
  minSamples: GPS.AVERAGING_MIN_SAMPLES,
  targetSamples: GPS.AVERAGING_TARGET_SAMPLES,
  maxAccuracyMeters: GPS.AVERAGING_MAX_ACCURACY_METERS,
  goodAccuracyMeters: GPS.AVERAGING_GOOD_ACCURACY_METERS,
  poorAccuracyMeters: GPS.AVERAGING_POOR_ACCURACY_METERS,
  accuracyFloorScore: GPS.AVERAGING_ACCURACY_FLOOR_SCORE,
  confidenceExponent: GPS.AVERAGING_CONFIDENCE_EXPONENT,
};

// ==================== Helpers ====================

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function isFiniteCoord(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Whether a fix should be kept (valid coords + accuracy within the cap). */
export function isAcceptableSample(sample: AccuracySample, config: AveragingConfig): boolean {
  if (!sample || !isFiniteCoord(sample.latitude) || !isFiniteCoord(sample.longitude)) {
    return false;
  }
  if (sample.latitude < -90 || sample.latitude > 90) return false;
  if (sample.longitude < -180 || sample.longitude > 180) return false;
  const acc = sample.accuracy;
  if (acc !== null && acc !== undefined) {
    if (!Number.isFinite(acc) || acc < 0) return false;
    if (acc > config.maxAccuracyMeters) return false;
  }
  return true;
}

/**
 * Map a horizontal accuracy (meters) to a 0..1 quality score: 1.0 at/under
 * `goodAccuracyMeters`, the floor at/over `poorAccuracyMeters`, linear between.
 * Unknown accuracy is treated as the midpoint so a confidence can still grow.
 */
export function accuracyScore(
  accuracyMeters: number | null,
  config: AveragingConfig,
): number {
  if (accuracyMeters === null || !Number.isFinite(accuracyMeters)) {
    return (1 + config.accuracyFloorScore) / 2;
  }
  if (accuracyMeters <= config.goodAccuracyMeters) return 1;
  if (accuracyMeters >= config.poorAccuracyMeters) return config.accuracyFloorScore;
  const span = config.poorAccuracyMeters - config.goodAccuracyMeters;
  const t = (accuracyMeters - config.goodAccuracyMeters) / span;
  return 1 - t * (1 - config.accuracyFloorScore);
}

// ==================== Aggregate ====================

/**
 * Aggregate raw samples into a single averaged point + confidence.
 *
 * @param samples  All collected fixes (rejection happens here).
 * @param config   Averaging policy.
 * @param nowMs    Optional clock for elapsed time; defaults to the last
 *                 accepted sample's timestamp so the function stays pure.
 */
export function aggregateSamples(
  samples: readonly AccuracySample[],
  config: AveragingConfig = DEFAULT_AVERAGING_CONFIG,
  nowMs?: number,
): AveragingResult | null {
  const accepted = samples.filter((s) => isAcceptableSample(s, config));
  const rejectedCount = samples.length - accepted.length;
  if (accepted.length === 0) return null;

  let weightSum = 0;
  let latSum = 0;
  let lonSum = 0;
  // Altitude is averaged only over fixes that report it.
  let altWeightSum = 0;
  let altSum = 0;
  let vAccWeightSum = 0;
  let vVarInvSum = 0;
  let firstTs = Number.POSITIVE_INFINITY;
  let lastTs = Number.NEGATIVE_INFINITY;

  for (const s of accepted) {
    const acc = s.accuracy !== null && s.accuracy !== undefined && s.accuracy > 0 ? s.accuracy : null;
    // Inverse-variance weight; fixes without accuracy get unit weight.
    const weight = acc ? 1 / (acc * acc) : 1;
    weightSum += weight;
    latSum += s.latitude * weight;
    lonSum += s.longitude * weight;

    if (s.altitude !== null && s.altitude !== undefined && Number.isFinite(s.altitude)) {
      const vAcc =
        s.altitudeAccuracy !== null &&
        s.altitudeAccuracy !== undefined &&
        Number.isFinite(s.altitudeAccuracy) &&
        s.altitudeAccuracy > 0
          ? s.altitudeAccuracy
          : null;
      const altWeight = vAcc ? 1 / (vAcc * vAcc) : 1;
      altWeightSum += altWeight;
      altSum += s.altitude * altWeight;
      if (vAcc) vVarInvSum += 1 / (vAcc * vAcc);
    }

    if (s.altitudeAccuracy && Number.isFinite(s.altitudeAccuracy) && s.altitudeAccuracy > 0) {
      vAccWeightSum += 1;
    }

    if (s.timestamp < firstTs) firstTs = s.timestamp;
    if (s.timestamp > lastTs) lastTs = s.timestamp;
  }

  const latitude = latSum / weightSum;
  const longitude = lonSum / weightSum;
  const altitude = altWeightSum > 0 ? altSum / altWeightSum : null;

  // Combined horizontal uncertainty: inverse-variance combination of the
  // reported accuracies. Only meaningful when at least one fix reported it.
  const hadHorizontalAccuracy = accepted.some(
    (s) => s.accuracy !== null && s.accuracy !== undefined && s.accuracy > 0,
  );
  const horizontalAccuracyMeters = hadHorizontalAccuracy
    ? Math.sqrt(1 / accepted.reduce((sum, s) => {
        const acc = s.accuracy && s.accuracy > 0 ? s.accuracy : null;
        return acc ? sum + 1 / (acc * acc) : sum;
      }, 0))
    : null;

  const verticalAccuracyMeters = vAccWeightSum > 0 && vVarInvSum > 0 ? Math.sqrt(1 / vVarInvSum) : null;

  const elapsedMs = Math.max(
    0,
    (Number.isFinite(nowMs as number) ? (nowMs as number) : lastTs) - firstTs,
  );

  const timeProgress = clamp01(elapsedMs / config.targetMs);
  const sampleProgress = clamp01(accepted.length / config.targetSamples);
  // Eased base: an exponent > 1 keeps confidence low early and only lets it
  // climb as both time and samples approach their targets, so it does not race
  // to a high value in the first few seconds.
  const linearBase = 0.5 * timeProgress + 0.5 * sampleProgress;
  const base = Math.pow(linearBase, Math.max(1, config.confidenceExponent));
  const score = accuracyScore(horizontalAccuracyMeters, config);
  const confidence = Math.round(clamp01(base * score) * 100);

  const isStable = elapsedMs >= config.minMs && accepted.length >= config.minSamples;

  return {
    latitude,
    longitude,
    altitude,
    horizontalAccuracyMeters,
    verticalAccuracyMeters,
    sampleCount: accepted.length,
    rejectedCount,
    elapsedMs,
    confidence,
    isStable,
  };
}
