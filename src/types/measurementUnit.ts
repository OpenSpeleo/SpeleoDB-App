export type MeasurementUnit = 'feet' | 'meters';

export const DEFAULT_MEASUREMENT_UNIT: MeasurementUnit = 'meters';

export function isMeasurementUnit(value: unknown): value is MeasurementUnit {
  return value === 'feet' || value === 'meters';
}
