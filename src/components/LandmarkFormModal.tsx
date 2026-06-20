import React, { useEffect, useRef, useState } from 'react';
import { IonContent, IonModal } from '@ionic/react';
import type { LandmarkCollection } from '../types/landmark';
import {
  validateLandmarkInput,
  type NormalizedLandmarkInput,
} from '../utils/landmarkMutations';

export type LandmarkFormMode = 'create' | 'edit';

export interface LandmarkFormInitialValues {
  name?: string;
  description?: string;
  latitude: number | null;
  longitude: number | null;
  collectionId?: string | null;
  /** Display name for the current collection (edit mode), to keep it selectable. */
  collectionName?: string | null;
}

export interface LandmarkFormModalProps {
  isOpen: boolean;
  mode: LandmarkFormMode;
  initialValues: LandmarkFormInitialValues;
  /** Writable collections for the picker (already filtered to can-write). */
  collections: LandmarkCollection[];
  /** True while the submit request is in flight. */
  busy?: boolean;
  /** Server-side error message to surface (e.g. duplicate coordinate). */
  submitError?: string | null;
  onSubmit: (value: NormalizedLandmarkInput) => void;
  onCancel: () => void;
}

const PERSONAL_OPTION_VALUE = '';

function formatCoordinate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  return String(parseFloat(value.toFixed(7)));
}

interface CollectionOption {
  value: string;
  label: string;
}

function buildCollectionOptions(
  collections: LandmarkCollection[],
  initial: LandmarkFormInitialValues,
): CollectionOption[] {
  const options: CollectionOption[] = collections.map((c) => ({
    value: c.id,
    label: c.isPersonal ? `${c.name} (Private)` : c.name,
  }));

  const hasPersonal = collections.some((c) => c.isPersonal);
  if (!hasPersonal) {
    // Fallback so the user can always target their personal collection even if
    // the collections list could not be loaded. value '' -> send collection null.
    options.unshift({ value: PERSONAL_OPTION_VALUE, label: 'Personal Landmarks' });
  }

  // In edit mode, keep the landmark's current collection selectable even if it
  // is not present in the writable list returned by the API.
  const currentId = initial.collectionId ?? null;
  if (currentId && !options.some((o) => o.value === currentId)) {
    options.push({ value: currentId, label: initial.collectionName ?? 'Current collection' });
  }

  return options;
}

function pickInitialCollectionValue(
  collections: LandmarkCollection[],
  initial: LandmarkFormInitialValues,
): string {
  if (initial.collectionId) return initial.collectionId;
  const personal = collections.find((c) => c.isPersonal);
  return personal ? personal.id : PERSONAL_OPTION_VALUE;
}

/**
 * Shared create/edit form for landmarks. Presentational: it validates locally
 * and calls `onSubmit` with normalized values; the parent performs the network
 * mutation and feeds back `busy` / `submitError`.
 */
