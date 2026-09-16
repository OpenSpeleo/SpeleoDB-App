import {
  DownloadAreaType,
  type DownloadAreaInput,
} from '../types/downloadArea';
import type { MapLayerId } from '../types/mapLayer';
import type { MapOverlayId } from '../types/mapOverlay';
import type { TilePrefetchProjectInput } from '../types/tilePrefetch';
import type { GpsTrackPrefetchSource } from '../controllers/GpsTrackCoordinator';
import { boundsForCoordinates, cornersForBounds } from './downloadAreaGeometry';

const OVERLAY_TYPES: Record<MapOverlayId, DownloadAreaType> = {
  landmarks: DownloadAreaType.Landmark,
  surfaceStations: DownloadAreaType.SurfaceStation,
  subsurfaceStations: DownloadAreaType.SubsurfaceStation,
  explorationLeads: DownloadAreaType.ExplorationLead,
  cylinderInstalls: DownloadAreaType.CylinderInstall,
};
export function automaticAreaInputs(
  projects: TilePrefetchProjectInput[],
  overlays: Array<{ id: MapOverlayId; collection: GeoJSON.FeatureCollection }>,
  tracks: GpsTrackPrefetchSource[],
  layerIds: MapLayerId[],
): DownloadAreaInput[] {
  const base = { visible: false, layerIds };
  const areas: DownloadAreaInput[] = projects.map((project) => ({
    ...base,
    ...cornersForBounds(project.bounds, 50),
    type: DownloadAreaType.Project,
    objectId: project.projectId,
    name: 'Project',
    sourceKey: `project:${project.projectId}`,
    sourceRevision: project.commitId,
  }));
  for (const { id, collection } of overlays) {
    for (const feature of collection.features) {
      if (feature.geometry?.type !== 'Point') continue;
      const [lng, lat] = feature.geometry.coordinates;
      const bounds = boundsForCoordinates([[lng, lat]]);
      if (!bounds) continue;
      const identity = feature.properties?.id ?? feature.id;
      const objectId =
        typeof identity === 'string' || typeof identity === 'number'
          ? String(identity)
          : null;
      const name =
        typeof feature.properties?.name === 'string'
          ? feature.properties.name.trim().slice(0, 120)
          : '';
      areas.push({
        ...base,
        ...cornersForBounds(bounds, 50),
        type: OVERLAY_TYPES[id],
        objectId,
        name: name || 'Map point',
        sourceKey: `${id}:${objectId ?? JSON.stringify([lng, lat])}`,
        sourceRevision: JSON.stringify([lng, lat]),
      });
    }
  }
  for (const track of tracks) {
    const bounds = boundsForCoordinates(track.paths.flat());
    if (!bounds) continue;
    areas.push({
      ...base,
      ...cornersForBounds(bounds, 50),
      type: DownloadAreaType.Track,
      objectId: track.targetId,
      name: 'GPS track',
      sourceKey: `${track.targetKind}:${track.targetId}`,
      sourceRevision: track.sourceRevision,
    });
  }
  return areas;
}
