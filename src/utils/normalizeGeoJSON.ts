/**
 * Normalize any valid GeoJSON into a FeatureCollection.
 * Handles: FeatureCollection, Feature, bare Geometry, wrapped payloads,
 * and JSON strings returned by some native transports.
 */
export function normalizeGeoJSON(data: unknown): GeoJSON.FeatureCollection | null {
  let current: unknown = data;

  // Unwrap a few common envelope shapes:
  // - raw JSON string
  // - { data: <geojson> }
  // - { geojson: <geojson> }
  // iOS native HTTP responses can surface JSON as strings.
  for (let i = 0; i < 4; i += 1) {
    if (typeof current === 'string') {
      const trimmed = current.trim();
      if (!trimmed) return null;
      try {
        current = JSON.parse(trimmed);
      } catch {
        return null;
      }
      continue;
    }

    if (!current || typeof current !== 'object') break;
    const envelope = current as Record<string, unknown>;

    if (typeof envelope.type === 'string' || Array.isArray(envelope.features)) {
      break;
    }

    if ('data' in envelope) {
      current = envelope.data;
      continue;
    }

    if ('geojson' in envelope) {
      current = envelope.geojson;
      continue;
    }

    break;
  }

  if (!current || typeof current !== 'object') return null;
  const obj = current as Record<string, unknown>;

  if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
    return obj as unknown as GeoJSON.FeatureCollection;
  }

  // Some payloads omit "type" but still expose a features array.
  if (Array.isArray(obj.features)) {
    return {
      type: 'FeatureCollection',
      features: obj.features as GeoJSON.Feature[],
    };
  }

  // Single Feature -> wrap in a FeatureCollection
  if (obj.type === 'Feature') {
    return {
      type: 'FeatureCollection',
      features: [obj as unknown as GeoJSON.Feature],
    };
  }

  // Bare Geometry -> wrap in Feature -> FeatureCollection
  if (typeof obj.type === 'string' && ('coordinates' in obj || 'geometries' in obj)) {
    return {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: obj as unknown as GeoJSON.Geometry },
      ],
    };
  }

  return null;
}
