/**
 * Landmark collection grouping (read-only, derived entirely from the cached
 * landmarks GeoJSON FeatureCollection).
 *
 * The backend `/api/v2/landmarks/geojson/` endpoint embeds collection metadata
 * on every feature (`collection`, `collection_name`, `collection_color`,
 * `collection_type`, `is_personal_collection`). Because all of that travels
 * with the cached payload, the app can build the full collection grouping for
 * the Landmark panel offline without any extra endpoint, cache key, or sync.
 *
 * Mirrors the web map viewer's `LandmarkUI.getLandmarkCollectionGroups`:
 * personal collections first, then alphabetical; landmarks alphabetical within
 * each group; safe color fallback.
 */

import { COLORS } from '../constants';
import { buildLandmarkCollectionGroups as buildGroups } from '@speleodb/map-core/landmarks';
export type { LandmarkListItem, LandmarkCollectionGroup } from '@speleodb/map-core/landmarks';

export function buildLandmarkCollectionGroups(featureCollection: GeoJSON.FeatureCollection | null | undefined) {
  return buildGroups(featureCollection, COLORS.FALLBACK);
}
