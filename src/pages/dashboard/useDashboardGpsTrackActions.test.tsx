import type { RefObject } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allowConsoleWarn } from '../../test/consoleGuard';
import type { GpsTrackListItem, RecordedPoint } from '../../types/gpsTrack';
import {
  buildSavedTrackFeatureCollection,
  useDashboardGpsTrackActions,
} from './useDashboardGpsTrackActions';

const { mockDefaultShare, mockReadVisibility, mockWriteVisibility } = vi.hoisted(() => ({
  mockDefaultShare: vi.fn(),
  mockReadVisibility: vi.fn(() => ({} as Record<string, boolean>)),
  mockWriteVisibility: vi.fn(),
}));

vi.mock('../../services/GpxFileService', () => ({
  GpxFileService: class {
    shareGpx = mockDefaultShare;
  },
}));

vi.mock('../../services/PreferencesService', () => ({
  getGpsTrackVisibilityPreferences: mockReadVisibility,
  setGpsTrackVisibilityPreference: mockWriteVisibility,
}));

const TRACK: GpsTrackListItem = {
  id: 'track-1',
  name: 'Surface route',
  color: '#377eb8',
  origin: 'remote',
  createdAt: 1,
  updatedAt: 2,
};

const POINTS: RecordedPoint[] = [
  { latitude: 45, longitude: -73, timestamp: 1 },
  { latitude: 45.01, longitude: -73.02, timestamp: 2 },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createController(overrides: Record<string, unknown> = {}) {
  return {
    buildGpxFileForTrack: vi.fn().mockResolvedValue({ fileName: 'track.gpx', gpx: '<gpx/>' }),
    getGpsTrackPoints: vi.fn().mockResolvedValue(POINTS),
    uploadGpsTrack: vi.fn().mockResolvedValue(undefined),
    editGpsTrack: vi.fn().mockResolvedValue(undefined),
    removeGpsTrack: vi.fn().mockResolvedValue(undefined),
    isOfflineLocked: false,
    ...overrides,
  };
}

function createMapRef(fitBounds = vi.fn()): RefObject<MapRef | null> {
  return { current: { fitBounds } as unknown as MapRef };
}

function renderActions(overrides: Record<string, unknown> = {}) {
  const controller = createController();
  const showToast = vi.fn();
  const shareGpx = vi.fn().mockResolvedValue('shared');
  const writeVisibility = vi.fn();
  const warn = vi.fn();
  const onClosePanel = vi.fn();
  const fitBounds = vi.fn();
  const mapRef = createMapRef(fitBounds);
  const options = {
    controller,
    tracks: [TRACK],
    initialVisibility: {},
    mapRef,
    onClosePanel,
    showToast,
    gpxShareService: { shareGpx },
    writeVisibility,
    warn,
    ...overrides,
  };
  const hook = renderHook(() => useDashboardGpsTrackActions(options as never));
  return {
    ...hook,
    controller: options.controller as ReturnType<typeof createController>,
    showToast: options.showToast as ReturnType<typeof vi.fn>,
    shareGpx,
    writeVisibility,
    warn,
    onClosePanel,
    fitBounds,
    mapRef,
  };
}

describe('buildSavedTrackFeatureCollection', () => {
  it('includes only visible tracks with at least two valid points', () => {
    const tracks = [
      { ...TRACK, id: 'hidden' },
      { ...TRACK, id: 'missing' },
      { ...TRACK, id: 'short' },
      { ...TRACK, id: 'invalid' },
      { ...TRACK, id: 'visible' },
    ];
    const result = buildSavedTrackFeatureCollection(
      tracks,
      { missing: true, short: true, invalid: true, visible: true },
      {
        short: [POINTS[0]],
        invalid: [
          { latitude: 100, longitude: 0, timestamp: 1 },
          { latitude: 100, longitude: 1, timestamp: 2 },
        ],
        visible: POINTS,
      },
    );

    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties).toMatchObject({
      id: 'visible',
      name: TRACK.name,
      color: TRACK.color,
      pointCount: 2,
    });
  });
});

