import { COLOR_PALETTE } from '../constants';
import type { Project } from '../types/project';

export interface ProjectColorState {
  sortedProjects: Project[];
  projectColorsById: Record<string, string>;
}

export function createProjectColorState(projects: Project[]): ProjectColorState {
  const sortedProjects = [...projects].sort((a, b) => a.name.localeCompare(b.name));
  const projectColorsById = Object.fromEntries(
    sortedProjects.map((project, index) => [
      project.id,
      COLOR_PALETTE[index % COLOR_PALETTE.length],
    ]),
  );

  return { sortedProjects, projectColorsById };
}

export function getProjectColor(
  projectId: string,
  projectColorsById: Record<string, string>,
): string {
  return projectColorsById[projectId] ?? COLOR_PALETTE[0];
}
