import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import type { SpeleoDBController } from '../../controllers/SpeleoDBController';
import { GpxFileService } from '../../services/GpxFileService';
import {
  getGpsTrackVisibilityPreferences,
  setGpsTrackVisibilityPreference,
} from '../../services/PreferencesService';
import type { GpsTrackListItem, RecordedPoint } from '../../types/gpsTrack';
import { errorToLogDetails } from '../../utils/errorDiagnostics';
import { trackPointsToLineStringFeature } from '../../utils/gpsTrackGeoJson';
import { useMountedRef } from '../../hooks/useMountedRef';
import { prepareGpsTrack, type PreparedGpsTrack } from '../../utils/prepareGpsTrack';
import { scheduleViewerUpdate } from '../../utils/scheduleViewerUpdate';
import { yieldToMainThread } from '../../utils/yieldToMainThread';
import { useAppliedViewerState } from '../../hooks/useAppliedViewerState';
import { zoomToMapBounds } from '../../utils/mapCamera';

type TrackController = Pick<
  SpeleoDBController,
  | 'buildGpxFileForTrack'
  | 'getGpsTrackPoints'
  | 'uploadGpsTrack'
  | 'editGpsTrack'
  | 'removeGpsTrack'
  | 'isOfflineLocked'
>;

type Toast = (message: string, tone: 'success' | 'error') => void;
type WarningLogger = (message: string, details: Record<string, unknown>) => void;
type VisibilityWriter = (trackId: string, visible: boolean) => void;
type GpxShareService = Pick<GpxFileService, 'shareGpx'>;

export interface DashboardGpsTrackActionOptions {
  controller: TrackController;
  tracks: readonly GpsTrackListItem[];
  initialVisibility?: Record<string, boolean>;
  panelActive?: boolean;
  runtimeActive?: boolean;
  mapRef: RefObject<MapRef | null>;
  onClosePanel: () => void;
  showToast: Toast;
  gpxShareService?: GpxShareService;
  writeVisibility?: VisibilityWriter;
  warn?: WarningLogger;
}

export interface DashboardGpsTrackActionState {
  trackVisibility: Record<string, boolean>;
  appliedTrackVisibility: Record<string, boolean>;
  loadingTrackIds: Set<string>;
  savedTrackFeatureCollection: GeoJSON.FeatureCollection;
  uploadTarget: GpsTrackListItem | null;
  uploadBusy: boolean;
  deleteTarget: GpsTrackListItem | null;
  deleteBusy: boolean;
  editTarget: GpsTrackListItem | null;
  editName: string;
  editColor: string;
  editBusy: boolean;
  setEditName: (name: string) => void;
  setEditColor: (color: string) => void;
  shareTrack: (track: GpsTrackListItem) => void;
  toggleTrack: (track: GpsTrackListItem, visible: boolean) => void;
  zoomToTrack: (track: GpsTrackListItem) => void;
  cancelPendingZoom: () => void;
  openUpload: (track: GpsTrackListItem) => void;
  cancelUpload: () => void;
  confirmUpload: () => void;
  openEdit: (track: GpsTrackListItem) => void;
  cancelEdit: () => void;
  confirmEdit: () => void;
  openDelete: (track: GpsTrackListItem) => void;
  cancelDelete: () => void;
  confirmDelete: () => void;
}

const defaultWarn: WarningLogger = (message, details) => console.warn(message, details);

function addLoadingTrack(previous: Set<string>, id: string): Set<string> {
  const next = new Set(previous);
  next.add(id);
  return next;
}

function removeLoadingTrack(previous: Set<string>, id: string): Set<string> {
  const next = new Set(previous);
  next.delete(id);
  return next;
}

function removeTrackPoints(
  previous: Record<string, PreparedGpsTrack>,
  id: string,
): Record<string, PreparedGpsTrack> {
  if (!(id in previous)) return previous;
  const next = { ...previous };
  delete next[id];
  return next;
}

