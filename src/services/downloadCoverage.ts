import type { DownloadArea, DownloadAreaCatalog } from '../types/downloadArea';
import {
  areaBounds,
  countAreaCoordinates,
  MAX_AREA_COORDINATES,
} from './downloadAreaGeometry';

/** Layer-independent geometry identity. Presentation, source labels and order do not matter. */
export function downloadCoverage(areas: readonly DownloadArea[]) {
  const rectangles = new Map<string, ReturnType<typeof areaBounds>>();
  for (const area of areas) {
    if (countAreaCoordinates(area) > MAX_AREA_COORDINATES) continue;
    rectangles.set(
      JSON.stringify([area.topLeft, area.bottomRight]),
      areaBounds(area),
    );
  }
  const keys = [...rectangles.keys()].sort();
  return {
    key: `area-union-v1:${JSON.stringify(keys)}`,
    projects: keys.map((key) => rectangles.get(key)!),
  };
}

/** Old catalogs kept preferences on automatic areas; new catalogs own them once. */
export function downloadLayers(catalog: DownloadAreaCatalog) {
  return (
    catalog.layerIds ??
    catalog.areas.find((area) => area.type !== 'manual')?.layerIds ??
    (['esri-satellite'] as const)
  );
}

export function coverageIsCurrent(
  catalog: DownloadAreaCatalog,
  key: string,
  layerId: string,
): boolean {
  return (
    downloadLayers(catalog).some((id) => id === layerId) &&
    downloadCoverage(catalog.areas).key === key &&
    catalog.areas.length > 0
  );
}
