import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Map as MaplibreMap } from 'maplibre-gl';
import type { MapRef } from 'react-map-gl/maplibre';
import type { LandmarkFormInitialValues } from '../../components/LandmarkFormModal';
import type { SpeleoDBController } from '../../controllers/SpeleoDBController';
import { useMountedRef } from '../../hooks/useMountedRef';
import {
  getLandmarkCollectionCollapsedPreferences,
  getLandmarkCollectionVisibilityPreferences,
  setLandmarkCollectionCollapsedPreference,
  setLandmarkCollectionVisibilityPreference,
  setLandmarkCollectionVisibilityPreferences,
} from '../../services/PreferencesService';
import type { LandmarkCollection } from '../../types/landmark';
import { LandmarkMutationError } from '../../types/landmark';
import type {
  LandmarkCollectionGroup,
  LandmarkListItem,
} from '../../utils/landmarkCollections';
import type { NormalizedLandmarkInput } from '../../utils/landmarkMutations';
import type { LandmarkDetails, OverlayMarkerDetails } from '../../utils/overlayMarkerDetails';

type LandmarkController = Pick<
  SpeleoDBController,
  'getLandmarkCollections' | 'createLandmark' | 'updateLandmark' | 'deleteLandmark'
>;
type ToastTone = 'success' | 'error';
type VisibilityWriter = (collectionId: string, visible: boolean) => void;
type VisibilityBatchWriter = (updates: Record<string, boolean>) => void;
type CollapsedWriter = (collectionId: string, collapsed: boolean) => void;

export type LandmarkFormState =
  | { mode: 'create'; initialValues: LandmarkFormInitialValues; editId: null }
  | { mode: 'edit'; initialValues: LandmarkFormInitialValues; editId: string };

export interface LandmarkToastState {
  message: string;
  tone: ToastTone;
}

export interface DashboardLandmarkActionOptions {
  controller: LandmarkController;
  selectedMarkerDetail: OverlayMarkerDetails | null;
  clearSelectedMarkerDetail: () => void;
  groups: readonly LandmarkCollectionGroup[];
  landmarks: GeoJSON.FeatureCollection | undefined;
  mapRef: RefObject<MapRef | null>;
  onClosePanel: () => void;
  initialVisibility?: Record<string, boolean>;
  initialCollapsed?: Record<string, boolean>;
  writeVisibility?: VisibilityWriter;
  writeVisibilityBatch?: VisibilityBatchWriter;
  writeCollapsed?: CollapsedWriter;
}

export interface DashboardLandmarkActionState {
  collectionVisibility: Record<string, boolean>;
  collectionCollapsed: Record<string, boolean>;
  visibleLandmarks: GeoJSON.FeatureCollection | undefined;
  landmarkForm: LandmarkFormState | null;
  landmarkCollections: LandmarkCollection[];
  landmarkFormBusy: boolean;
  landmarkFormError: string | null;
  landmarkDeleteTarget: LandmarkDetails | null;
  landmarkDeleteBusy: boolean;
  landmarkToast: LandmarkToastState | null;
  showToast: (message: string, tone: ToastTone) => void;
  toggleCollection: (collectionId: string, visible: boolean) => void;
  toggleCollectionCollapsed: (collectionId: string, collapsed: boolean) => void;
  showAll: () => void;
  hideAll: () => void;
  locateLandmark: (landmark: LandmarkListItem) => void;
  openCreateFromSelected: () => void;
  openCreateAtPoint: (point: { latitude: number; longitude: number }) => void;
  openEditFromSelected: () => void;
  openDeleteFromSelected: () => void;
  cancelLandmarkForm: () => void;
  submitLandmarkForm: (value: NormalizedLandmarkInput) => void;
  cancelDeleteLandmark: () => void;
  confirmDeleteLandmark: () => void;
}

export function filterVisibleLandmarks(
  landmarks: GeoJSON.FeatureCollection | undefined,
  visibility: Readonly<Record<string, boolean>>,
): GeoJSON.FeatureCollection | undefined {
  if (!landmarks) return undefined;
  const features = landmarks.features.filter((feature) => {
    const collectionId = String(feature.properties?.collection ?? '') || '__personal__';
    return visibility[collectionId] !== false;
  });
  return { ...landmarks, features };
}

function collectionVisibilityUpdates(
  groups: readonly LandmarkCollectionGroup[],
  visible: boolean,
): Record<string, boolean> {
  return Object.fromEntries(groups.map((group) => [group.id, visible]));
}