const LandmarkFormModal: React.FC<LandmarkFormModalProps> = ({
  isOpen,
  mode,
  initialValues,
  collections,
  busy = false,
  submitError = null,
  onSubmit,
  onCancel,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [collection, setCollection] = useState(PERSONAL_OPTION_VALUE);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const wasOpenRef = useRef(false);
  // The collection list is loaded asynchronously after the modal opens. Track
  // whether the user has changed the picker so we can keep the default in sync
  // with the (late-arriving) collections WITHOUT clobbering a manual choice.
  const collectionTouchedRef = useRef(false);

  // Seed fields from initialValues each time the modal opens.
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setName(initialValues.name ?? '');
      setDescription(initialValues.description ?? '');
      setLatitude(formatCoordinate(initialValues.latitude));
      setLongitude(formatCoordinate(initialValues.longitude));
      setCollection(pickInitialCollectionValue(collections, initialValues));
      setFieldErrors({});
      collectionTouchedRef.current = false;
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, initialValues, collections]);

  // Re-seed the collection default once the writable list arrives (it loads
  // async, after the modal is already open). Without this, the controlled
  // <select> keeps a stale value ('' / a now-dropped fallback option) that no
  // longer matches any rendered option, so the browser visually shows the first
  // option while the submitted value differs -- the form would create the
  // landmark in a different collection than the one shown. Skipped once the user
  // picks a collection so a manual choice is never overwritten.
  useEffect(() => {
    if (isOpen && !collectionTouchedRef.current) {
      setCollection(pickInitialCollectionValue(collections, initialValues));
    }
  }, [isOpen, collections, initialValues]);

  const options = buildCollectionOptions(collections, initialValues);

  const handleSubmit = () => {
    const result = validateLandmarkInput({
      name,
      description,
      latitude,
      longitude,
      collection: collection === PERSONAL_OPTION_VALUE ? null : collection,
    });
    if (!result.ok || !result.value) {
      setFieldErrors(result.fieldErrors);
      return;
    }
    setFieldErrors({});
    onSubmit(result.value);
  };

  const title = mode === 'create' ? 'Create Landmark' : 'Edit Landmark';
  const submitLabel = mode === 'create' ? 'Create' : 'Save';

  return (
    <IonModal
      isOpen={isOpen}
      onDidDismiss={() => {
        if (!busy) onCancel();
      }}
      canDismiss={!busy}
      backdropDismiss={!busy}
    >
      <IonContent className="ion-padding">
        <div
          data-testid="landmark-form-modal"
          className="flex flex-col h-full justify-center max-w-sm mx-auto"
        >
          <h2 className="text-xl font-semibold text-slate-100 mb-5 text-center">{title}</h2>

          <div className="space-y-4">
            <div>
              <label htmlFor="landmark-name" className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
                Name
              </label>
              <input
                id="landmark-name"
                data-testid="landmark-name-input"
                type="text"
                value={name}
                maxLength={120}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2.5 text-sm text-slate-200 bg-transparent border border-slate-700 rounded-lg focus:outline-none focus:border-purple-500 transition-colors placeholder:text-slate-500 disabled:opacity-50"
                placeholder="Landmark name"
              />
              {fieldErrors.name && (
                <p data-testid="landmark-name-error" className="text-red-400 text-xs mt-1">{fieldErrors.name}</p>
              )}
            </div>

            <div>
              <label htmlFor="landmark-description" className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
                Description
              </label>
              <textarea
                id="landmark-description"
                data-testid="landmark-description-input"
                value={description}
                rows={3}
                disabled={busy}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-4 py-2.5 text-sm text-slate-200 bg-transparent border border-slate-700 rounded-lg focus:outline-none focus:border-purple-500 transition-colors placeholder:text-slate-500 disabled:opacity-50 resize-none"
                placeholder="Optional description"
              />
            </div>

            <div>
              <label htmlFor="landmark-collection" className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
                Collection
              </label>
              <select
                id="landmark-collection"
                data-testid="landmark-collection-select"
                value={collection}
                disabled={busy}
                onChange={(e) => {
                  collectionTouchedRef.current = true;
                  setCollection(e.target.value);
                }}
                className="w-full px-4 py-2.5 text-sm text-slate-200 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-purple-500 transition-colors disabled:opacity-50"
              >
                {options.map((opt) => (
                  <option key={opt.value || '__personal__'} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="landmark-latitude" className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
                  Latitude
                </label>
                <input
                  id="landmark-latitude"
                  data-testid="landmark-latitude-input"
                  type="text"
                  inputMode="decimal"
                  value={latitude}
                  disabled={busy}
                  onChange={(e) => setLatitude(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm text-slate-200 bg-transparent border border-slate-700 rounded-lg focus:outline-none focus:border-purple-500 transition-colors disabled:opacity-50"
                />
                {fieldErrors.latitude && (
                  <p data-testid="landmark-latitude-error" className="text-red-400 text-xs mt-1">{fieldErrors.latitude}</p>
                )}
              </div>
              <div>
                <label htmlFor="landmark-longitude" className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
                  Longitude
                </label>
                <input
                  id="landmark-longitude"
                  data-testid="landmark-longitude-input"
                  type="text"
                  inputMode="decimal"
                  value={longitude}
                  disabled={busy}
                  onChange={(e) => setLongitude(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm text-slate-200 bg-transparent border border-slate-700 rounded-lg focus:outline-none focus:border-purple-500 transition-colors disabled:opacity-50"
                />
                {fieldErrors.longitude && (
                  <p data-testid="landmark-longitude-error" className="text-red-400 text-xs mt-1">{fieldErrors.longitude}</p>
                )}
              </div>
            </div>

            {submitError && (
              <p data-testid="landmark-submit-error" className="text-red-400 text-sm">{submitError}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 mt-6">
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              data-testid="landmark-form-cancel"
              className="app-btn app-btn--secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleSubmit}
              data-testid="landmark-form-submit"
              className="app-btn app-btn--primary"
            >
              {busy ? `${submitLabel}\u2026` : submitLabel}
            </button>
          </div>
        </div>
      </IonContent>
    </IonModal>
  );
};

export default LandmarkFormModal;
