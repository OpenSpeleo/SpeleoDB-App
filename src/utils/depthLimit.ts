import type { MeasurementUnit } from '../types/measurementUnit';
import type { DepthDomain } from './depthColoring';
import { FEET_TO_METERS, formatDepthValue } from './measurementUnits';

export function isValidDepthLimit(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0);
}

/** A configured maximum fixes the color scale without changing measured depths. */
export function applyDepthLimit(domain: DepthDomain | null, limitFeet: number | null): DepthDomain | null {
  if (!domain) return null;
  return limitFeet !== null && isValidDepthLimit(limitFeet)
    ? { min: 0, max: limitFeet }
    : domain;
}

function depthInUnit(feet: number, unit: MeasurementUnit): number {
  return unit === 'meters' ? feet * FEET_TO_METERS : feet;
}

/** Formatting never writes back into canonical feet; repeated unit switches are lossless. */
export function formatDepthLimitInput(feet: number, unit: MeasurementUnit): string {
  if (!isValidDepthLimit(feet)) return '';
  // Drop conversion noise while retaining small/fractional caps that one decimal hides.
  const exact = depthInUnit(feet, unit);
  const compact = Number(exact.toPrecision(12));
  // A metric round trip can land one floating-point step below the entered
  // value (30 m becomes 29.999999999999996). Remove only that arithmetic noise;
  // a materially higher rounded fractional cap must keep its exact precision.
  const conversionRoundoff = Math.abs(exact) * Number.EPSILON * 4;
  return (compact - exact > conversionRoundoff ? exact : compact).toString();
}

export function formatDepthLimitLabel(feet: number, unit: MeasurementUnit): string {
  const value = formatDepthLimitInput(feet, unit);
  return value ? `${value} ${unit === 'meters' ? 'm' : 'ft'}` : 'N/A';
}

export type ParsedDepthLimit = { valid: true; value: number | null } | { valid: false };

/** Decimal comma is accepted; grouping separators, units and partial numbers are not. */
export function parseDepthLimitInput(draft: string, unit: MeasurementUnit): ParsedDepthLimit {
  const trimmed = draft.trim();
  if (!trimmed) return { valid: true, value: null };
  if (!/^\+?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    return { valid: false };
  }
  const input = Number(trimmed.replace(',', '.'));
  const feet = unit === 'meters' ? input / FEET_TO_METERS : input;
  return isValidDepthLimit(feet) ? { valid: true, value: feet } : { valid: false };
}

/** Only the upper reading is limited; signed depths retain their existing meaning. */
export function formatLimitedDepthValue(
  feet: number,
  limitFeet: number | null,
  unit: MeasurementUnit,
): string {
  if (limitFeet === null || !isValidDepthLimit(limitFeet)) return formatDepthValue(feet, unit);
  const limited = Math.min(feet, limitFeet);
  const displayed = depthInUnit(limited, unit);
  const maximum = depthInUnit(limitFeet, unit);
  if (limited === limitFeet || (displayed >= 0 && Math.round(displayed * 10) / 10 > maximum)) {
    return formatDepthLimitLabel(limitFeet, unit);
  }
  return formatDepthValue(limited, unit);
}
