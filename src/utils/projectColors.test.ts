import { describe, expect, it } from 'vitest';
import { COLOR_PALETTE } from '../constants';
import type { Project } from '../types/project';
import { createProjectColorState, getProjectColor } from './projectColors';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Test Project',
    description: '',
    country: 'FR',
    type: 'survey',
    visibility: 'public',
    is_active: true,
    created_by: 'user',
    creation_date: '2025-01-01',
    modified_date: '2025-01-01',
    commit_count: 1,
    active_mutex: null,
    fork_from: null,
    exclude_geojson: false,
    geojson_file: 'test.geojson',
    latest_commit: {
      id: 'c1',
      message: 'init',
      author_email: 'a@b.com',
      author_name: 'Author',
      authored_date: '2025-01-01',
      dt_since: '1 day ago',
      parent_ids: [],
      url: '',
      formats: [],
      tree: [],
    },
    ...overrides,
  };
}

describe('projectColors', () => {
  it('assigns colors from name-sorted project order', () => {
    const projects = [
      makeProject({ id: 'c', name: 'Charlie' }),
      makeProject({ id: 'a', name: 'Alpha' }),
      makeProject({ id: 'b', name: 'Bravo' }),
    ];

    const { sortedProjects, projectColorsById } = createProjectColorState(projects);

    expect(sortedProjects.map((project) => project.id)).toEqual(['a', 'b', 'c']);
    expect(projectColorsById.a).toBe(COLOR_PALETTE[0]);
    expect(projectColorsById.b).toBe(COLOR_PALETTE[1]);
    expect(projectColorsById.c).toBe(COLOR_PALETTE[2]);
  });

  it('returns a deterministic fallback color for unknown project id', () => {
    const { projectColorsById } = createProjectColorState([]);

    expect(getProjectColor('unknown', projectColorsById)).toBe(COLOR_PALETTE[0]);
  });

  it('keeps a project color stable even when another project is filtered out of the panel', () => {
    const projects = [
      makeProject({
        id: 'p-hidden',
        name: 'Alpha Hidden',
        exclude_geojson: true,
        geojson_file: null,
      }),
      makeProject({
        id: 'p-visible',
        name: 'Beta Visible',
      }),
    ];

    const { projectColorsById } = createProjectColorState(projects);

    expect(getProjectColor('p-visible', projectColorsById)).toBe(COLOR_PALETTE[1]);
  });
});
