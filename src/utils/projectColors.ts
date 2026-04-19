import { COLORS } from '../constants';
import type { Project } from '../types/project';

export interface ProjectColorState {
  sortedProjects: Project[];
  projectColorsById: Record<string, string>;
}

/**
 * Build the panel-ordered project list and the model-driven color map.
 *
 * Sort order is case-insensitive by name (matches the web map viewer
 * and gives a stable panel layout independent of casing in the data).
 *
 * The color comes from `project.color` (assigned server-side). Invalid
 * or missing values resolve to `COLORS.FALLBACK` so rendering never
 * crashes when the cached payload predates the backend `color` field.
 */
export function createProjectColorState(projects: Project[]): ProjectColorState {
  const sortedProjects = [...projects].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
  const projectColorsById: Record<string, string> = Object.fromEntries(
    sortedProjects.map((project) => [
      project.id,
      isValidHex(project.color) ? project.color : COLORS.FALLBACK,
    ]),
  );
  return { sortedProjects, projectColorsById };
}

export function getProjectColor(
  projectId: string,
  projectColorsById: Record<string, string>,
): string {
  return projectColorsById[projectId] ?? COLORS.FALLBACK;
}

function isValidHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}
