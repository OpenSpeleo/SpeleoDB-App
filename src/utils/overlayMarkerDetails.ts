export type InteractiveOverlayLayerId =
  | 'exploration-leads-icon-layer'
  | 'exploration-leads-fallback-layer'
  | 'cylinder-installs-icon-layer'
  | 'cylinder-installs-fallback-layer'
  | 'landmarks-layer'
  | 'surface-stations-layer'
  | 'subsurface-stations-circles'
  | 'subsurface-stations-biology-icons'
  | 'subsurface-stations-bone-icons'
  | 'subsurface-stations-artifact-icons'
  | 'subsurface-stations-geology-icons';

export const INTERACTIVE_OVERLAY_LAYER_IDS: readonly InteractiveOverlayLayerId[] = [
  'exploration-leads-icon-layer',
  'exploration-leads-fallback-layer',
  'cylinder-installs-icon-layer',
  'cylinder-installs-fallback-layer',
  'landmarks-layer',
  'surface-stations-layer',
  'subsurface-stations-circles',
  'subsurface-stations-biology-icons',
  'subsurface-stations-bone-icons',
  'subsurface-stations-artifact-icons',
  'subsurface-stations-geology-icons',
] as const;

export interface InteractiveOverlayFeature {
  id?: string | number;
  layer?: { id?: string };
  properties?: Record<string, unknown> | null;
  geometry?: { type?: string; coordinates?: number[] } | null;
}

export interface MarkerParseContext {
  projectNameByPointLayerId?: Map<string, string>;
}

export interface ExplorationLeadDetails {
  type: 'explorationLead';
  id: string;
  description: string;
}

export interface CylinderInstallDetails {
  type: 'cylinderInstall';
  id: string;
  pressure: string;
  gasMix: string;
  installDate: string;
}

export interface SubsurfaceStationDetails {
  type: 'subsurfaceStation';
  id: string;
  name: string;
  description: string;
  tag: string;
}

export interface SurfaceStationDetails {
  type: 'surfaceStation';
  id: string;
  name: string;
  description: string;
  gpsCoordinate: string;
}

export interface LandmarkDetails {
  type: 'landmark';
  id: string;
  name: string;
  description: string;
  gpsCoordinate: string;
  collectionName: string;
  isPersonalCollection: boolean;
  // CRUD support: gate Edit/Delete actions and prefill the edit form.
  canWrite: boolean;
  canDelete: boolean;
  collectionId: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ProjectPointDetails {
  type: 'projectPoint';
  id: string;
  projectName: string;
  name: string;
  gpsCoordinate: string;
}

export interface MapLongPressDetails {
  type: 'mapLongPress';
  gpsCoordinate: string;
  latitude: number;
  longitude: number;
}

export type OverlayMarkerDetails =
  | ExplorationLeadDetails
  | CylinderInstallDetails
  | SubsurfaceStationDetails
  | SurfaceStationDetails
  | LandmarkDetails
  | ProjectPointDetails
  | MapLongPressDetails;

export function formatPressureWithUnit(
  pressure: unknown,
  pressureUnitSystem: unknown,
): string {
  if (pressure === null || pressure === undefined || pressure === '') {
    return 'N/A';
  }

  const unit = pressureUnitSystem === 'imperial' ? 'PSI' : 'BAR';
  return `${String(pressure)} ${unit}`;
}

export function formatCylinderGasMix(o2: unknown, he: unknown): string {
  const o2Value = normalizeNumber(o2);
  const heValue = normalizeNumber(he);
  if (o2Value === null || heValue === null) {
    return 'N/A';
  }

  if (heValue > 0) {
    return `${o2Value}/${heValue}`;
  }
  if (o2Value === 100) {
    return 'Oxygen';
  }
  if (o2Value === 21) {
    return 'Air';
  }
  return `NX${o2Value}`;
}

export function normalizeInstallDate(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return 'N/A';
  }
  const text = value.trim();
  if (text.includes('T')) {
    return text.split('T')[0];
  }
  return text;
}

export function formatLatLng(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return 'N/A';
  }
  return `${parseFloat(lat.toFixed(7))}, ${parseFloat(lng.toFixed(7))}`;
}

export function formatGpsCoordinate(
  geometry: InteractiveOverlayFeature['geometry'],
): string {
  if (
    !geometry
    || geometry.type !== 'Point'
    || !Array.isArray(geometry.coordinates)
    || geometry.coordinates.length < 2
  ) {
    return 'N/A';
  }

  return formatLatLng(geometry.coordinates[1], geometry.coordinates[0]);
}

const PROJECT_POINT_LAYER_PATTERN = /^project-.+-point$/;

export function isProjectPointLayerId(layerId: string): boolean {
  return PROJECT_POINT_LAYER_PATTERN.test(layerId);
}

