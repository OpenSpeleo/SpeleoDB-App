import React, { useRef, useState } from 'react';
import { IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonToggle } from '@ionic/react';
import { chevronDownOutline } from 'ionicons/icons';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import {
  createDefaultMapDisplayPreferences,
  MAP_DISPLAY_CATEGORIES,
  MAP_STATION_TYPES,
  type MapDisplayPreferences,
  type MapDisplayPreferencesPatch,
} from '../types/mapDisplayPreferences';
import type { MapColorMode } from '../types/mapColorMode';
import type { MeasurementUnit } from '../types/measurementUnit';
import {
  formatDepthLimitInput,
  formatDepthLimitLabel,
  parseDepthLimitInput,
} from '../utils/depthLimit';

interface MapDisplaySettingsProps {
  preferences: MapDisplayPreferences;
  onChange: (patch: MapDisplayPreferencesPatch) => void;
  colorMode: MapColorMode;
  onColorModeChange: (mode: MapColorMode) => void;
  measurementUnit: MeasurementUnit;
  onMeasurementUnitChange: (unit: MeasurementUnit) => void;
}

const DEPTH_ERROR = 'Enter a number greater than zero, or leave blank for the full range.';

function DisclosureChevron() {
  return <IonIcon icon={chevronDownOutline} className="map-settings-disclosure-chevron" aria-hidden="true" />;
}

function restoreDisclosureFocus(event: React.SyntheticEvent<HTMLDetailsElement>) {
  const disclosure = event.currentTarget;
  if (event.target !== disclosure || disclosure.open) return;
  if (disclosure.contains(document.activeElement)) {
    disclosure.querySelector<HTMLElement>(':scope > summary')?.focus({ preventScroll: true });
  }
}