interface CollectionActionOptions {
  groups: readonly LandmarkCollectionGroup[];
  landmarks: GeoJSON.FeatureCollection | undefined;
  mapRef: RefObject<MapRef | null>;
  onClosePanel: () => void;
  initialVisibility?: Record<string, boolean>;
  initialCollapsed?: Record<string, boolean>;
  writeVisibility: VisibilityWriter;
  writeVisibilityBatch: VisibilityBatchWriter;
  writeCollapsed: CollapsedWriter;
}

function useLandmarkCollectionActions(options: CollectionActionOptions) {
  const {
    groups,
    landmarks,
    mapRef,
    onClosePanel,
    initialVisibility,
    initialCollapsed,
    writeVisibility,
    writeVisibilityBatch,
    writeCollapsed,
  } = options;
  const [collectionVisibility, setCollectionVisibility] = useState<Record<string, boolean>>(
    () => initialVisibility ?? getLandmarkCollectionVisibilityPreferences(),
  );
  const [collectionCollapsed, setCollectionCollapsed] = useState<Record<string, boolean>>(
    () => initialCollapsed ?? getLandmarkCollectionCollapsedPreferences(),
  );
  const visibleLandmarks = useMemo(
    () => filterVisibleLandmarks(landmarks, collectionVisibility),
    [collectionVisibility, landmarks],
  );

  const toggleCollection = useCallback((collectionId: string, visible: boolean) => {
    setCollectionVisibility((previous) => ({ ...previous, [collectionId]: visible }));
    writeVisibility(collectionId, visible);
  }, [writeVisibility]);

  const toggleCollectionCollapsed = useCallback((collectionId: string, collapsed: boolean) => {
    setCollectionCollapsed((previous) => ({ ...previous, [collectionId]: collapsed }));
    writeCollapsed(collectionId, collapsed);
  }, [writeCollapsed]);

  const setAllVisibility = useCallback((visible: boolean) => {
    const updates = collectionVisibilityUpdates(groups, visible);
    if (Object.keys(updates).length === 0) return;
    setCollectionVisibility((previous) => ({ ...previous, ...updates }));
    writeVisibilityBatch(updates);
  }, [groups, writeVisibilityBatch]);

  const locateLandmark = useCallback((landmark: LandmarkListItem) => {
    onClosePanel();
    const map = mapRef.current;
    if (!map) return;
    (map.getMap() as MaplibreMap).flyTo({
      center: [landmark.longitude, landmark.latitude],
      zoom: 16,
      duration: 1000,
    });
  }, [mapRef, onClosePanel]);

  return {
    collectionVisibility,
    collectionCollapsed,
    visibleLandmarks,
    toggleCollection,
    toggleCollectionCollapsed,
    showAll: useCallback(() => setAllVisibility(true), [setAllVisibility]),
    hideAll: useCallback(() => setAllVisibility(false), [setAllVisibility]),
    locateLandmark,
  };
}

function useLandmarkToast() {
  const [landmarkToast, setLandmarkToast] = useState<LandmarkToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);

  const showToast = useCallback((message: string, tone: ToastTone) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setLandmarkToast({ message, tone });
    timerRef.current = setTimeout(() => {
      setLandmarkToast(null);
      timerRef.current = null;
    }, 3000);
  }, []);

  return { landmarkToast, showToast };
}

interface FormActionOptions {
  controller: LandmarkController;
  selectedMarkerDetail: OverlayMarkerDetails | null;
  clearSelectedMarkerDetail: () => void;
  mountedRef: ReturnType<typeof useMountedRef>;
  showToast: DashboardLandmarkActionState['showToast'];
}

type FormSetter = Dispatch<SetStateAction<LandmarkFormState | null>>;
type FormErrorSetter = Dispatch<SetStateAction<string | null>>;

function useLandmarkCollectionLoader(
  controller: LandmarkController,
  mountedRef: ReturnType<typeof useMountedRef>,
) {
  const [landmarkCollections, setLandmarkCollections] = useState<LandmarkCollection[]>([]);
  const loadCollections = useCallback(() => {
    void (async () => {
      try {
        const collections = await controller.getLandmarkCollections();
        if (mountedRef.current) setLandmarkCollections(collections);
      } catch {
        if (mountedRef.current) setLandmarkCollections([]);
      }
    })();
  }, [controller, mountedRef]);
  return { landmarkCollections, loadCollections };
}