export function buildSavedTrackFeatureCollection(
  tracks: readonly GpsTrackListItem[],
  visibility: Readonly<Record<string, boolean>>,
  pointsById: Readonly<Record<string, RecordedPoint[]>>,
): GeoJSON.FeatureCollection {
  const features = tracks.flatMap((track) => {
    if (visibility[track.id] !== true) return [];
    const points = pointsById[track.id];
    if (!points || points.length < 2) return [];
    const feature = trackPointsToLineStringFeature(points, {
      id: track.id,
      name: track.name,
      color: track.color,
    });
    return feature ? [feature as GeoJSON.Feature] : [];
  });
  return { type: 'FeatureCollection', features };
}

type MountedRef = ReturnType<typeof useMountedRef>;
type ErrorReporter = (
  track: GpsTrackListItem,
  phase: 'gpx' | 'share' | 'upload' | 'edit' | 'delete',
  message: string,
  error: unknown,
) => void;
type TrackPointsSetter = Dispatch<SetStateAction<Record<string, PreparedGpsTrack>>>;

function useActionErrorReporter(
  mountedRef: MountedRef,
  showToast: Toast,
  warn: WarningLogger,
): ErrorReporter {
  return useCallback((track, phase, message, error) => {
    warn('GPS track action failed.', {
      phase,
      trackId: track.id,
      trackName: track.name,
      origin: track.origin,
      error: errorToLogDetails(error),
    });
    if (mountedRef.current) showToast(message, 'error');
  }, [mountedRef, showToast, warn]);
}

function useTrackSharing(
  controller: TrackController,
  gpxShareService: GpxShareService,
  reportActionError: ErrorReporter,
) {
  return useCallback((track: GpsTrackListItem) => {
    void (async () => {
      let gpxFile: Awaited<ReturnType<TrackController['buildGpxFileForTrack']>>;
      try {
        gpxFile = await controller.buildGpxFileForTrack(track);
      } catch (error) {
        reportActionError(track, 'gpx', 'Could not create the GPX file for this track.', error);
        return;
      }
      try {
        await gpxShareService.shareGpx({ ...gpxFile, title: track.name });
      } catch (error) {
        reportActionError(track, 'share', 'Could not share the GPX file.', error);
      }
    })();
  }, [controller, gpxShareService, reportActionError]);
}

function geometryRevision(track: GpsTrackListItem): string {
  return track.geometryRevision ?? `${track.origin}:${track.updatedAt}`;
}

