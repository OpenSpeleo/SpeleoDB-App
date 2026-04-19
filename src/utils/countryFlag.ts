/**
 * Convert an ISO 3166-1 alpha-2 country code to its flag emoji.
 *
 * Mirrors the web map viewer's `Utils.countryFlag` so the project panel
 * renders the same per-country flag in both clients. Returns `''` for
 * any input that is not exactly two ASCII letters; the panel then falls
 * back to plain text (used for the synthetic `Unknown` group).
 *
 * Example: countryFlag('FR') === '🇫🇷'
 */

const REGIONAL_INDICATOR_BASE = 0x1f1e6;
const ASCII_A = 0x41;

export function countryFlag(code: string | null | undefined): string {
  if (typeof code !== 'string' || code.length !== 2) return '';
  const upper = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return '';
  return String.fromCodePoint(
    upper.charCodeAt(0) - ASCII_A + REGIONAL_INDICATOR_BASE,
    upper.charCodeAt(1) - ASCII_A + REGIONAL_INDICATOR_BASE,
  );
}
