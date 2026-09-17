import { useCallback, useSyncExternalStore } from 'react';
import { EMPTY_GIS_GEOMETRY_SNAPSHOT, type GisGeometrySnapshot } from '../types/gisGeometry';

export interface GisGeometrySubscriptionSource {
  readonly gisGeometrySnapshot: GisGeometrySnapshot;
  subscribeGisGeometries(listener: () => void): () => void;
}

/** Geometry publications bypass the app-wide context, like offline-map progress. */
export function useGisGeometries(source: GisGeometrySubscriptionSource): GisGeometrySnapshot {
  const subscribe = useCallback(
    (listener: () => void) => source.subscribeGisGeometries?.(listener) ?? (() => {}),
    [source],
  );
  const getSnapshot = useCallback(
    () => source.gisGeometrySnapshot ?? EMPTY_GIS_GEOMETRY_SNAPSHOT,
    [source],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}