function useTrackGeometryLoader(
  controller: TrackController,
  tracks: readonly GpsTrackListItem[],
  mountedRef: MountedRef,
  warn: WarningLogger,
) {
  const [trackPoints, setTrackPoints] = useState<Record<string, PreparedGpsTrack>>({});
  const [loadingTrackIds, setLoadingTrackIds] = useState(() => new Set<string>());
  const current = useRef({ controller, tracks, trackPoints });
  const inFlight = useRef(new Map<string, { revision: string; promise: Promise<PreparedGpsTrack | undefined> }>());
  const failed = useRef(new Map<string, string>());
  useLayoutEffect(() => {
    if (current.current.controller !== controller) {
      inFlight.current.clear();
      failed.current.clear();
      setTrackPoints({});
      setLoadingTrackIds(new Set());
    }
    current.current = { controller, tracks, trackPoints };
  }, [controller, tracks, trackPoints]);
  useEffect(() => {
    const revisions = new Map(tracks.map(track => [track.id, geometryRevision(track)]));
    const cancelPrune = scheduleViewerUpdate(() => setTrackPoints(previous => {
      const entries = Object.entries(previous).filter(([id, value]) => revisions.get(id) === value.revision);
      return entries.length === Object.keys(previous).length ? previous : Object.fromEntries(entries);
    }));
    for (const [id, revision] of failed.current) {
      if (revisions.get(id) !== revision) failed.current.delete(id);
    }
    return cancelPrune;
  }, [tracks]);

  const loadTrackPoints = useCallback((track: GpsTrackListItem, retry = false): Promise<PreparedGpsTrack | undefined> => {
    const revision = geometryRevision(track);
    const isCurrent = () => mountedRef.current && current.current.controller === controller
      && current.current.tracks.some(item => item.id === track.id && geometryRevision(item) === revision);
    if (!isCurrent()) return Promise.resolve(undefined);
    const cached = current.current.trackPoints[track.id];
    if (cached?.revision === revision && (!retry || cached.feature)) return Promise.resolve(cached);
    const pending = inFlight.current.get(track.id);
    if (pending?.revision === revision) return pending.promise;
    if (!retry && failed.current.get(track.id) === revision) return Promise.resolve(undefined);
    failed.current.delete(track.id);
    setLoadingTrackIds(previous => addLoadingTrack(previous, track.id));
    const request = { revision, promise: Promise.resolve<PreparedGpsTrack | undefined>(undefined) };
    const promise = (async () => {
      // Loading feedback and visibility intent can commit before any cache work.
      try {
        await yieldToMainThread();
        if (!isCurrent()) return;
        const points = await controller.getGpsTrackPoints(track.id);
        if (!isCurrent()) return;
        const prepared = await prepareGpsTrack(points, revision, isCurrent);
        if (prepared && isCurrent()) {
          setTrackPoints(previous => ({ ...previous, [track.id]: prepared }));
          return prepared;
        }
      } catch (error) {
        if (isCurrent()) {
          failed.current.set(track.id, revision);
          warn('Failed to load GPS track geometry.', { id: track.id, error: errorToLogDetails(error) });
        }
      } finally {
        if (inFlight.current.get(track.id) === request) {
          inFlight.current.delete(track.id);
          if (mountedRef.current) setLoadingTrackIds(previous => removeLoadingTrack(previous, track.id));
        }
      }
    })();
    request.promise = promise;
    inFlight.current.set(track.id, request);
    return promise;
  }, [controller, mountedRef, warn]);
  const revisionsKey = JSON.stringify(tracks.map(track => [track.id, geometryRevision(track)]));
  const validTrackPoints = useMemo(() => {
    const revisions = JSON.parse(revisionsKey) as [string, string][];
    return Object.fromEntries(revisions.flatMap(([id, revision]) => {
      const record = trackPoints[id];
      return record?.revision === revision ? [[id, record]] : [];
    }));
  }, [trackPoints, revisionsKey]);
  return { trackPoints: validTrackPoints, setTrackPoints, loadingTrackIds, loadTrackPoints };
}

