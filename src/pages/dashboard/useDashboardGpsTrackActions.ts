import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { boundsFromPoints } from './dashboardMapUtils';

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
  mapRef: RefObject<MapRef | null>;
  onClosePanel: () => void;
  showToast: Toast;
  gpxShareService?: GpxShareService;
  writeVisibility?: VisibilityWriter;
  warn?: WarningLogger;
}

export interface DashboardGpsTrackActionState {
  trackVisibility: Record<string, boolean>;
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
  previous: Record<string, RecordedPoint[]>,
  id: string,
): Record<string, RecordedPoint[]> {
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
type TrackPointsSetter = Dispatch<SetStateAction<Record<string, RecordedPoint[]>>>;

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

function useTrackGeometryLoader(
  controller: TrackController,
  mountedRef: MountedRef,
  warn: WarningLogger,
) {
  const [trackPoints, setTrackPoints] = useState<Record<string, RecordedPoint[]>>({});
  const [loadingTrackIds, setLoadingTrackIds] = useState(() => new Set<string>());
  const loadTrackPoints = useCallback(async (id: string): Promise<RecordedPoint[] | undefined> => {
    setLoadingTrackIds((previous) => addLoadingTrack(previous, id));
    try {
      const points = await controller.getGpsTrackPoints(id);
      if (mountedRef.current) {
        setTrackPoints((previous) => ({ ...previous, [id]: points }));
      }
      return points;
    } catch (error) {
      warn('Failed to load GPS track geometry.', { id, error: errorToLogDetails(error) });
      return undefined;
    } finally {
      if (mountedRef.current) {
        setLoadingTrackIds((previous) => removeLoadingTrack(previous, id));
      }
    }
  }, [controller, mountedRef, warn]);
  return { trackPoints, setTrackPoints, loadingTrackIds, loadTrackPoints };
}

function useTrackVisibilityAndMap(options: {
  tracks: readonly GpsTrackListItem[];
  initialVisibility?: Record<string, boolean>;
  mapRef: RefObject<MapRef | null>;
  onClosePanel: () => void;
  writeVisibility: VisibilityWriter;
  mountedRef: MountedRef;
  geometry: ReturnType<typeof useTrackGeometryLoader>;
}) {
  const { tracks, initialVisibility, mapRef, onClosePanel, writeVisibility, mountedRef } = options;
  const { trackPoints, loadingTrackIds, loadTrackPoints } = options.geometry;
  const [trackVisibility, setTrackVisibility] = useState(
    () => initialVisibility ?? getGpsTrackVisibilityPreferences(),
  );
  const toggleTrack = useCallback((track: GpsTrackListItem, visible: boolean) => {
    setTrackVisibility((previous) => ({ ...previous, [track.id]: visible }));
    writeVisibility(track.id, visible);
    if (visible && !trackPoints[track.id]) void loadTrackPoints(track.id);
  }, [loadTrackPoints, trackPoints, writeVisibility]);

  const zoomToTrack = useCallback((track: GpsTrackListItem) => {
    if (trackVisibility[track.id] !== true) {
      setTrackVisibility((previous) => ({ ...previous, [track.id]: true }));
      writeVisibility(track.id, true);
    }
    void (async () => {
      const points = trackPoints[track.id] ?? await loadTrackPoints(track.id);
      if (!mountedRef.current || !points || points.length === 0) return;
      const bounds = boundsFromPoints(points);
      if (!bounds || !mapRef.current) return;
      mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 800 });
      onClosePanel();
    })();
  }, [loadTrackPoints, mapRef, mountedRef, onClosePanel, trackPoints, trackVisibility, writeVisibility]);

  useEffect(() => {
    const pending = tracks.filter((track) => (
      trackVisibility[track.id] === true
      && !trackPoints[track.id]
      && !loadingTrackIds.has(track.id)
    )).map((track) => track.id);
    if (pending.length === 0) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      for (const id of pending) {
        if (cancelled) return;
        await loadTrackPoints(id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadTrackPoints, loadingTrackIds, trackPoints, trackVisibility, tracks]);

  const savedTrackFeatureCollection = useMemo(
    () => buildSavedTrackFeatureCollection(tracks, trackVisibility, trackPoints),
    [trackPoints, trackVisibility, tracks],
  );
  return { trackVisibility, loadingTrackIds, savedTrackFeatureCollection, toggleTrack, zoomToTrack };
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
  const geometry = useTrackGeometryLoader(controller, mountedRef, warn);
  const visibility = useTrackVisibilityAndMap({
    tracks,
    initialVisibility,
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
