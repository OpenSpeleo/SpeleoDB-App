/** Artifact revisions are opaque server identifiers, independent of signed URLs. */
export function normalizeGeoJSONRevision(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
