import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { createLandmarkIconRegistry } from '@speleodb/map-viewer/landmark-icons';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const NO_IMAGES: readonly string[] = [];

/** Map/style lifecycle is local; shared registry owns image preparation and reuse. */
export function useLandmarkMapIcons(mapRef: RefObject<MapRef | null>, data = EMPTY) {
  const [available, setAvailable] = useState<readonly string[]>(NO_IMAGES);
  const currentData = useRef(data);
  const owned = useRef<{
    map: ReturnType<MapRef['getMap']>;
    registry: ReturnType<typeof createLandmarkIconRegistry>;
  } | null>(null);
  const load = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (owned.current?.map !== map) {
      owned.current?.registry.dispose();
      const registry = createLandmarkIconRegistry(map, () => {
        if (owned.current?.registry === registry) setAvailable(registry.getAvailableImageIds());
      });
      owned.current = { map, registry };
      setAvailable(registry.getAvailableImageIds());
    }
    void owned.current.registry.prepare(currentData.current);
  }, [mapRef]);
  useLayoutEffect(() => {
    currentData.current = data;
    if (owned.current) void owned.current.registry.prepare(data);
  }, [data]);
  useLayoutEffect(() => () => {
    owned.current?.registry.dispose();
    owned.current = null;
  }, []);
  return { available, load };
}