/** Display-only controls: the authenticated shell owns preference state and persistence. */
const MapDisplaySettings: React.FC<MapDisplaySettingsProps> = ({
  preferences,
  onChange,
  colorMode,
  onColorModeChange,
  measurementUnit,
  onMeasurementUnitChange,
}) => {
  const [depthDraft, setDepthDraft] = useState<string | null>(null);
  const [showDepthError, setShowDepthError] = useState(false);
  const draftDirty = useRef(false);
  const resetPointerDown = useRef(false);
  const depthDisclosure = useRef<HTMLDetailsElement>(null);
  const depthInput = useRef<HTMLInputElement>(null);
  const allShown = MAP_DISPLAY_CATEGORIES.every(({ id }) => preferences.categories[id])
    && MAP_STATION_TYPES.every(({ id }) => preferences.stationTypes[id]);
  const selectedTypeCount = MAP_STATION_TYPES.filter(({ id }) => preferences.stationTypes[id]).length;
  const depthValue = depthDraft ?? (preferences.depthLimitFeet === null
    ? '' : formatDepthLimitInput(preferences.depthLimitFeet, measurementUnit));

  const changeVisibility = (patch: MapDisplayPreferencesPatch) => {
    onChange(patch);
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  };

  const commitDepthLimit = (): boolean => {
    if (!draftDirty.current) return true;
    const parsed = parseDepthLimitInput(depthValue, measurementUnit);
    if (!parsed.valid) {
      setShowDepthError(true);
      return false;
    }
    // Done can trigger blur in the same event. Clear the ref before publishing
    // so a single user edit cannot write preferences twice.
    draftDirty.current = false;
    setDepthDraft(null);
    setShowDepthError(false);
    onChange({ depthLimitFeet: parsed.value });
    return true;
  };

  const resetDepthLimit = () => {
    resetPointerDown.current = false;
    draftDirty.current = false;
    setDepthDraft(null);
    setShowDepthError(false);
    onChange({ depthLimitFeet: null });
  };

  return (
    <IonList inset className="map-display-settings">
      <IonListHeader><IonLabel>Map Settings</IonLabel></IonListHeader>
      <IonItem data-tour="settings-color-mode">
        <IonLabel>Color mode</IonLabel>
        <div slot="end" className="map-settings-select-wrap">
          <select
            value={colorMode}
            onChange={(event) => {
              if (event.target.value !== 'depth') {
                commitDepthLimit();
                draftDirty.current = false;
                setDepthDraft(null);
                setShowDepthError(false);
              }
              onColorModeChange(event.target.value as MapColorMode);
            }}
            data-testid="color-mode-selector"
            aria-label="Color mode"
            className="map-settings-select"
          >
            <option value="project">By Project</option>
            <option value="depth">By Depth</option>
            <option value="shot">By Shot</option>
          </select>
          <IonIcon icon={chevronDownOutline} className="map-settings-select-chevron" aria-hidden="true" />
        </div>
      </IonItem>

      {colorMode === 'shot' && (
        <p className="map-settings-description map-settings-visibility-help">
          Shots without a color use their project color.
        </p>
      )}

      {colorMode === 'depth' && (
        <details
          ref={depthDisclosure}
          className="map-settings-disclosure map-settings-depth"
          data-testid="depth-limit-disclosure"
          onToggle={(event) => {
            restoreDisclosureFocus(event);
            if (!event.currentTarget.open) commitDepthLimit();
          }}
        >
          <summary data-testid="depth-limit-summary">
            <span>Depth limit</span>
            <span className="map-settings-summary-value">
              {preferences.depthLimitFeet === null
                ? 'Full range' : formatDepthLimitLabel(preferences.depthLimitFeet, measurementUnit)}
            </span>
            <DisclosureChevron />
          </summary>
          <div className="map-settings-depth-body">
            <p className="map-settings-description">
              Spread colors across the depths you want to compare. Deeper passages remain visible at the deepest color.
            </p>
            <label htmlFor="map-depth-limit">Maximum depth</label>
            <div className="map-settings-depth-input-wrap">
              <input
                ref={depthInput}
                id="map-depth-limit"
                type="text"
                inputMode="decimal"
                enterKeyHint="done"
                autoComplete="off"
                spellCheck={false}
                placeholder="Full range"
                value={depthValue}
                aria-describedby="map-depth-limit-help map-depth-limit-error map-depth-limit-unit"
                aria-invalid={showDepthError}
                onFocus={() => {
                  // A canceled Reset press may release outside the button.
                  // Returning to the field begins a fresh edit/blur cycle.
                  resetPointerDown.current = false;
                }}
                onChange={(event) => {
                  draftDirty.current = true;
                  setDepthDraft(event.target.value);
                  setShowDepthError(!parseDepthLimitInput(event.target.value, measurementUnit).valid);
                }}
                onBlur={() => {
                  // Reset is an explicit discard action: do not briefly apply
                  // the draft between input blur and the button's click. iOS
                  // can omit relatedTarget even when the button caused blur.
                  if (resetPointerDown.current) return;
                  commitDepthLimit();
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  if (commitDepthLimit()) event.currentTarget.blur();
                }}
              />
              <span id="map-depth-limit-unit" className="map-settings-depth-unit">
                {measurementUnit === 'meters' ? 'm' : 'ft'}
              </span>
            </div>
            <p id="map-depth-limit-help" className="map-settings-description">
              Colors and depth readings stop at this limit. Leave blank for the full range.
            </p>
            <p id="map-depth-limit-error" className="map-settings-input-error" role="alert" hidden={!showDepthError}>
              {showDepthError ? DEPTH_ERROR : ''}
            </p>
            <button
              type="button"
              data-depth-reset
              className="app-btn app-btn--secondary map-settings-reset"
              disabled={preferences.depthLimitFeet === null && depthValue.trim() === ''}
              onPointerDown={() => { resetPointerDown.current = true; }}
              onPointerUp={() => { resetPointerDown.current = false; }}
              onPointerCancel={() => { resetPointerDown.current = false; }}
              onClick={resetDepthLimit}
            >Reset to full range</button>
          </div>
        </details>
      )}

      <IonItem data-tour="settings-measurement-unit">
        <IonLabel>Map unit</IonLabel>
        <div slot="end" className="map-settings-select-wrap">
          <select
            value={measurementUnit}
            onChange={(event) => {
              // A dirty value is expressed in the old unit until committed.
              if (!commitDepthLimit()) {
                event.currentTarget.value = measurementUnit;
                if (depthDisclosure.current) depthDisclosure.current.open = true;
                depthInput.current?.focus();
                return;
              }
              onMeasurementUnitChange(event.target.value as MeasurementUnit);
            }}
            data-testid="measurement-unit-selector"
            aria-label="Map unit"
            className="map-settings-select"
          >
            <option value="meters">Meters</option>
            <option value="feet">Feet</option>
          </select>
          <IonIcon icon={chevronDownOutline} className="map-settings-select-chevron" aria-hidden="true" />
        </div>
      </IonItem>

      <details
        className="map-settings-disclosure"
        data-testid="map-visibility-disclosure"
        onToggle={restoreDisclosureFocus}
      >
        <summary data-tour="settings-map-visibility" data-testid="map-visibility-summary">
          <span>Map visibility</span>
          <span className="map-settings-summary-value">{allShown ? 'All shown' : 'Custom'}</span>
          <DisclosureChevron />
        </summary>
        <div className="map-settings-visibility-body">
          <p className="map-settings-description map-settings-visibility-help">
            Individual selections are preserved. Markers appear at the appropriate zoom.
          </p>
          {MAP_DISPLAY_CATEGORIES.map(({ id, label }) => (
            <React.Fragment key={id}>
              <IonItem>
                <IonToggle
                  checked={preferences.categories[id]}
                  justify="space-between"
                  onIonChange={(event) => changeVisibility({ categories: { [id]: event.detail.checked } })}
                  data-testid={id === 'landmarks' ? 'landmark-toggle' : `map-category-${id}`}
                >{label}</IonToggle>
              </IonItem>
              {id === 'surveyStations' && (
                <details
                  className="map-settings-disclosure map-settings-station-types"
                  onToggle={restoreDisclosureFocus}
                >
                  <summary>
                    <span>Station types</span>
                    <span className="map-settings-summary-value">
                      {preferences.categories.surveyStations
                        ? `${selectedTypeCount} of ${MAP_STATION_TYPES.length} selected` : 'Survey stations off'}
                    </span>
                    <DisclosureChevron />
                  </summary>
                  <fieldset disabled={!preferences.categories.surveyStations}>
                    <legend className="sr-only">Survey station types</legend>
                    {MAP_STATION_TYPES.map(({ id: type, label: typeLabel }) => (
                      <IonItem key={type}>
                        <IonToggle
                          checked={preferences.stationTypes[type]}
                          disabled={!preferences.categories.surveyStations}
                          justify="space-between"
                          onIonChange={(event) => changeVisibility({ stationTypes: { [type]: event.detail.checked } })}
                          data-testid={`map-station-type-${type}`}
                        >{typeLabel}</IonToggle>
                      </IonItem>
                    ))}
                  </fieldset>
                </details>
              )}
            </React.Fragment>
          ))}
          <div className="map-settings-reset-wrap">
            <button
              type="button"
              className="app-btn app-btn--secondary map-settings-reset"
              disabled={allShown}
              onClick={() => {
                const { categories, stationTypes } = createDefaultMapDisplayPreferences();
                changeVisibility({ categories, stationTypes });
              }}
            >Reset visibility</button>
          </div>
        </div>
      </details>
    </IonList>
  );
};

export default MapDisplaySettings;