function useTrackVisibilityAndMap(options: {
  tracks: readonly GpsTrackListItem[];
  initialVisibility?: Record<string, boolean>;
  panelActive: boolean;
  runtimeActive: boolean;
  mapRef: RefObject<MapRef | null>;
  onClosePanel: () => void;
  writeVisibility: VisibilityWriter;
  mountedRef: MountedRef;
  geometry: ReturnType<typeof useTrackGeometryLoader>;
}) {
  const { tracks, initialVisibility, panelActive, runtimeActive, mapRef, onClosePanel, writeVisibility, mountedRef } = options;
  const { trackPoints, loadTrackPoints, loadingTrackIds } = options.geometry;
  const [trackVisibility, setTrackVisibility] = useState(
    () => initialVisibility ?? getGpsTrackVisibilityPreferences(),
  );
  const appliedTrackVisibility = useAppliedViewerState(trackVisibility, runtimeActive);
  const visibilityRef = useRef(trackVisibility);
  const tracksRef = useRef(tracks);
  useLayoutEffect(() => { tracksRef.current = tracks; }, [tracks]);
  const zoomRef = useRef<symbol | null>(null);
  const cancelPendingZoom = useCallback(() => { zoomRef.current = null; }, []);
  const activeRef = useRef(panelActive && runtimeActive);
  useLayoutEffect(() => {
    activeRef.current = panelActive && runtimeActive;
    if (!activeRef.current) zoomRef.current = null;
  }, [panelActive, runtimeActive]);
  const setVisible = useCallback((id: string, visible: boolean) => {
    const next = { ...visibilityRef.current, [id]: visible };
    visibilityRef.current = next;
    setTrackVisibility(next);
    writeVisibility(id, visible);
  }, [writeVisibility]);
  const toggleTrack = useCallback((track: GpsTrackListItem, visible: boolean) => {
    setVisible(track.id, visible);
    if (!visible) zoomRef.current = null;
    else void loadTrackPoints(track, true);
  }, [loadTrackPoints, setVisible]);

  const zoomToTrack = useCallback((track: GpsTrackListItem) => {
    if (visibilityRef.current[track.id] !== true) setVisible(track.id, true);
    const token = Symbol(track.id);
    zoomRef.current = token;
    void (async () => {
      const record = await loadTrackPoints(track, true);
      if (!mountedRef.current || !activeRef.current || zoomRef.current !== token
        || !visibilityRef.current[track.id] || !record?.bounds || !mapRef.current
        || !tracksRef.current.some(item => item.id === track.id && geometryRevision(item) === record.revision)) return;
      zoomRef.current = null;
      zoomToMapBounds(mapRef.current, record.bounds);
      onClosePanel();
    })();
  }, [loadTrackPoints, mapRef, mountedRef, onClosePanel, setVisible]);

  useEffect(() => {
    if (!runtimeActive) return;
    let cancelled = false;
    void (async () => {
      for (const track of tracks) {
        if (cancelled) return;
        if (trackVisibility[track.id]) await loadTrackPoints(track);
      }
    })();
    return () => { cancelled = true; };
  }, [loadTrackPoints, runtimeActive, trackVisibility, tracks]);

  // Geometry survives display-only toggles. No coordinate conversion occurs in render.
  const savedTrackFeatureCollection = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: Object.entries(trackPoints).flatMap(([id, record]) => {
      const feature = record.feature;
      return feature ? [{ ...feature, properties: { ...feature.properties, id } }] : [];
    }),
  }), [trackPoints]);
  return { trackVisibility, appliedTrackVisibility, loadingTrackIds, savedTrackFeatureCollection, toggleTrack, zoomToTrack, cancelPendingZoom };
}

function useTrackUploadActions(
  controller: TrackController,
  mountedRef: MountedRef,
  showToast: Toast,
  reportActionError: ErrorReporter,
) {
  const [uploadTarget, setUploadTarget] = useState<GpsTrackListItem | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const openUpload = useCallback((track: GpsTrackListItem) => setUploadTarget(track), []);
  const cancelUpload = useCallback(() => {
    if (!uploadBusy) setUploadTarget(null);
  }, [uploadBusy]);
  const confirmUpload = useCallback(() => {
    const target = uploadTarget;
    if (!target || uploadBusy) return;
    setUploadBusy(true);
    void (async () => {
      try {
        await controller.uploadGpsTrack(target.id);
        if (!mountedRef.current) return;
        setUploadTarget(null);
        showToast(
          controller.isOfflineLocked
            ? 'Offline — upload queued in Pending changes'
            : 'Track uploaded to SpeleoDB',
          controller.isOfflineLocked ? 'error' : 'success',
        );
      } catch (error) {
        if (!mountedRef.current) return;
        setUploadTarget(null);
        reportActionError(target, 'upload', 'Could not upload the GPS track.', error);
      } finally {
        if (mountedRef.current) setUploadBusy(false);
      }
    })();
  }, [controller, mountedRef, reportActionError, showToast, uploadBusy, uploadTarget]);
  return { uploadTarget, uploadBusy, openUpload, cancelUpload, confirmUpload };
}

