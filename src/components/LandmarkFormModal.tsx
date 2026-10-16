import { LANDMARK_ICON_OPTIONS, normalizeLandmarkIcon, type LandmarkIcon } from '@speleodb/map-core';
import { LandmarkIconPreview } from './LandmarkIconPreview';
import React, { useEffect, useRef, useState } from 'react';
import { IonContent, IonModal } from '@ionic/react';
import type { LandmarkCollection } from '../types/landmark';
import {
  validateLandmarkInput,
  type NormalizedLandmarkInput,
} from '../utils/landmarkMutations';

export type LandmarkFormMode = 'create' | 'edit';

export interface LandmarkFormInitialValues {
  icon?: LandmarkIcon;
  collectionColor?: string;
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
  const [icon, setIcon] = useState<LandmarkIcon>('DEFAULT');
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
      setIcon(normalizeLandmarkIcon(initialValues.icon));
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
  const iconColor = collections.find(value => value.id === collection)?.color
    ?? (collection === initialValues.collectionId ? initialValues.collectionColor : undefined);

  const handleSubmit = () => {
    const result = validateLandmarkInput({
      icon,
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
      className="landmark-form-modal"
      aria-labelledby="landmark-form-title"
      onDidDismiss={() => {
        if (!busy) onCancel();
      }}
      canDismiss={!busy}
      backdropDismiss={!busy}
    >
      <IonContent className="landmark-form-content">
        <div data-testid="landmark-form-modal" className="landmark-form">
          <header className="landmark-form__header">
            <h2 id="landmark-form-title">{title}</h2>
            <p>{mode === 'create' ? 'Add a point of interest to your map.' : 'Update this point of interest.'}</p>
          </header>

          <div className="landmark-form__fields">
            <div className="landmark-form__field">
              <label htmlFor="landmark-name" className="landmark-form__label">Name</label>
              <input
                id="landmark-name"
                data-testid="landmark-name-input"
                type="text"
                value={name}
                maxLength={120}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                className="landmark-form__input"
                placeholder="e.g. North cave entrance"
                aria-invalid={!!fieldErrors.name}
                aria-describedby={fieldErrors.name ? 'landmark-name-error' : undefined}
              />
              {fieldErrors.name && (
                <p id="landmark-name-error" data-testid="landmark-name-error" className="landmark-form__error" role="alert">
                  {fieldErrors.name}
                </p>
              )}
            </div>

            <div className="landmark-form__field">
              <label htmlFor="landmark-collection" className="landmark-form__label">Collection</label>
              <div className="landmark-form__select">
                <select
                  id="landmark-collection"
                  data-testid="landmark-collection-select"
                  value={collection}
                  disabled={busy}
                  onChange={(e) => {
                    collectionTouchedRef.current = true;
                    setCollection(e.target.value);
                  }}
                  className="landmark-form__input"
                >
                  {options.map((opt) => (
                    <option key={opt.value || '__personal__'} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                  <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>

            <fieldset className="landmark-form__symbols" disabled={busy} aria-describedby="landmark-icon-hint">
              <legend className="landmark-form__label">Map icon</legend>
              <p id="landmark-icon-hint" className="landmark-form__hint">Choose a symbol. Color follows the collection.</p>
              <div className="landmark-form__icon-grid">
                {LANDMARK_ICON_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    className={`app-btn ${icon === option.value ? 'app-btn--primary' : 'app-btn--secondary'} landmark-form__icon-card`}
                    aria-pressed={icon === option.value}
                    aria-label={`Icon: ${option.label}`}
                    onClick={() => setIcon(option.value)}
                  >
                    {icon === option.value && (
                      <svg className="landmark-form__icon-check" aria-hidden="true" viewBox="0 0 16 16" fill="none">
                        <path d="m4 8 2.5 2.5L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                    <div className="landmark-form__icon-artwork">
                      <LandmarkIconPreview icon={option.value} color={iconColor} />
                    </div>
                    <span className="landmark-form__icon-label">{option.label}</span>
                  </button>
                ))}
              </div>
              {fieldErrors.icon && <p role="alert" className="landmark-form__error">{fieldErrors.icon}</p>}
            </fieldset>

            <div className="landmark-form__field">
              <label htmlFor="landmark-description" className="landmark-form__label">
                Description <span className="landmark-form__optional">Optional</span>
              </label>
              <textarea
                id="landmark-description"
                data-testid="landmark-description-input"
                value={description}
                rows={2}
                disabled={busy}
                onChange={(e) => setDescription(e.target.value)}
                className="landmark-form__input landmark-form__description"
                placeholder="Access notes, directions, or useful details…"
              />
            </div>

            <fieldset className="landmark-form__location" disabled={busy}>
              <legend className="landmark-form__label">Coordinates</legend>
              <div className="landmark-form__coordinates">
                <div className="landmark-form__field">
                  <label htmlFor="landmark-latitude" className="landmark-form__coordinate-label">Latitude</label>
                  <input
                    id="landmark-latitude"
                    data-testid="landmark-latitude-input"
                    type="text"
                    inputMode="decimal"
                    value={latitude}
                    disabled={busy}
                    onChange={(e) => setLatitude(e.target.value)}
                    className="landmark-form__input landmark-form__coordinate-input"
                    aria-invalid={!!fieldErrors.latitude}
                    aria-describedby={fieldErrors.latitude ? 'landmark-latitude-error' : undefined}
                  />
                  {fieldErrors.latitude && (
                    <p id="landmark-latitude-error" data-testid="landmark-latitude-error" className="landmark-form__error" role="alert">
                      {fieldErrors.latitude}
                    </p>
                  )}
                </div>
                <div className="landmark-form__field">
                  <label htmlFor="landmark-longitude" className="landmark-form__coordinate-label">Longitude</label>
                  <input
                    id="landmark-longitude"
                    data-testid="landmark-longitude-input"
                    type="text"
                    inputMode="decimal"
                    value={longitude}
                    disabled={busy}
                    onChange={(e) => setLongitude(e.target.value)}
                    className="landmark-form__input landmark-form__coordinate-input"
                    aria-invalid={!!fieldErrors.longitude}
                    aria-describedby={fieldErrors.longitude ? 'landmark-longitude-error' : undefined}
                  />
                  {fieldErrors.longitude && (
                    <p id="landmark-longitude-error" data-testid="landmark-longitude-error" className="landmark-form__error" role="alert">
                      {fieldErrors.longitude}
                    </p>
                  )}
                </div>
              </div>
            </fieldset>

            {submitError && (
              <p data-testid="landmark-submit-error" className="landmark-form__error landmark-form__submit-error" role="alert">
                {submitError}
              </p>
            )}
          </div>

          <footer className="landmark-form__actions">
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
          </footer>
        </div>
      </IonContent>
    </IonModal>
  );
};

export default LandmarkFormModal;
