/** Local presentation preferences; these never change map data or item selection. */
export const MAP_DISPLAY_CATEGORIES = [
  { id: 'caveEntrances', label: 'Cave entrances' },
  { id: 'surveyStations', label: 'Survey stations' },
  { id: 'surfaceStations', label: 'Surface stations' },
  { id: 'landmarks', label: 'Landmarks' },
  { id: 'explorationLeads', label: 'Exploration leads' },
  { id: 'cylinders', label: 'Safety cylinders' },
] as const;

export const MAP_STATION_TYPES = [
  { id: 'sensor', label: 'Sensor' },
  { id: 'biology', label: 'Biology' },
  { id: 'bone', label: 'Bones' },
  { id: 'artifact', label: 'Artifact' },
  { id: 'geology', label: 'Geology' },
] as const;

export type MapDisplayCategory = (typeof MAP_DISPLAY_CATEGORIES)[number]['id'];
export type MapStationType = (typeof MAP_STATION_TYPES)[number]['id'];

export interface MapDisplayPreferences {
  categories: Record<MapDisplayCategory, boolean>;
  stationTypes: Record<MapStationType, boolean>;
  /** Physical depth in feet; null uses the visible surveys' full range. */
  depthLimitFeet: number | null;
}

export interface MapDisplayPreferencesPatch {
  categories?: Partial<MapDisplayPreferences['categories']>;
  stationTypes?: Partial<MapDisplayPreferences['stationTypes']>;
  depthLimitFeet?: number | null;
}

export function createDefaultMapDisplayPreferences(): MapDisplayPreferences {
  return {
    categories: {
      caveEntrances: true,
      surveyStations: true,
      surfaceStations: true,
      landmarks: true,
      explorationLeads: true,
      cylinders: true,
    },
    stationTypes: { sensor: true, biology: true, bone: true, artifact: true, geology: true },
    depthLimitFeet: null,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Validate each known field independently, including the legacy landmark preference. */
export function normalizeMapDisplayPreferences(
  value: unknown,
  legacyShowLandmarks?: unknown,
): MapDisplayPreferences {
  const record = asRecord(value);
  const categories = asRecord(record.categories);
  const stationTypes = asRecord(record.stationTypes);
  const result = createDefaultMapDisplayPreferences();
  for (const { id } of MAP_DISPLAY_CATEGORIES) {
    if (typeof categories[id] === 'boolean') result.categories[id] = categories[id];
  }
  if (!Object.hasOwn(categories, 'landmarks') && typeof legacyShowLandmarks === 'boolean') {
    result.categories.landmarks = legacyShowLandmarks;
  }
  for (const { id } of MAP_STATION_TYPES) {
    if (typeof stationTypes[id] === 'boolean') result.stationTypes[id] = stationTypes[id];
  }
  if (typeof record.depthLimitFeet === 'number'
    && Number.isFinite(record.depthLimitFeet) && record.depthLimitFeet > 0) {
    result.depthLimitFeet = record.depthLimitFeet;
  }
  return result;
}

/** Shared by React state and queued storage mutations so partial edits preserve siblings. */
export function mergeMapDisplayPreferences(
  current: MapDisplayPreferences,
  patch: MapDisplayPreferencesPatch,
): MapDisplayPreferences {
  return normalizeMapDisplayPreferences({
    categories: { ...current.categories, ...patch.categories },
    stationTypes: { ...current.stationTypes, ...patch.stationTypes },
    depthLimitFeet: patch.depthLimitFeet === undefined ? current.depthLimitFeet : patch.depthLimitFeet,
  });
}