function useTrackEditActions(
  controller: TrackController,
  mountedRef: MountedRef,
  reportActionError: ErrorReporter,
) {
  const [editTarget, setEditTarget] = useState<GpsTrackListItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const openEdit = useCallback((track: GpsTrackListItem) => {
    setEditTarget(track);
    setEditName(track.name);
    setEditColor(track.color);
  }, []);
  const cancelEdit = useCallback(() => {
    if (!editBusy) setEditTarget(null);
  }, [editBusy]);
  const confirmEdit = useCallback(() => {
    const target = editTarget;
    if (!target || editBusy) return;
    const name = editName.trim();
    if (!name || (name === target.name && editColor === target.color)) {
      setEditTarget(null);
      return;
    }
    setEditBusy(true);
    void (async () => {
      try {
        await controller.editGpsTrack(target.id, { name, color: editColor });
        if (mountedRef.current) setEditTarget(null);
      } catch (error) {
        if (!mountedRef.current) return;
        setEditTarget(null);
        reportActionError(target, 'edit', 'Could not save the track changes.', error);
      } finally {
        if (mountedRef.current) setEditBusy(false);
      }
    })();
  }, [controller, editBusy, editColor, editName, editTarget, mountedRef, reportActionError]);
  return {
    editTarget,
    editName,
    editColor,
    editBusy,
    setEditName,
    setEditColor,
    openEdit,
    cancelEdit,
    confirmEdit,
  };
}

function useTrackDeleteActions(
  controller: TrackController,
  mountedRef: MountedRef,
  setTrackPoints: TrackPointsSetter,
  reportActionError: ErrorReporter,
) {
  const [deleteTarget, setDeleteTarget] = useState<GpsTrackListItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const openDelete = useCallback((track: GpsTrackListItem) => setDeleteTarget(track), []);
  const cancelDelete = useCallback(() => {
    if (!deleteBusy) setDeleteTarget(null);
  }, [deleteBusy]);
  const confirmDelete = useCallback(() => {
    const target = deleteTarget;
    if (!target || deleteBusy) return;
    setDeleteBusy(true);
    void (async () => {
      try {
        await controller.removeGpsTrack(target.id);
        if (!mountedRef.current) return;
        setDeleteTarget(null);
        setTrackPoints((previous) => removeTrackPoints(previous, target.id));
      } catch (error) {
        if (!mountedRef.current) return;
        setDeleteTarget(null);
        reportActionError(target, 'delete', 'Could not delete the GPS track.', error);
      } finally {
        if (mountedRef.current) setDeleteBusy(false);
      }
    })();
  }, [controller, deleteBusy, deleteTarget, mountedRef, reportActionError, setTrackPoints]);
  return { deleteTarget, deleteBusy, openDelete, cancelDelete, confirmDelete };
}

export function useDashboardGpsTrackActions({
  controller,
  tracks,
  initialVisibility,
  panelActive = true,
  runtimeActive = true,
  mapRef,
  onClosePanel,
  showToast,
  gpxShareService: injectedGpxShareService,
  writeVisibility = setGpsTrackVisibilityPreference,
  warn = defaultWarn,
}: DashboardGpsTrackActionOptions): DashboardGpsTrackActionState {
  const mountedRef = useMountedRef();
  const defaultGpxShareService = useMemo(() => new GpxFileService(), []);
  const gpxShareService = injectedGpxShareService ?? defaultGpxShareService;
  const reportActionError = useActionErrorReporter(mountedRef, showToast, warn);
  const geometry = useTrackGeometryLoader(controller, tracks, mountedRef, warn);
  const visibility = useTrackVisibilityAndMap({
    tracks,
    initialVisibility,
    panelActive,
    runtimeActive,
    mapRef,
    onClosePanel,
    writeVisibility,
    mountedRef,
    geometry,
  });
  const shareTrack = useTrackSharing(controller, gpxShareService, reportActionError);
  const upload = useTrackUploadActions(controller, mountedRef, showToast, reportActionError);
  const edit = useTrackEditActions(controller, mountedRef, reportActionError);
  const deletion = useTrackDeleteActions(
    controller,
    mountedRef,
    geometry.setTrackPoints,
    reportActionError,
  );
  return {
    ...visibility,
    ...upload,
    ...edit,
    ...deletion,
    shareTrack,
  };
}
