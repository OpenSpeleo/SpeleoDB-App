/**
 * Generate a RFC-4122 v4 UUID, falling back to a time+random token when
 * `crypto.randomUUID` is unavailable (older WebViews). IO-free and reusable.
 */
export function generateUuid(): string {
  const cryptoObj =
    typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  const rand = Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${rand}-${Math.random().toString(36).slice(2)}`;
}
