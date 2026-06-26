import type { MeasurementUnit } from '../types/measurementUnit';

export const FEET_TO_METERS = 0.3048;
const FEET_PER_MILE = 5280;
const METERS_PER_KILOMETER = 1000;

// JS Math.round ties toward +Infinity: Math.round(-0.5) === 0, not -1.
// Split positive/negative so rounding is symmetric around zero.
function roundToTenths(value: number): number {
  if (value >= 0) {
    return Math.round(value * 10) / 10;
  }
  return -Math.round(Math.abs(value) * 10) / 10;
}

export function convertFeetToMeters(valueFeet: number): number {
  return valueFeet * FEET_TO_METERS;
}

export function formatDepthValue(valueFeet: number | null, unit: MeasurementUnit): string {
  if (valueFeet === null || !Number.isFinite(valueFeet)) {
    return 'N/A';
  }

  const converted = unit === 'meters' ? convertFeetToMeters(valueFeet) : valueFeet;
  const rounded = roundToTenths(converted);
  const suffix = unit === 'meters' ? 'm' : 'ft';

  if (Math.abs(rounded - Math.round(rounded)) < 0.0001) {
    return `${Math.round(rounded)} ${suffix}`;
  }
  return `${rounded.toFixed(1)} ${suffix}`;
}

/**
 * Format a GPS accuracy given in METERS for display. Unlike `formatDistanceValue`
 * (whose input is feet), GPS accuracy comes from the platform in meters, so this
 * takes meters directly and keeps sub-meter (tenths) precision in both unit
 * systems. Used by the averaging UI for horizontal/vertical accuracy.
 */
export function formatAccuracyValue(valueMeters: number | null, unit: MeasurementUnit): string {
  if (valueMeters === null || !Number.isFinite(valueMeters) || valueMeters < 0) {
    return 'N/A';
  }
  const suffix = unit === 'meters' ? 'm' : 'ft';
  const value = unit === 'meters' ? valueMeters : valueMeters / FEET_TO_METERS;
  const rounded = roundToTenths(value);
  // A non-zero accuracy that rounds to 0 must not read as "0" (perfect); show a
  // sub-decimeter floor instead so the user sees it is just very small.
  if (value > 0 && rounded === 0) {
    return `<0.1 ${suffix}`;
  }
  return `${rounded} ${suffix}`;
}

export function formatDistanceValue(valueFeet: number, unit: MeasurementUnit): string {
  const converted = unit === 'meters' ? convertFeetToMeters(valueFeet) : valueFeet;
  if (!Number.isFinite(converted)) {
    return 'N/A';
  }

  if (unit === 'meters') {
    if (converted >= METERS_PER_KILOMETER) {
      const km = converted / METERS_PER_KILOMETER;
      if (km < 10) {
        return `${km.toFixed(1)} km`;
      }
      return `${Math.round(km)} km`;
    }
    return `${Math.round(converted)} m`;
  }

  if (converted >= FEET_PER_MILE) {
    const miles = converted / FEET_PER_MILE;
    if (miles < 10) {
      return `${miles.toFixed(1)} mi`;
    }
    return `${Math.round(miles)} mi`;
  }
  return `${Math.round(converted)} ft`;
}
