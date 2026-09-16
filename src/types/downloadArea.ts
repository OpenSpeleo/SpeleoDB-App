import type { MapLayerId } from './mapLayer';

export enum DownloadAreaType {
  Manual = 'manual',
  Project = 'project',
  Landmark = 'landmark',
  Track = 'track',
  SurfaceStation = 'surface-station',
  SubsurfaceStation = 'subsurface-station',
  ExplorationLead = 'exploration-lead',
  CylinderInstall = 'cylinder-install',
}

export type LngLat = [longitude: number, latitude: number];
export interface DownloadArea {
  areaId: string;
  objectId: string | null;
  type: DownloadAreaType;
  topLeft: LngLat;
  bottomRight: LngLat;
  /** Source label for automatic areas; manual areas have no name. */
  name?: string;
  /** Persisted manual-area color; optional for pre-color catalogs. */
  color?: string;
  /** Legacy presentation flag; manual rectangles now follow menu visibility. */
  visible: boolean;
  layerIds: MapLayerId[];
  revision: number;
  sourceRevision: string | null;
  /** Stable source identity, including anonymous GeoJSON features. */
  sourceKey: string;
}
export interface DownloadAreaCatalog {
  schemaVersion: 1;
  revision: number;
  /** Shared preference for every area; optional only for legacy catalogs. */
  layerIds?: MapLayerId[];
  areas: DownloadArea[];
}
export type DownloadAreaInput = Omit<DownloadArea, 'areaId' | 'revision'>;
export type ManualDownloadAreaInput = Pick<
  DownloadArea,
  'topLeft' | 'bottomRight'
>;
export type DownloadAreaStatus =
  | 'queued'
  | 'planning'
  | 'downloading'
  | 'downloaded'
  | 'waiting'
  | 'storage-blocked'
  | 'incomplete'
  | 'too-large';
export interface DownloadAreaProgress {
  revision: number;
  status: DownloadAreaStatus;
  completedTiles: number;
  totalTiles: number;
}
export interface DownloadAreasSnapshot {
  areas: readonly DownloadArea[];
  progress: Readonly<Record<string, DownloadAreaProgress>>;
  availableLayerIds: readonly string[];
  enabledLayerIds: readonly MapLayerId[];
  error: string | null;
}
export const EMPTY_DOWNLOAD_AREAS: DownloadAreasSnapshot = Object.freeze({
  areas: Object.freeze([]),
  progress: Object.freeze({}),
  availableLayerIds: Object.freeze([]),
  enabledLayerIds: Object.freeze(['esri-satellite'] as MapLayerId[]),
  error: null,
});
