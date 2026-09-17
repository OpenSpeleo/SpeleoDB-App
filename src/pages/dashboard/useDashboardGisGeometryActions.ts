import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import type { GisGeometryMapRecord, GisGeometrySnapshot, GisGeometryShape } from '../../types/gisGeometry';
import { clampWebMercatorLatitude } from '../../utils/geographicBounds';
import { zoomToMapBounds } from '../../utils/mapCamera';
import { useMountedRef } from '../../hooks/useMountedRef';

interface GeometrySource {
  readonly gisGeometrySnapshot: GisGeometrySnapshot;
  getGisGeometryDetail(id: string): Promise<GisGeometryMapRecord>;
}
interface Options {
  source: GeometrySource;
  snapshot: GisGeometrySnapshot;
  mapRef: RefObject<MapRef | null>;
  panelActive: boolean;
  onClosePanel(): void;
}
interface VisibilityIntent {
  scope: string | null;
  values: Readonly<Record<string, boolean>>;
}
const HIDDEN: Readonly<Record<string, boolean>> = Object.freeze({});
const EMPTY_FEATURES: GeoJSON.FeatureCollection<GisGeometryShape> = { type: 'FeatureCollection', features: [] };

/** Display intent is session-only; the coordinator remains the sole geometry owner. */
export function useDashboardGisGeometryActions({
  source, snapshot, mapRef, panelActive, onClosePanel,
}: Options) {
  const [intent, setIntent] = useState<VisibilityIntent>({ scope: null, values: HIDDEN });
  const intentRef = useRef(intent);
  const zoomRef = useRef<{ id: string; token: symbol } | null>(null);
  const panelActiveRef = useRef(panelActive);
  const mounted = useMountedRef();
  useLayoutEffect(() => {
    panelActiveRef.current = panelActive;
    if (!panelActive) zoomRef.current = null;
  }, [panelActive]);
  const visibility = intent.scope === snapshot.scope ? intent.values : HIDDEN;

  const setVisibility = useCallback((updates: Record<string, boolean>) => {
    const scope = source.gisGeometrySnapshot.scope;
    const previous = intentRef.current;
    const next = { scope, values: { ...(previous.scope === scope ? previous.values : HIDDEN), ...updates } };
    intentRef.current = next;
    setIntent(next);
    const selected = zoomRef.current;
    if (selected && updates[selected.id] === false) zoomRef.current = null;
  }, [source]);

  const requestDetail = useCallback((id: string) => {
    // The coordinator publishes a safe, per-row error before rejecting. Never
    // replace its newer state or change visibility in a request completion.
    void source.getGisGeometryDetail(id).catch(() => {});
  }, [source]);
  const toggle = useCallback((id: string, visible: boolean) => {
    setVisibility({ [id]: visible });
    if (visible) requestDetail(id);
  }, [requestDetail, setVisibility]);
  const showAll = useCallback(() => {
    const ids = source.gisGeometrySnapshot.items.map(item => item.id);
    setVisibility(Object.fromEntries(ids.map(id => [id, true])));
    ids.forEach(requestDetail);
  }, [requestDetail, setVisibility, source]);
  const hideAll = useCallback(() => {
    zoomRef.current = null;
    setVisibility(Object.fromEntries(source.gisGeometrySnapshot.items.map(item => [item.id, false])));
  }, [setVisibility, source]);

  const zoom = useCallback((id: string) => {
    setVisibility({ [id]: true });
    const scope = source.gisGeometrySnapshot.scope;
    const token = Symbol(id);
    zoomRef.current = { id, token };
    void (async () => {
      try { await source.getGisGeometryDetail(id); } catch { return; }
      if (!mounted.current || !panelActiveRef.current || zoomRef.current?.token !== token) return;
      const current = source.gisGeometrySnapshot;
      const latestIntent = intentRef.current;
      if (current.scope !== scope || latestIntent.scope !== scope || !latestIntent.values[id]) return;
      const item = current.items.find(item => item.id === id);
      const record = current.records[id];
      const map = mapRef.current;
      if (!item || !record || record.detail.revision !== item.revision || !map) return;
      zoomRef.current = null;
      onClosePanel();
      const { west, east, south, north } = record.bounds;
      zoomToMapBounds(map, [
        [west, clampWebMercatorLatitude(south)],
        [east, clampWebMercatorLatitude(north)],
      ]);
    })();
  }, [mapRef, mounted, onClosePanel, setVisibility, source]);

  const featureCollection = useMemo<GeoJSON.FeatureCollection<GisGeometryShape>>(() => {
    const features = snapshot.items.flatMap(item => {
      const record = snapshot.records[item.id];
      if (!visibility[item.id] || !record || record.detail.revision !== item.revision) return [];
      return [{ ...record.feature, properties: { name: item.name, color: item.color } }];
    });
    // Automatic preparation of hidden records must not repeatedly update the
    // map worker with new, empty GeoJSON objects.
    return features.length ? { type: 'FeatureCollection', features } : EMPTY_FEATURES;
  }, [snapshot.items, snapshot.records, visibility]);
  return {
    visibility, featureCollection, toggle, showAll, hideAll, zoom,
    retry: requestDetail,
    visibleCount: featureCollection.features.length,
  };
}
