/**
 * Shared helpers for the OS share sheet (`@capacitor/share`).
 *
 * The native share plugin rejects with a "cancel"-flavored error when the user
 * dismisses the sheet without choosing a target. That is a normal outcome, not
 * a failure, so callers swallow it. Centralized here so every share call-site
 * classifies cancellation the same way.
 */
export function isShareCancellation(error: unknown): boolean {
  const isCancellationMessage = (message: string): boolean => {
    const normalized = message.trim().toLowerCase();
    return (
      /^cancel(?:led|ed)?$/.test(normalized) ||
      /^(share|sharing)( was)? cancel(?:led|ed)$/.test(normalized) ||
      /^user cancel(?:led|ed)( the share)?$/.test(normalized)
    );
  };
  if (typeof error === 'string') {
    return isCancellationMessage(error);
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' && isCancellationMessage(message);
  }
  return false;
}
