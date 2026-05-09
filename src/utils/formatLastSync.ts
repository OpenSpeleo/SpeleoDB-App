/**
 * Formats a "last sync" timestamp for display in the UI.
 *
 * - `null` (never synced) -> 'Never'
 * - finite epoch ms -> device-locale absolute date+time
 *   (e.g. "Apr 18, 2026, 2:30 PM" depending on locale)
 *
 * The format intentionally uses absolute time (not relative) so the user can
 * always read the exact wall-clock time of the last successful project-list
 * refresh, even if they have been offline for a long stretch.
 */
export function formatLastSync(epochMs: number | null | undefined): string {
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs) || epochMs <= 0) {
    return 'Never';
  }

  try {
    return new Date(epochMs).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    // Fallback for environments without Intl support.
    return new Date(epochMs).toString();
  }
}
