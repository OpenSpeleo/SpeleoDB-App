import { describe, it, expect } from 'vitest';
import {
  TRACK_COLOR_PALETTE,
  isValidHexColor,
  normalizeHexColor,
  randomTrackColor,
  readableInkColor,
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

  it('chooses readable ink for dark and light swatches', () => {
    // Dark/saturated backgrounds -> white ink.
    expect(readableInkColor('#e41a1c')).toBe('#ffffff'); // red
    expect(readableInkColor('#377eb8')).toBe('#ffffff'); // blue
    expect(readableInkColor('#000000')).toBe('#ffffff');
    // Light backgrounds -> black ink.
    expect(readableInkColor('#ffff33')).toBe('#000000'); // yellow
    expect(readableInkColor('#a6d854')).toBe('#000000'); // light green
    expect(readableInkColor('#ffffff')).toBe('#000000');
    // Every palette color resolves to one of the two inks.
    for (const color of TRACK_COLOR_PALETTE) {
      expect(['#000000', '#ffffff']).toContain(readableInkColor(color));
    }
  });

  it('falls back to white ink for unparseable input', () => {
    expect(readableInkColor('nope')).toBe('#ffffff');
    expect(readableInkColor('#fff')).toBe('#ffffff');
    expect(readableInkColor(undefined)).toBe('#ffffff');
    expect(readableInkColor(123)).toBe('#ffffff');
  });
});