describe('useDashboardGpsTrackActions', () => {
  beforeEach(() => {
    mockDefaultShare.mockReset().mockResolvedValue('shared');
    mockReadVisibility.mockReset().mockReturnValue({});
    mockWriteVisibility.mockReset();
  });

  it('restores default visibility, loads geometry, and uses default collaborators', async () => {
    mockReadVisibility.mockReturnValue({ [TRACK.id]: true });
    const controller = createController();
    const showToast = vi.fn();
    const { result } = renderHook(() => useDashboardGpsTrackActions({
      controller: controller as never,
      tracks: [TRACK],
      mapRef: createMapRef(),
      onClosePanel: vi.fn(),
      showToast,
    }));

    await waitFor(() => expect(controller.getGpsTrackPoints).toHaveBeenCalledWith(TRACK.id));
    await waitFor(() => expect(result.current.savedTrackFeatureCollection.features).toHaveLength(1));

    act(() => result.current.toggleTrack(TRACK, false));
    expect(mockWriteVisibility).toHaveBeenCalledWith(TRACK.id, false);

    act(() => result.current.shareTrack(TRACK));
    await waitFor(() => expect(mockDefaultShare).toHaveBeenCalledWith({
      fileName: 'track.gpx',
      gpx: '<gpx/>',
      title: TRACK.name,
    }));
    expect(showToast).not.toHaveBeenCalled();
  });

  it('shares a prepared GPX and reports preparation and share failures', async () => {
    const gpxFailure = new Error('gpx failed');
    const controller = createController({
      buildGpxFileForTrack: vi.fn()
        .mockRejectedValueOnce(gpxFailure)
        .mockResolvedValue({ fileName: 'track.gpx', gpx: '<gpx/>' }),
    });
    const shareFailure = new Error('share failed');
    const shareGpx = vi.fn().mockRejectedValueOnce(shareFailure);
    const { result, warn, showToast } = renderActions({
      controller,
      gpxShareService: { shareGpx },
    });

    act(() => result.current.shareTrack(TRACK));
    await waitFor(() => expect(warn).toHaveBeenCalledWith(
      'GPS track action failed.',
      expect.objectContaining({ phase: 'gpx', trackId: TRACK.id }),
    ));
    expect(showToast).toHaveBeenCalledWith(
      'Could not create the GPX file for this track.',
      'error',
    );
    expect(shareGpx).not.toHaveBeenCalled();

    act(() => result.current.shareTrack(TRACK));
    await waitFor(() => expect(warn).toHaveBeenCalledWith(
      'GPS track action failed.',
      expect.objectContaining({ phase: 'share', trackId: TRACK.id }),
    ));
    expect(showToast).toHaveBeenLastCalledWith('Could not share the GPX file.', 'error');
  });

  it('uses the default warning boundary and suppresses post-unmount toasts', async () => {
    const build = deferred<{ fileName: string; gpx: string }>();
    const error = new Error('late failure');
    allowConsoleWarn(
      'GPS track action failed.',
      expect.objectContaining({ phase: 'gpx', trackId: TRACK.id }),
    );
    const showToast = vi.fn();
    const { result, unmount } = renderHook(() => useDashboardGpsTrackActions({
      controller: createController({ buildGpxFileForTrack: vi.fn(() => build.promise) }) as never,
      tracks: [TRACK],
      initialVisibility: {},
      mapRef: createMapRef(),
      onClosePanel: vi.fn(),
      showToast,
      gpxShareService: { shareGpx: vi.fn() },
      writeVisibility: vi.fn(),
    }));

    act(() => result.current.shareTrack(TRACK));
    unmount();
    await act(async () => build.reject(error));
    expect(showToast).not.toHaveBeenCalled();
  });

  it('toggles lazy geometry without reloading cached points and reports load failures', async () => {
    const loadFailure = new Error('geometry failed');
    const getGpsTrackPoints = vi.fn()
      .mockResolvedValueOnce(POINTS)
      .mockRejectedValueOnce(loadFailure);
    const { result, controller, writeVisibility, warn } = renderActions({
      controller: createController({ getGpsTrackPoints }),
    });

    act(() => result.current.toggleTrack(TRACK, true));
    expect(result.current.loadingTrackIds.has(TRACK.id)).toBe(true);
    await waitFor(() => expect(result.current.loadingTrackIds.has(TRACK.id)).toBe(false));
    expect(result.current.savedTrackFeatureCollection.features).toHaveLength(1);

    act(() => result.current.toggleTrack(TRACK, false));
    act(() => result.current.toggleTrack(TRACK, true));
    expect(controller.getGpsTrackPoints).toHaveBeenCalledTimes(1);
    expect(writeVisibility).toHaveBeenNthCalledWith(1, TRACK.id, true);
    expect(writeVisibility).toHaveBeenNthCalledWith(2, TRACK.id, false);

    const other = { ...TRACK, id: 'track-failure' };
    act(() => result.current.toggleTrack(other, true));
    await waitFor(() => expect(warn).toHaveBeenCalledWith(
      'Failed to load GPS track geometry.',
      expect.objectContaining({ id: other.id }),
    ));
  });

  it('loads restored visible tracks sequentially and stops publishing after unmount', async () => {
    const first = deferred<RecordedPoint[]>();
    const second = deferred<RecordedPoint[]>();
    const tracks = [TRACK, { ...TRACK, id: 'track-2' }];
    const getGpsTrackPoints = vi.fn((id: string) => (
      id === TRACK.id ? first.promise : second.promise
    ));
    const { result, unmount } = renderActions({
      controller: createController({ getGpsTrackPoints }),
      tracks,
      initialVisibility: { [TRACK.id]: true, 'track-2': true },
    });

    await waitFor(() => expect(getGpsTrackPoints).toHaveBeenCalled());
    expect(result.current.loadingTrackIds.size).toBeGreaterThan(0);
    unmount();
    await act(async () => {
      first.resolve(POINTS);
      second.resolve(POINTS);
      await Promise.all([first.promise, second.promise]);
    });
  });

  it('zooms with cached or loaded geometry and fails closed for unusable bounds or maps', async () => {
    const invalidPoints = [{ latitude: Number.NaN, longitude: Number.NaN, timestamp: 1 }];
    const getGpsTrackPoints = vi.fn()
      .mockResolvedValueOnce(POINTS)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(invalidPoints)
      .mockRejectedValueOnce(new Error('missing'));
    const { result, fitBounds, onClosePanel, writeVisibility, mapRef, warn } = renderActions({
      controller: createController({ getGpsTrackPoints }),
    });

    act(() => result.current.zoomToTrack(TRACK));
    await waitFor(() => expect(fitBounds).toHaveBeenCalled());
    expect(fitBounds.mock.calls[0][1]).toEqual({ padding: 60, maxZoom: 16, duration: 800 });
    expect(fitBounds.mock.calls[0][0][0][0]).toBeLessThan(-73.02);
    expect(fitBounds.mock.calls[0][0][1][1]).toBeGreaterThan(45.01);
    expect(onClosePanel).toHaveBeenCalledOnce();
    expect(writeVisibility).toHaveBeenCalledWith(TRACK.id, true);

    act(() => result.current.zoomToTrack(TRACK));
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(2));
    expect(getGpsTrackPoints).toHaveBeenCalledTimes(1);

    act(() => result.current.zoomToTrack({ ...TRACK, id: 'empty' }));
    await waitFor(() => expect(getGpsTrackPoints).toHaveBeenCalledWith('empty'));
    act(() => result.current.zoomToTrack({ ...TRACK, id: 'invalid' }));
    await waitFor(() => expect(getGpsTrackPoints).toHaveBeenCalledWith('invalid'));

    mapRef.current = null;
    act(() => result.current.zoomToTrack({ ...TRACK, id: 'failure' }));
    await waitFor(() => expect(warn).toHaveBeenCalledWith(
      'Failed to load GPS track geometry.',
      expect.objectContaining({ id: 'failure' }),
    ));
    expect(fitBounds).toHaveBeenCalledTimes(2);
  });

  it('handles successful online and offline uploads and guards busy cancellation', async () => {
    const upload = deferred<void>();
    const controller = createController({ uploadGpsTrack: vi.fn(() => upload.promise) });
    const { result, showToast } = renderActions({ controller });

    act(() => result.current.confirmUpload());
    expect(controller.uploadGpsTrack).not.toHaveBeenCalled();
    act(() => result.current.openUpload(TRACK));
    act(() => result.current.confirmUpload());
    expect(result.current.uploadBusy).toBe(true);
    act(() => result.current.cancelUpload());
    act(() => result.current.confirmUpload());
    expect(result.current.uploadTarget).toEqual(TRACK);
    expect(controller.uploadGpsTrack).toHaveBeenCalledTimes(1);

    await act(async () => upload.resolve());
    await waitFor(() => expect(result.current.uploadBusy).toBe(false));
    expect(result.current.uploadTarget).toBeNull();
    expect(showToast).toHaveBeenCalledWith('Track uploaded to SpeleoDB', 'success');

    controller.isOfflineLocked = true;
    act(() => result.current.openUpload(TRACK));
    act(() => result.current.confirmUpload());
    await waitFor(() => expect(showToast).toHaveBeenLastCalledWith(
      'Offline — upload queued in Pending changes',
      'error',
    ));
    act(() => result.current.cancelUpload());
  });

  it('reports upload failures and ignores upload completion after unmount', async () => {
    const uploadError = new Error('upload failed');
    const lateUpload = deferred<void>();
    const controller = createController({
      uploadGpsTrack: vi.fn()
        .mockRejectedValueOnce(uploadError)
        .mockImplementationOnce(() => lateUpload.promise),
    });
    const first = renderActions({ controller });
    act(() => first.result.current.openUpload(TRACK));
    act(() => first.result.current.confirmUpload());
    await waitFor(() => expect(first.warn).toHaveBeenCalledWith(
      'GPS track action failed.',
      expect.objectContaining({ phase: 'upload' }),
    ));
    expect(first.showToast).toHaveBeenCalledWith('Could not upload the GPS track.', 'error');
    act(() => first.result.current.cancelUpload());

    act(() => first.result.current.openUpload(TRACK));
    act(() => first.result.current.confirmUpload());
    first.unmount();
    await act(async () => lateUpload.reject(new Error('late upload')));
  });

  it('edits changed tracks and closes unchanged or blank edits', async () => {
    const edit = deferred<void>();
    const controller = createController({ editGpsTrack: vi.fn(() => edit.promise) });
    const { result } = renderActions({ controller });

    act(() => result.current.confirmEdit());
    expect(controller.editGpsTrack).not.toHaveBeenCalled();
    act(() => result.current.openEdit(TRACK));
    act(() => result.current.confirmEdit());
    expect(result.current.editTarget).toBeNull();

    act(() => result.current.openEdit(TRACK));
    act(() => result.current.setEditName('   '));
    act(() => result.current.confirmEdit());
    expect(result.current.editTarget).toBeNull();

    act(() => result.current.openEdit(TRACK));
    act(() => result.current.setEditName('  Renamed route  '));
    act(() => result.current.setEditColor('#e41a1c'));
    act(() => result.current.confirmEdit());
    expect(result.current.editBusy).toBe(true);
    act(() => result.current.cancelEdit());
    act(() => result.current.confirmEdit());
    expect(controller.editGpsTrack).toHaveBeenCalledTimes(1);
    expect(controller.editGpsTrack).toHaveBeenCalledWith(TRACK.id, {
      name: 'Renamed route',
      color: '#e41a1c',
    });
    await act(async () => edit.resolve());
    await waitFor(() => expect(result.current.editBusy).toBe(false));
    expect(result.current.editTarget).toBeNull();
    act(() => result.current.cancelEdit());
  });

  it('reports edit failures and ignores edit completion after unmount', async () => {
    const lateEdit = deferred<void>();
    const controller = createController({
      editGpsTrack: vi.fn()
        .mockRejectedValueOnce(new Error('edit failed'))
        .mockImplementationOnce(() => lateEdit.promise),
    });
    const hook = renderActions({ controller });

    act(() => hook.result.current.openEdit(TRACK));
    act(() => hook.result.current.setEditName('Changed'));
    act(() => hook.result.current.confirmEdit());
    await waitFor(() => expect(hook.warn).toHaveBeenCalledWith(
      'GPS track action failed.',
      expect.objectContaining({ phase: 'edit' }),
    ));
    expect(hook.showToast).toHaveBeenCalledWith('Could not save the track changes.', 'error');

    act(() => hook.result.current.openEdit(TRACK));
    act(() => hook.result.current.setEditName('Changed again'));
    act(() => hook.result.current.confirmEdit());
    hook.unmount();
    await act(async () => lateEdit.reject(new Error('late edit')));
  });

  it('deletes tracks, clears loaded geometry, and guards busy cancellation', async () => {
    const remove = deferred<void>();
    const reload = deferred<RecordedPoint[]>();
    const controller = createController({
      getGpsTrackPoints: vi.fn()
        .mockResolvedValueOnce(POINTS)
        .mockImplementationOnce(() => reload.promise),
      removeGpsTrack: vi.fn(() => remove.promise),
    });
    const { result, unmount } = renderActions({ controller });

    act(() => result.current.confirmDelete());
    expect(controller.removeGpsTrack).not.toHaveBeenCalled();
    act(() => result.current.toggleTrack(TRACK, true));
    await waitFor(() => expect(result.current.savedTrackFeatureCollection.features).toHaveLength(1));
    act(() => result.current.openDelete(TRACK));
    act(() => result.current.confirmDelete());
    expect(result.current.deleteBusy).toBe(true);
    act(() => result.current.cancelDelete());
    act(() => result.current.confirmDelete());
    expect(controller.removeGpsTrack).toHaveBeenCalledTimes(1);

    await act(async () => remove.resolve());
    await waitFor(() => expect(result.current.deleteBusy).toBe(false));
    expect(result.current.deleteTarget).toBeNull();
    expect(result.current.savedTrackFeatureCollection.features).toHaveLength(0);

    act(() => result.current.openDelete({ ...TRACK, id: 'not-loaded' }));
    act(() => result.current.cancelDelete());
    expect(result.current.deleteTarget).toBeNull();
    act(() => result.current.openDelete({ ...TRACK, id: 'not-loaded' }));
    act(() => result.current.confirmDelete());
    await waitFor(() => expect(controller.removeGpsTrack).toHaveBeenCalledTimes(2));
    act(() => result.current.cancelDelete());
    unmount();
    await act(async () => reload.resolve(POINTS));
  });

  it('reports delete failures and ignores delete completion after unmount', async () => {
    const lateDelete = deferred<void>();
    const controller = createController({
      removeGpsTrack: vi.fn()
        .mockRejectedValueOnce(new Error('delete failed'))
        .mockImplementationOnce(() => lateDelete.promise),
    });
    const hook = renderActions({ controller });

    act(() => hook.result.current.openDelete(TRACK));
    act(() => hook.result.current.confirmDelete());
    await waitFor(() => expect(hook.warn).toHaveBeenCalledWith(
      'GPS track action failed.',
      expect.objectContaining({ phase: 'delete' }),
    ));
    expect(hook.showToast).toHaveBeenCalledWith('Could not delete the GPS track.', 'error');

    act(() => hook.result.current.openDelete(TRACK));
    act(() => hook.result.current.confirmDelete());
    hook.unmount();
    await act(async () => lateDelete.reject(new Error('late delete')));
  });

  it('ignores successful mutation completions after unmount', async () => {
    const upload = deferred<void>();
    const uploadHook = renderActions({
      controller: createController({ uploadGpsTrack: vi.fn(() => upload.promise) }),
    });
    act(() => uploadHook.result.current.openUpload(TRACK));
    act(() => uploadHook.result.current.confirmUpload());
    uploadHook.unmount();
    await act(async () => upload.resolve());

    const edit = deferred<void>();
    const editHook = renderActions({
      controller: createController({ editGpsTrack: vi.fn(() => edit.promise) }),
    });
    act(() => editHook.result.current.openEdit(TRACK));
    act(() => editHook.result.current.setEditName('Changed'));
    act(() => editHook.result.current.confirmEdit());
    editHook.unmount();
    await act(async () => edit.resolve());

    const remove = deferred<void>();
    const deleteHook = renderActions({
      controller: createController({ removeGpsTrack: vi.fn(() => remove.promise) }),
    });
    act(() => deleteHook.result.current.openDelete(TRACK));
    act(() => deleteHook.result.current.confirmDelete());
    deleteHook.unmount();
    await act(async () => remove.resolve());
  });
});
