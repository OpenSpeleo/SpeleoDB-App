export type InteractiveOverlayLayerId =
  | 'exploration-leads-icon-layer'
  | 'exploration-leads-fallback-layer'
  | 'cylinder-installs-icon-layer'
  | 'cylinder-installs-fallback-layer';

export const INTERACTIVE_OVERLAY_LAYER_IDS: readonly InteractiveOverlayLayerId[] = [
  'exploration-leads-icon-layer',
  'exploration-leads-fallback-layer',
  'cylinder-installs-icon-layer',
  'cylinder-installs-fallback-layer',
] as const;

export interface InteractiveOverlayFeature {
  id?: string | number;
  layer?: { id?: string };
  properties?: Record<string, unknown> | null;
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

export type OverlayMarkerDetails = ExplorationLeadDetails | CylinderInstallDetails;

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

export function parseOverlayMarkerDetails(
  feature: InteractiveOverlayFeature,
): OverlayMarkerDetails | null {
  const layerId = feature.layer?.id;
  if (!layerId || !isInteractiveOverlayLayerId(layerId)) {
    return null;
  }

  if (layerId.startsWith('exploration-leads-')) {
    return parseExplorationLead(feature);
  }
  if (layerId.startsWith('cylinder-installs-')) {
    return parseCylinderInstall(feature);
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
