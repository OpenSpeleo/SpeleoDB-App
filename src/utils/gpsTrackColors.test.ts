import { describe, it, expect } from 'vitest';
import {
  TRACK_COLOR_PALETTE,
  isValidHexColor,
  normalizeHexColor,
  randomTrackColor,
} from './gpsTrackColors';

describe('gpsTrackColors', () => {
  it('validates #rrggbb hex colors', () => {
    expect(isValidHexColor('#e41a1c')).toBe(true);
    expect(isValidHexColor('#ABCDEF')).toBe(true);
    expect(isValidHexColor('e41a1c')).toBe(false);
    expect(isValidHexColor('#fff')).toBe(false);
    expect(isValidHexColor('#zzzzzz')).toBe(false);
    expect(isValidHexColor(42)).toBe(false);
    expect(isValidHexColor(null)).toBe(false);
  });

  it('normalizes to lowercase or falls back', () => {
    expect(normalizeHexColor('#ABCDEF')).toBe('#abcdef');
    expect(normalizeHexColor('  #E41A1C  ')).toBe('#e41a1c');
    expect(normalizeHexColor('nope')).toBe(TRACK_COLOR_PALETTE[0]);
    expect(normalizeHexColor(undefined, '#123456')).toBe('#123456');
  });

  it('picks a palette color at random', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(TRACK_COLOR_PALETTE).toContain(randomTrackColor());
    }
  });
});
