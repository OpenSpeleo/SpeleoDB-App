import type { DownloadArea } from '../types/downloadArea';

// Bright map outlines that also remain legible against the dark area list.
export const DOWNLOAD_AREA_COLORS = [
  '#22d3ee',
  '#fb923c',
  '#a78bfa',
  '#4ade80',
  '#f472b6',
  '#facc15',
  '#60a5fa',
  '#fb7185',
  '#2dd4bf',
  '#c084fc',
  '#a3e635',
  '#fda4af',
] as const;

/** Prefer unused colors; after palette exhaustion, balance reuse. */
export function chooseDownloadAreaColor(
  areas: readonly DownloadArea[],
): string {
  const counts = DOWNLOAD_AREA_COLORS.map(
    (color) => areas.filter((area) => area.color === color).length,
  );
  const leastUsed = Math.min(...counts);
  const choices = DOWNLOAD_AREA_COLORS.filter(
    (_, index) => counts[index] === leastUsed,
  );
  return choices[Math.floor(Math.random() * choices.length)];
}

/** Stable presentation for legacy records until their catalog is upgraded. */
export function downloadAreaColor(
  area: Pick<DownloadArea, 'areaId' | 'color'>,
): string {
  if (area.color) return area.color;
  let hash = 0;
  for (const character of area.areaId)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return DOWNLOAD_AREA_COLORS[hash % DOWNLOAD_AREA_COLORS.length];
}
