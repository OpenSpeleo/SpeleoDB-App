import type { RefObject } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LandmarkMutationError } from '../../types/landmark';
import type { LandmarkCollectionGroup } from '../../utils/landmarkCollections';
import type { NormalizedLandmarkInput } from '../../utils/landmarkMutations';
import type { LandmarkDetails, OverlayMarkerDetails } from '../../utils/overlayMarkerDetails';
import {
  filterVisibleLandmarks,
  useDashboardLandmarkActions,
} from './useDashboardLandmarkActions';

const {
  mockReadVisibility,
  mockReadCollapsed,
  mockWriteVisibility,
  mockWriteVisibilityBatch,
  mockWriteCollapsed,
} = vi.hoisted(() => ({
  mockReadVisibility: vi.fn(() => ({} as Record<string, boolean>)),
  mockReadCollapsed: vi.fn(() => ({} as Record<string, boolean>)),
  mockWriteVisibility: vi.fn(),
  mockWriteVisibilityBatch: vi.fn(),
  mockWriteCollapsed: vi.fn(),
}));

vi.mock('../../services/PreferencesService', () => ({
  getLandmarkCollectionVisibilityPreferences: mockReadVisibility,
  getLandmarkCollectionCollapsedPreferences: mockReadCollapsed,
  setLandmarkCollectionVisibilityPreference: mockWriteVisibility,
  setLandmarkCollectionVisibilityPreferences: mockWriteVisibilityBatch,
  setLandmarkCollectionCollapsedPreference: mockWriteCollapsed,
}));

const GROUPS: LandmarkCollectionGroup[] = [
  {
    id: 'collection-1',
    name: 'Survey A',
    color: '#123456',
    isPersonal: false,
    count: 1,
    landmarks: [],
  },
  {
    id: '__personal__',
    name: 'Personal',
    color: '#654321',
    isPersonal: true,
    count: 1,
    landmarks: [],
  },
];

const LANDMARKS: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'lm-1',
      properties: { collection: 'collection-1' },
      geometry: { type: 'Point', coordinates: [-73, 45] },
    },
    {
      type: 'Feature',
      id: 'lm-personal',
      properties: null,
      geometry: { type: 'Point', coordinates: [-74, 46] },
    },
  ],
};

const LONG_PRESS: OverlayMarkerDetails = {
  type: 'mapLongPress',
  gpsCoordinate: '45, -73',
  latitude: 45,
  longitude: -73,
};

const LANDMARK: LandmarkDetails = {
  type: 'landmark',
  id: 'lm-1',
  name: 'Entrance',
  description: 'Main entrance',
  gpsCoordinate: '45, -73',
  collectionName: 'Survey A',
  isPersonalCollection: false,
  canWrite: true,
  canDelete: true,
  collectionId: 'collection-1',
  latitude: 45,
  longitude: -73,
};

const INPUT: NormalizedLandmarkInput = {
  name: 'Renamed',
  description: 'Updated',
  latitude: 45.1,
  longitude: -73.1,
  collection: 'collection-1',
};

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
    getLandmarkCollections: vi.fn().mockResolvedValue([
      { id: 'collection-1', name: 'Survey A', color: '#123456', isPersonal: false, canWrite: true },
    ]),
    createLandmark: vi.fn().mockResolvedValue({ id: 'created' }),
    updateLandmark: vi.fn().mockResolvedValue({ id: 'lm-1' }),
    deleteLandmark: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMapRef() {
  const flyTo = vi.fn();
  const getMap = vi.fn(() => ({ flyTo }));
  return {
    mapRef: { current: { getMap } as unknown as MapRef } as RefObject<MapRef | null>,
    flyTo,
  };
}

interface HookProps {
  selectedMarkerDetail: OverlayMarkerDetails | null;
  groups: LandmarkCollectionGroup[];
}

