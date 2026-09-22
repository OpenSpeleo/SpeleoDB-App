import { describe, expect, it } from 'vitest';
import {
  applyDepthLimit,
  formatDepthLimitInput,
  formatDepthLimitLabel,
  formatLimitedDepthValue,
  isValidDepthLimit,
  parseDepthLimitInput,
} from './depthLimit';

describe('depth limit', () => {
  it('fixes the scale above or below measured depth without mutating the source domain', () => {
    const measured = Object.freeze({ min: 0, max: 80 });
    expect(applyDepthLimit(measured, 20)).toEqual({ min: 0, max: 20 });
    expect(applyDepthLimit(measured, 120)).toEqual({ min: 0, max: 120 });
    expect(applyDepthLimit(measured, null)).toBe(measured);
    expect(applyDepthLimit(measured, Number.NaN)).toBe(measured);
    expect(applyDepthLimit(null, 20)).toBeNull();
    expect(measured.max).toBe(80);
  });

  it.each([0, -1, Number.NaN, Infinity, -Infinity, '20', undefined, {}, []])('rejects invalid persisted limit %s', (value) => {
    expect(isValidDepthLimit(value)).toBe(false);
  });

  it('parses positive decimals in either input unit and blank as full range', () => {
    expect(parseDepthLimitInput('  ', 'feet')).toEqual({ valid: true, value: null });
    expect(parseDepthLimitInput(' 30.48 ', 'meters')).toEqual({ valid: true, value: 100 });
    expect(parseDepthLimitInput('30,48', 'meters')).toEqual({ valid: true, value: 100 });
    expect(parseDepthLimitInput('.25', 'feet')).toEqual({ valid: true, value: 0.25 });
    expect(parseDepthLimitInput('+1.25e2', 'feet')).toEqual({ valid: true, value: 125 });
    expect(parseDepthLimitInput('1e-8', 'feet')).toEqual({ valid: true, value: 1e-8 });
  });

  it.each(['0', '-5', 'Infinity', 'NaN', '1e309', '0x10', '12m', '1,2.3', '1,2,3', '1 000', '.', '1e', '--2'])('rejects an invalid numeric draft %s', (draft) => {
    expect(parseDepthLimitInput(draft, 'meters')).toEqual({ valid: false });
  });

  it('rejects canonical-feet overflow during metric conversion', () => {
    expect(parseDepthLimitInput('1e308', 'meters')).toEqual({ valid: false });
  });

  it('retains fractional and small limits instead of rounding to the normal gauge precision', () => {
    const enteredMeters = parseDepthLimitInput('30', 'meters');
    expect(enteredMeters.valid).toBe(true);
    if (!enteredMeters.valid || enteredMeters.value === null) throw new Error('Expected a valid physical limit');
    expect(formatDepthLimitInput(enteredMeters.value, 'meters')).toBe('30');
    expect(formatDepthLimitLabel(enteredMeters.value, 'meters')).toBe('30 m');
    expect(formatDepthLimitInput(100, 'meters')).toBe('30.48');
    expect(formatDepthLimitLabel(100, 'meters')).toBe('30.48 m');
    expect(formatDepthLimitLabel(0.04, 'feet')).toBe('0.04 ft');
    expect(formatDepthLimitLabel(0.1234567891239, 'feet')).toBe('0.1234567891239 ft');
    expect(Number(formatDepthLimitInput(0.1234567891239, 'meters'))).toBeLessThanOrEqual(0.1234567891239 * 0.3048);
    expect(formatDepthLimitInput(0.00004, 'feet')).toBe('0.00004');
    expect(formatDepthLimitLabel(0, 'feet')).toBe('N/A');
  });

  it('upper-bounds readouts without changing signed depths or rounding above the maximum', () => {
    expect(formatLimitedDepthValue(100, 0.04, 'feet')).toBe('0.04 ft');
    expect(formatLimitedDepthValue(9.96, 9.99, 'feet')).toBe('9.99 ft');
    expect(formatLimitedDepthValue(-22, 10, 'feet')).toBe('-22 ft');
    expect(formatLimitedDepthValue(50, null, 'meters')).toBe('15.2 m');
    expect(formatLimitedDepthValue(50, 100, 'meters')).toBe('15.2 m');
    expect(formatLimitedDepthValue(100, 100, 'meters')).toBe('30.48 m');
  });
});