function useLandmarkFormOpenActions(
  selectedMarkerDetail: OverlayMarkerDetails | null,
  clearSelectedMarkerDetail: () => void,
  loadCollections: () => void,
  setLandmarkForm: FormSetter,
  setLandmarkFormError: FormErrorSetter,
) {
  const openCreateAtPoint = useCallback((point: { latitude: number; longitude: number }) => {
    setLandmarkFormError(null);
    setLandmarkForm({
      mode: 'create',
      editId: null,
      initialValues: { latitude: point.latitude, longitude: point.longitude },
    });
    loadCollections();
  }, [loadCollections, setLandmarkForm, setLandmarkFormError]);

  const openCreateFromSelected = useCallback(() => {
    const detail = selectedMarkerDetail;
    if (!detail || detail.type !== 'mapLongPress') return;
    clearSelectedMarkerDetail();
    openCreateAtPoint(detail);
  }, [clearSelectedMarkerDetail, openCreateAtPoint, selectedMarkerDetail]);

  const openEditFromSelected = useCallback(() => {
    const detail = selectedMarkerDetail;
    if (!detail || detail.type !== 'landmark') return;
    clearSelectedMarkerDetail();
    setLandmarkFormError(null);
    setLandmarkForm({
      mode: 'edit',
      editId: detail.id,
      initialValues: {
        name: detail.name === 'N/A' ? '' : detail.name,
        description: detail.description === 'N/A' ? '' : detail.description,
        latitude: detail.latitude,
        longitude: detail.longitude,
        collectionId: detail.collectionId,
        collectionName: detail.collectionName === 'N/A' ? null : detail.collectionName,
      },
    });
    loadCollections();
  }, [
    clearSelectedMarkerDetail,
    loadCollections,
    selectedMarkerDetail,
    setLandmarkForm,
    setLandmarkFormError,
  ]);

  return { openCreateAtPoint, openCreateFromSelected, openEditFromSelected };
}

function useLandmarkFormSubmission(
  options: Pick<FormActionOptions, 'controller' | 'mountedRef' | 'showToast'>,
  landmarkForm: LandmarkFormState | null,
  landmarkFormBusy: boolean,
  setLandmarkForm: FormSetter,
  setLandmarkFormBusy: Dispatch<SetStateAction<boolean>>,
  setLandmarkFormError: FormErrorSetter,
) {
  const { controller, mountedRef, showToast } = options;

  const cancelLandmarkForm = useCallback(() => {
    if (landmarkFormBusy) return;
    setLandmarkForm(null);
    setLandmarkFormError(null);
  }, [landmarkFormBusy, setLandmarkForm, setLandmarkFormError]);

  const submitLandmarkForm = useCallback((value: NormalizedLandmarkInput) => {
    const form = landmarkForm;
    if (!form || landmarkFormBusy) return;
    setLandmarkFormBusy(true);
    setLandmarkFormError(null);
    void submitLandmarkMutation(controller, form, value)
      .then(() => {
        if (!mountedRef.current) return;
        setLandmarkForm(null);
        showToast(form.mode === 'create' ? 'Landmark created' : 'Landmark updated', 'success');
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) return;
        setLandmarkFormError(
          error instanceof LandmarkMutationError
            ? error.message
            : 'Something went wrong. Please try again.',
        );
      })
      .finally(() => {
        if (mountedRef.current) setLandmarkFormBusy(false);
      });
  }, [controller, landmarkForm, landmarkFormBusy, mountedRef, setLandmarkForm, setLandmarkFormBusy, setLandmarkFormError, showToast]);

  return { cancelLandmarkForm, submitLandmarkForm };
}

function useLandmarkFormActions(options: FormActionOptions) {
  const [landmarkForm, setLandmarkForm] = useState<LandmarkFormState | null>(null);
  const [landmarkFormBusy, setLandmarkFormBusy] = useState(false);
  const [landmarkFormError, setLandmarkFormError] = useState<string | null>(null);
  const { landmarkCollections, loadCollections } = useLandmarkCollectionLoader(
    options.controller,
    options.mountedRef,
  );
  const openActions = useLandmarkFormOpenActions(
    options.selectedMarkerDetail,
    options.clearSelectedMarkerDetail,
    loadCollections,
    setLandmarkForm,
    setLandmarkFormError,
  );
  const submission = useLandmarkFormSubmission(
    options,
    landmarkForm,
    landmarkFormBusy,
    setLandmarkForm,
    setLandmarkFormBusy,
    setLandmarkFormError,
  );

  return {
    landmarkForm,
    landmarkCollections,
    landmarkFormBusy,
    landmarkFormError,
    ...openActions,
    ...submission,
  };
}

