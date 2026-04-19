import { describe, it, expect } from 'vitest';
import { countryFlag } from './countryFlag';

describe('countryFlag', () => {
  it('returns the FR flag for "FR"', () => {
    expect(countryFlag('FR')).toBe('🇫🇷');
  });

  it('returns the US flag for "US"', () => {
    expect(countryFlag('US')).toBe('🇺🇸');
  });

  it('uppercases lowercase codes', () => {
    expect(countryFlag('us')).toBe('🇺🇸');
    expect(countryFlag('fr')).toBe('🇫🇷');
  });

  it.each(['', null, undefined, 'F', 'FRA', 'F1', '12', 'F!'])(
    'returns "" for invalid input %p',
    (input) => {
      expect(countryFlag(input as string | null | undefined)).toBe('');
    },
  );

  it('returns "" for non-string inputs', () => {
    expect(countryFlag(42 as unknown as string)).toBe('');
    expect(countryFlag({} as unknown as string)).toBe('');
  });
});