export function parseOverlayMarkerDetails(
  feature: InteractiveOverlayFeature,
  context?: MarkerParseContext,
): OverlayMarkerDetails | null {
  const layerId = feature.layer?.id;
  if (!layerId) {
    return null;
  }

  if (isInteractiveOverlayLayerId(layerId)) {
    if (layerId.startsWith('exploration-leads-')) {
      return parseExplorationLead(feature);
    }
    if (layerId.startsWith('cylinder-installs-')) {
      return parseCylinderInstall(feature);
    }
    if (layerId === 'landmarks-layer') {
      return parseLandmark(feature);
    }
    if (layerId === 'surface-stations-layer') {
      return parseSurfaceStation(feature);
    }
    if (layerId.startsWith('subsurface-stations-')) {
      return parseSubsurfaceStation(feature);
    }
    return null;
  }

  if (isProjectPointLayerId(layerId)) {
    return parseProjectPoint(feature, layerId, context);
  }

  return null;
}

function parseExplorationLead(feature: InteractiveOverlayFeature): ExplorationLeadDetails {
  const properties = feature.properties ?? {};
  const description = typeof properties.description === 'string' && properties.description.trim()
    ? properties.description.trim()
    : 'No description available.';

  return {
    type: 'explorationLead',
    id: getFeatureId(feature),
    description,
  };
}

function parseCylinderInstall(feature: InteractiveOverlayFeature): CylinderInstallDetails {
  const properties = feature.properties ?? {};
  return {
    type: 'cylinderInstall',
    id: getFeatureId(feature),
    pressure: formatPressureWithUnit(
      properties.pressure,
      properties.pressure_unit_system,
    ),
    gasMix: formatCylinderGasMix(
      properties.o2_percentage,
      properties.he_percentage,
    ),
    installDate: normalizeInstallDate(properties.install_date),
  };
}

function parseSubsurfaceStation(feature: InteractiveOverlayFeature): SubsurfaceStationDetails {
  const properties = feature.properties ?? {};
  return {
    type: 'subsurfaceStation',
    id: getFeatureId(feature),
    name: normalizeStringProperty(properties.name),
    description: normalizeStringProperty(properties.description),
    tag: resolveTagLabel(properties.tag),
  };
}

function parseSurfaceStation(feature: InteractiveOverlayFeature): SurfaceStationDetails {
  const properties = feature.properties ?? {};
  return {
    type: 'surfaceStation',
    id: getFeatureId(feature),
    name: normalizeStringProperty(properties.name),
    description: normalizeStringProperty(properties.description),
    gpsCoordinate: formatGpsCoordinate(feature.geometry),
  };
}

function parseLandmark(feature: InteractiveOverlayFeature): LandmarkDetails {
  const properties = feature.properties ?? {};
  const isPersonalCollection =
    properties.is_personal_collection === true
    || properties.collection_type === 'PERSONAL';
  const collectionName = normalizeStringProperty(properties.collection_name);
  const collectionId =
    typeof properties.collection === 'string' && properties.collection.trim() !== ''
      ? properties.collection.trim()
      : null;
  const coordinates = feature.geometry?.type === 'Point' && Array.isArray(feature.geometry.coordinates)
    ? feature.geometry.coordinates
    : null;
  const longitude = coordinates && Number.isFinite(coordinates[0]) ? coordinates[0] : null;
  const latitude = coordinates && Number.isFinite(coordinates[1]) ? coordinates[1] : null;
  return {
    type: 'landmark',
    id: getFeatureId(feature),
    name: normalizeStringProperty(properties.name),
    description: normalizeStringProperty(properties.description),
    gpsCoordinate: formatGpsCoordinate(feature.geometry),
    collectionName:
      collectionName !== 'N/A'
        ? collectionName
        : isPersonalCollection
          ? 'Personal Landmarks'
          : 'N/A',
    isPersonalCollection,
    canWrite: properties.can_write === true,
    canDelete: properties.can_delete === true,
    collectionId,
    latitude,
    longitude,
  };
}

function parseProjectPoint(
  feature: InteractiveOverlayFeature,
  layerId: string,
  context?: MarkerParseContext,
): ProjectPointDetails {
  const properties = feature.properties ?? {};
  const projectName = context?.projectNameByPointLayerId?.get(layerId) ?? 'N/A';
  return {
    type: 'projectPoint',
    id: getFeatureId(feature),
    projectName,
    name: normalizeStringProperty(properties.name),
    gpsCoordinate: formatGpsCoordinate(feature.geometry),
  };
}

function getFeatureId(feature: InteractiveOverlayFeature): string {
  const properties = feature.properties ?? {};
  const fromProperties = properties.id;
  if ((typeof fromProperties === 'string' || typeof fromProperties === 'number') && fromProperties !== '') {
    return String(fromProperties);
  }
  if ((typeof feature.id === 'string' || typeof feature.id === 'number') && feature.id !== '') {
    return String(feature.id);
  }
  return 'unknown';
}

function isInteractiveOverlayLayerId(value: string): value is InteractiveOverlayLayerId {
  return (INTERACTIVE_OVERLAY_LAYER_IDS as readonly string[]).includes(value);
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeStringProperty(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return 'N/A';
}

function resolveTagLabel(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (value && typeof value === 'object') {
    const tagObj = value as Record<string, unknown>;
    if (typeof tagObj.name === 'string' && tagObj.name.trim()) {
      return tagObj.name.trim();
    }
  }
  return 'N/A';
}