async function submitLandmarkMutation(
  controller: LandmarkController,
  form: LandmarkFormState,
  value: NormalizedLandmarkInput,
): Promise<void> {
  const input = {
    name: value.name,
    description: value.description,
    latitude: value.latitude,
    longitude: value.longitude,
    collection: value.collection,
  };
  if (form.mode === 'create') await controller.createLandmark(input);
  else await controller.updateLandmark(form.editId, input);
}

interface DeleteActionOptions {
  controller: LandmarkController;
  selectedMarkerDetail: OverlayMarkerDetails | null;
  clearSelectedMarkerDetail: () => void;
  mountedRef: ReturnType<typeof useMountedRef>;
  showToast: DashboardLandmarkActionState['showToast'];
}

function useLandmarkDeleteActions(options: DeleteActionOptions) {
  const {
    controller,
    selectedMarkerDetail,
    clearSelectedMarkerDetail,
    mountedRef,
    showToast,
  } = options;
  const [landmarkDeleteTarget, setLandmarkDeleteTarget] = useState<LandmarkDetails | null>(null);
  const [landmarkDeleteBusy, setLandmarkDeleteBusy] = useState(false);
  const openDeleteFromSelected = useCallback(() => {
    const detail = selectedMarkerDetail;
    if (!detail || detail.type !== 'landmark') return;
    clearSelectedMarkerDetail();
    setLandmarkDeleteTarget(detail);
  }, [clearSelectedMarkerDetail, selectedMarkerDetail]);
  const cancelDeleteLandmark = useCallback(() => {
    if (!landmarkDeleteBusy) setLandmarkDeleteTarget(null);
  }, [landmarkDeleteBusy]);
  const confirmDeleteLandmark = useCallback(() => {
    const target = landmarkDeleteTarget;
    if (!target || landmarkDeleteBusy) return;
    setLandmarkDeleteBusy(true);
    const publishOptions = { mountedRef, showToast };
    void controller.deleteLandmark(target.id)
      .then(() => publishDeleteSuccess(publishOptions, setLandmarkDeleteTarget))
      .catch((error: unknown) => publishDeleteFailure(publishOptions, error, setLandmarkDeleteTarget))
      .finally(() => {
        if (mountedRef.current) setLandmarkDeleteBusy(false);
      });
  }, [controller, landmarkDeleteBusy, landmarkDeleteTarget, mountedRef, showToast]);

  return {
    landmarkDeleteTarget,
    landmarkDeleteBusy,
    openDeleteFromSelected,
    cancelDeleteLandmark,
    confirmDeleteLandmark,
  };
}

function publishDeleteSuccess(
  options: Pick<DeleteActionOptions, 'mountedRef' | 'showToast'>,
  clearTarget: (target: null) => void,
): void {
  if (!options.mountedRef.current) return;
  clearTarget(null);
  options.showToast('Landmark deleted', 'success');
}

function publishDeleteFailure(
  options: Pick<DeleteActionOptions, 'mountedRef' | 'showToast'>,
  error: unknown,
  clearTarget: (target: null) => void,
): void {
  if (!options.mountedRef.current) return;
  const isGone = error instanceof LandmarkMutationError && error.kind === 'not_found';
  clearTarget(null);
  options.showToast(
    isGone
      ? 'Landmark already removed'
      : error instanceof LandmarkMutationError
        ? error.message
        : 'Could not delete the landmark. Please try again.',
    isGone ? 'success' : 'error',
  );
}

export function useDashboardLandmarkActions({
  writeVisibility = setLandmarkCollectionVisibilityPreference,
  writeVisibilityBatch = setLandmarkCollectionVisibilityPreferences,
  writeCollapsed = setLandmarkCollectionCollapsedPreference,
  ...options
}: DashboardLandmarkActionOptions): DashboardLandmarkActionState {
  const mountedRef = useMountedRef();
  const toast = useLandmarkToast();
  const collections = useLandmarkCollectionActions({
    ...options,
    writeVisibility,
    writeVisibilityBatch,
    writeCollapsed,
  });
  const form = useLandmarkFormActions({ ...options, mountedRef, showToast: toast.showToast });
  const deletion = useLandmarkDeleteActions({ ...options, mountedRef, showToast: toast.showToast });
  return { ...collections, ...form, ...deletion, ...toast };
}
