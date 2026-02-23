export type MapColorMode = 'project' | 'depth';

export const DEFAULT_MAP_COLOR_MODE: MapColorMode = 'project';

export function isMapColorMode(value: unknown): value is MapColorMode {
  return value === 'project' || value === 'depth';
}