function renderActions(overrides: Record<string, unknown> = {}) {
  const controller = createController();
  const clearSelectedMarkerDetail = vi.fn();
  const onClosePanel = vi.fn();
  const writeVisibility = vi.fn();
  const writeVisibilityBatch = vi.fn();
  const writeCollapsed = vi.fn();
  const { mapRef, flyTo } = createMapRef();
  const options = {
    controller,
    clearSelectedMarkerDetail,
    onClosePanel,
    writeVisibility,
    writeVisibilityBatch,
    writeCollapsed,
    mapRef,
    landmarks: LANDMARKS,
    initialVisibility: {},
    initialCollapsed: {},
    ...overrides,
  };
  const hook = renderHook(
    ({ selectedMarkerDetail, groups }: HookProps) => useDashboardLandmarkActions({
      controller: options.controller as never,
      selectedMarkerDetail,
      clearSelectedMarkerDetail: options.clearSelectedMarkerDetail as never,
      groups,
      landmarks: options.landmarks as never,
      mapRef: options.mapRef as never,
      onClosePanel: options.onClosePanel as never,
      initialVisibility: options.initialVisibility as never,
      initialCollapsed: options.initialCollapsed as never,
      writeVisibility: options.writeVisibility as never,
      writeVisibilityBatch: options.writeVisibilityBatch as never,
      writeCollapsed: options.writeCollapsed as never,
    }),
    { initialProps: { selectedMarkerDetail: null, groups: GROUPS } as HookProps },
  );
  return {
    ...hook,
    controller: options.controller as ReturnType<typeof createController>,
    clearSelectedMarkerDetail: options.clearSelectedMarkerDetail as ReturnType<typeof vi.fn>,
    onClosePanel: options.onClosePanel as ReturnType<typeof vi.fn>,
    writeVisibility: options.writeVisibility as ReturnType<typeof vi.fn>,
    writeVisibilityBatch: options.writeVisibilityBatch as ReturnType<typeof vi.fn>,
    writeCollapsed: options.writeCollapsed as ReturnType<typeof vi.fn>,
    mapRef: options.mapRef as RefObject<MapRef | null>,
    flyTo,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadVisibility.mockReturnValue({});
  mockReadCollapsed.mockReturnValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('filterVisibleLandmarks', () => {
  it('handles missing data, collection visibility, and personal fallbacks', () => {
    expect(filterVisibleLandmarks(undefined, {})).toBeUndefined();
    expect(filterVisibleLandmarks(LANDMARKS, {})).toEqual(LANDMARKS);
    expect(filterVisibleLandmarks(LANDMARKS, { 'collection-1': false })?.features)
      .toHaveLength(1);
    expect(filterVisibleLandmarks(LANDMARKS, { __personal__: false })?.features)
      .toHaveLength(1);
  });
});

describe('useDashboardLandmarkActions collections and toast', () => {
  it('uses default preferences and writers when collaborators are omitted', () => {
    mockReadVisibility.mockReturnValue({ 'collection-1': false });
    mockReadCollapsed.mockReturnValue({ 'collection-1': true });
    const controller = createController();
    const { result } = renderHook(() => useDashboardLandmarkActions({
      controller: controller as never,
      selectedMarkerDetail: null,
      clearSelectedMarkerDetail: vi.fn(),
      groups: GROUPS,
      landmarks: LANDMARKS,
      mapRef: createMapRef().mapRef,
      onClosePanel: vi.fn(),
    }));

    expect(result.current.collectionVisibility).toEqual({ 'collection-1': false });
    expect(result.current.collectionCollapsed).toEqual({ 'collection-1': true });
    act(() => {
      result.current.toggleCollection('collection-1', true);
      result.current.toggleCollectionCollapsed('collection-1', false);
      result.current.showAll();
    });
    expect(mockWriteVisibility).toHaveBeenCalledWith('collection-1', true);
    expect(mockWriteCollapsed).toHaveBeenCalledWith('collection-1', false);
    expect(mockWriteVisibilityBatch).toHaveBeenCalledWith({
      'collection-1': true,
      __personal__: true,
    });
  });

  it('toggles, shows, hides, filters, and skips empty group batches', () => {
    const { result, rerender, writeVisibility, writeVisibilityBatch, writeCollapsed } = renderActions();

    act(() => {
      result.current.toggleCollection('collection-1', false);
      result.current.toggleCollectionCollapsed('collection-1', true);
    });
    expect(result.current.visibleLandmarks?.features).toHaveLength(1);
    expect(writeVisibility).toHaveBeenCalledWith('collection-1', false);
    expect(writeCollapsed).toHaveBeenCalledWith('collection-1', true);

    act(() => result.current.showAll());
    expect(result.current.visibleLandmarks?.features).toHaveLength(2);
    act(() => result.current.hideAll());
    expect(result.current.visibleLandmarks?.features).toHaveLength(0);
    expect(writeVisibilityBatch).toHaveBeenCalledTimes(2);

    rerender({ selectedMarkerDetail: null, groups: [] });
    act(() => {
      result.current.showAll();
      result.current.hideAll();
    });
    expect(writeVisibilityBatch).toHaveBeenCalledTimes(2);
  });

  it('closes the panel and flies to a landmark only when a map exists', () => {
    const hook = renderActions();
    const landmark = { ...GROUPS[0].landmarks[0], longitude: -73, latitude: 45 };

    act(() => hook.result.current.locateLandmark(landmark));
    expect(hook.onClosePanel).toHaveBeenCalledTimes(1);
    expect(hook.flyTo).toHaveBeenCalledWith({ center: [-73, 45], zoom: 16, duration: 1000 });

    hook.mapRef.current = null;
    act(() => hook.result.current.locateLandmark(landmark));
    expect(hook.onClosePanel).toHaveBeenCalledTimes(2);
    expect(hook.flyTo).toHaveBeenCalledTimes(1);
  });

  it('replaces and expires toast timers and clears them on unmount', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderActions();

    act(() => result.current.showToast('First', 'success'));
    expect(result.current.landmarkToast).toEqual({ message: 'First', tone: 'success' });
    act(() => result.current.showToast('Second', 'error'));
    expect(result.current.landmarkToast).toEqual({ message: 'Second', tone: 'error' });
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.landmarkToast).toBeNull();

    act(() => result.current.showToast('Unmounting', 'success'));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('useDashboardLandmarkActions form', () => {
  it('opens create from a map point and loads writable collections', async () => {
    const hook = renderActions();
    hook.rerender({ selectedMarkerDetail: LONG_PRESS, groups: GROUPS });

    act(() => hook.result.current.openCreateFromSelected());
    expect(hook.clearSelectedMarkerDetail).toHaveBeenCalledTimes(1);
    expect(hook.result.current.landmarkForm).toEqual({
      mode: 'create',
      editId: null,
      initialValues: { latitude: 45, longitude: -73 },
    });
    await waitFor(() => expect(hook.result.current.landmarkCollections).toHaveLength(1));
  });

  it('ignores invalid create/edit selections and opens direct averaged points', async () => {
    const hook = renderActions();

    act(() => {
      hook.result.current.openCreateFromSelected();
      hook.result.current.openEditFromSelected();
      hook.result.current.openCreateAtPoint({ latitude: 46, longitude: -74 });
    });
    expect(hook.clearSelectedMarkerDetail).not.toHaveBeenCalled();
    expect(hook.result.current.landmarkForm?.initialValues).toMatchObject({
      latitude: 46,
      longitude: -74,
    });
    await waitFor(() => expect(hook.result.current.landmarkCollections).toHaveLength(1));
  });

  it('opens edit details with N/A normalization and ordinary values', async () => {
    const hook = renderActions();
    const emptyDetail: LandmarkDetails = {
      ...LANDMARK,
      name: 'N/A',
      description: 'N/A',
      collectionName: 'N/A',
    };
    hook.rerender({ selectedMarkerDetail: emptyDetail, groups: GROUPS });
    act(() => hook.result.current.openEditFromSelected());
    expect(hook.result.current.landmarkForm?.initialValues).toMatchObject({
      name: '',
      description: '',
      collectionName: null,
    });

    hook.rerender({ selectedMarkerDetail: LANDMARK, groups: GROUPS });
    act(() => hook.result.current.openEditFromSelected());
    expect(hook.result.current.landmarkForm?.initialValues).toMatchObject({
      name: 'Entrance',
      description: 'Main entrance',
      collectionName: 'Survey A',
    });
    await waitFor(() => expect(hook.controller.getLandmarkCollections).toHaveBeenCalledTimes(2));
  });

  it('handles collection load failure and suppresses late collection results', async () => {
    const failed = renderActions({
      controller: createController({ getLandmarkCollections: vi.fn().mockRejectedValue(new Error('offline')) }),
    });
    act(() => failed.result.current.openCreateAtPoint({ latitude: 1, longitude: 2 }));
    await waitFor(() => expect(failed.controller.getLandmarkCollections).toHaveBeenCalledTimes(1));
    expect(failed.result.current.landmarkCollections).toEqual([]);

    const success = deferred<never[]>();
    const lateSuccess = renderActions({
      controller: createController({ getLandmarkCollections: vi.fn(() => success.promise) }),
    });
    act(() => lateSuccess.result.current.openCreateAtPoint({ latitude: 1, longitude: 2 }));
    lateSuccess.unmount();
    await act(async () => success.resolve([]));

    const failure = deferred<never[]>();
    const lateFailure = renderActions({
      controller: createController({ getLandmarkCollections: vi.fn(() => failure.promise) }),
    });
    act(() => lateFailure.result.current.openCreateAtPoint({ latitude: 1, longitude: 2 }));
    lateFailure.unmount();
    await act(async () => failure.reject(new Error('late')));
  });

  it('creates and edits through the controller and emits success toasts', async () => {
    vi.useFakeTimers();
    const createHook = renderActions();
    act(() => createHook.result.current.openCreateAtPoint({ latitude: 45, longitude: -73 }));
    act(() => createHook.result.current.submitLandmarkForm(INPUT));
    expect(createHook.result.current.landmarkFormBusy).toBe(true);
    await act(async () => {});
    expect(createHook.controller.createLandmark).toHaveBeenCalledWith(INPUT);
    expect(createHook.result.current.landmarkForm).toBeNull();
    expect(createHook.result.current.landmarkToast?.message).toBe('Landmark created');

    const editHook = renderActions();
    editHook.rerender({ selectedMarkerDetail: LANDMARK, groups: GROUPS });
    act(() => editHook.result.current.openEditFromSelected());
    act(() => editHook.result.current.submitLandmarkForm(INPUT));
    await act(async () => {});
    expect(editHook.controller.updateLandmark).toHaveBeenCalledWith(LANDMARK.id, INPUT);
    expect(editHook.result.current.landmarkToast?.message).toBe('Landmark updated');
  });

  it('guards missing/busy submission and busy cancellation', async () => {
    const submit = deferred<{ id: string }>();
    const hook = renderActions({
      controller: createController({ createLandmark: vi.fn(() => submit.promise) }),
    });
    act(() => hook.result.current.submitLandmarkForm(INPUT));
    expect(hook.controller.createLandmark).not.toHaveBeenCalled();

    act(() => hook.result.current.openCreateAtPoint({ latitude: 1, longitude: 2 }));
    await waitFor(() => expect(hook.result.current.landmarkCollections).toHaveLength(1));
    act(() => hook.result.current.submitLandmarkForm(INPUT));
    act(() => {
      hook.result.current.submitLandmarkForm(INPUT);
      hook.result.current.cancelLandmarkForm();
    });
    expect(hook.controller.createLandmark).toHaveBeenCalledTimes(1);
    expect(hook.result.current.landmarkForm).not.toBeNull();
    await act(async () => submit.resolve({ id: 'created' }));
    expect(hook.result.current.landmarkForm).toBeNull();

    act(() => hook.result.current.openCreateAtPoint({ latitude: 1, longitude: 2 }));
    act(() => hook.result.current.cancelLandmarkForm());
    expect(hook.result.current.landmarkForm).toBeNull();
    await waitFor(() => expect(hook.controller.getLandmarkCollections).toHaveBeenCalledTimes(2));
  });

  it('surfaces mutation and generic form errors', async () => {
    const mutation = renderActions({
      controller: createController({
        createLandmark: vi.fn().mockRejectedValue(
          new LandmarkMutationError('offline', 'Offline mutation unavailable.'),
        ),
      }),
    });
    act(() => mutation.result.current.openCreateAtPoint({ latitude: 1, longitude: 2 }));
    act(() => mutation.result.current.submitLandmarkForm(INPUT));
    await waitFor(() => expect(mutation.result.current.landmarkFormError)
      .toBe('Offline mutation unavailable.'));

    const generic = renderActions({
      controller: createController({ createLandmark: vi.fn().mockRejectedValue('bad') }),
    });
    act(() => generic.result.current.openCreateAtPoint({ latitude: 1, longitude: 2 }));
    act(() => generic.result.current.submitLandmarkForm(INPUT));
    await waitFor(() => expect(generic.result.current.landmarkFormError)
      .toBe('Something went wrong. Please try again.'));
  });

  it('suppresses successful and failed mutation completions after unmount', async () => {
    const success = deferred<{ id: string }>();
    const successHook = renderActions({
      controller: createController({ createLandmark: vi.fn(() => success.promise) }),
    });
    act(() => successHook.result.current.openCreateAtPoint({ latitude: 1, longitude: 2 }));
    act(() => successHook.result.current.submitLandmarkForm(INPUT));
    successHook.unmount();
    await act(async () => success.resolve({ id: 'created' }));

    const failure = deferred<never>();
    const failureHook = renderActions({
      controller: createController({ createLandmark: vi.fn(() => failure.promise) }),
    });
    act(() => failureHook.result.current.openCreateAtPoint({ latitude: 1, longitude: 2 }));
    act(() => failureHook.result.current.submitLandmarkForm(INPUT));
    failureHook.unmount();
    await act(async () => failure.reject(new Error('late')));
  });
});

describe('useDashboardLandmarkActions deletion', () => {
  it('ignores invalid selections and guards empty confirmation', () => {
    const hook = renderActions();
    act(() => {
      hook.result.current.openDeleteFromSelected();
      hook.result.current.confirmDeleteLandmark();
    });
    expect(hook.controller.deleteLandmark).not.toHaveBeenCalled();
  });

  it('opens, cancels, confirms, and guards cancellation while busy', async () => {
    const deletion = deferred<void>();
    const hook = renderActions({
      controller: createController({ deleteLandmark: vi.fn(() => deletion.promise) }),
    });
    hook.rerender({ selectedMarkerDetail: LANDMARK, groups: GROUPS });
    act(() => hook.result.current.openDeleteFromSelected());
    expect(hook.clearSelectedMarkerDetail).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.cancelDeleteLandmark());
    expect(hook.result.current.landmarkDeleteTarget).toBeNull();

    act(() => hook.result.current.openDeleteFromSelected());
    act(() => hook.result.current.confirmDeleteLandmark());
    expect(hook.result.current.landmarkDeleteBusy).toBe(true);
    act(() => {
      hook.result.current.cancelDeleteLandmark();
      hook.result.current.confirmDeleteLandmark();
    });
    expect(hook.controller.deleteLandmark).toHaveBeenCalledTimes(1);
    expect(hook.result.current.landmarkDeleteTarget).toEqual(LANDMARK);

    await act(async () => deletion.resolve());
    expect(hook.result.current.landmarkDeleteTarget).toBeNull();
    expect(hook.result.current.landmarkToast?.message).toBe('Landmark deleted');
  });

  it('reports gone, mutation, and generic deletion failures', async () => {
    const errors = [
      new LandmarkMutationError('not_found', 'gone'),
      new LandmarkMutationError('permission', 'No permission.'),
      new Error('generic'),
    ];
    const expected = [
      ['Landmark already removed', 'success'],
      ['No permission.', 'error'],
      ['Could not delete the landmark. Please try again.', 'error'],
    ];

    for (const [index, error] of errors.entries()) {
      const hook = renderActions({
        controller: createController({ deleteLandmark: vi.fn().mockRejectedValue(error) }),
      });
      hook.rerender({ selectedMarkerDetail: LANDMARK, groups: GROUPS });
      act(() => hook.result.current.openDeleteFromSelected());
      act(() => hook.result.current.confirmDeleteLandmark());
      await waitFor(() => expect(hook.result.current.landmarkDeleteBusy).toBe(false));
      expect(hook.result.current.landmarkToast).toEqual({
        message: expected[index][0],
        tone: expected[index][1],
      });
      hook.unmount();
    }
  });

  it('suppresses successful and failed deletion completions after unmount', async () => {
    const success = deferred<void>();
    const successHook = renderActions({
      controller: createController({ deleteLandmark: vi.fn(() => success.promise) }),
    });
    successHook.rerender({ selectedMarkerDetail: LANDMARK, groups: GROUPS });
    act(() => successHook.result.current.openDeleteFromSelected());
    act(() => successHook.result.current.confirmDeleteLandmark());
    successHook.unmount();
    await act(async () => success.resolve());

    const failure = deferred<void>();
    const failureHook = renderActions({
      controller: createController({ deleteLandmark: vi.fn(() => failure.promise) }),
    });
    failureHook.rerender({ selectedMarkerDetail: LANDMARK, groups: GROUPS });
    act(() => failureHook.result.current.openDeleteFromSelected());
    act(() => failureHook.result.current.confirmDeleteLandmark());
    failureHook.unmount();
    await act(async () => failure.reject(new Error('late')));
  });
});
