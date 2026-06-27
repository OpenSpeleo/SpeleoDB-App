/**
 * Pure helpers for GPS track colors.
 *
 * Local recordings are assigned a palette color at finalize time so their map
 * line is colored before upload and the edit picker has a sensible starting
 * point. The palette mirrors the server `ColorPalette` (see constants), so a
 * locally-chosen color matches what the backend would have assigned. Kept free
 * of React/storage so it is trivially testable.
 */

import { GPS } from '../constants';

export const TRACK_COLOR_PALETTE: readonly string[] = GPS.TRACK_COLOR_PALETTE;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** True for a valid `#rrggbb` hex color. */
export function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value.trim());
}

/** Lowercase a valid hex color, or return `fallback` when invalid. */
export function normalizeHexColor(value: unknown, fallback: string = TRACK_COLOR_PALETTE[0]): string {
  return isValidHexColor(value) ? value.trim().toLowerCase() : fallback;
}

/** Pick a random color from the palette (used for a new local recording). */
export function randomTrackColor(): string {
  const index = Math.floor(Math.random() * TRACK_COLOR_PALETTE.length);
  return TRACK_COLOR_PALETTE[Math.min(index, TRACK_COLOR_PALETTE.length - 1)];
}
