import { describe, expect, it } from 'vitest';
import { COLORS } from '../constants';
import type { Project } from '../types/project';
import { createProjectColorState, getProjectColor } from './projectColors';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Test Project',
    description: '',
    country: 'FR',
    color: '#377eb8',
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
  it('uses project.color from the model', () => {
    const projects = [
      makeProject({ id: 'a', name: 'Alpha', color: '#ff0000' }),
      makeProject({ id: 'b', name: 'Bravo', color: '#00ff00' }),
    ];
    const { projectColorsById } = createProjectColorState(projects);
    expect(projectColorsById.a).toBe('#ff0000');
    expect(projectColorsById.b).toBe('#00ff00');
  });

  it('preserves panel order via case-insensitive name sort', () => {
    const projects = [
      makeProject({ id: 'c', name: 'charlie', color: '#000001' }),
      makeProject({ id: 'a', name: 'Alpha', color: '#000002' }),
      makeProject({ id: 'b', name: 'bravo', color: '#000003' }),
    ];

    const { sortedProjects } = createProjectColorState(projects);

    expect(sortedProjects.map((project) => project.id)).toEqual(['a', 'b', 'c']);
  });

  it('falls back to COLORS.FALLBACK when project.color is empty', () => {
    const projects = [makeProject({ id: 'a', color: '' })];
    const { projectColorsById } = createProjectColorState(projects);
    expect(projectColorsById.a).toBe(COLORS.FALLBACK);
  });

  it('falls back when project.color is not a valid 6-digit hex', () => {
    const projects = [
      makeProject({ id: 'a', name: 'Alpha', color: 'red' }),
      makeProject({ id: 'b', name: 'Bravo', color: '#fff' }),
      makeProject({ id: 'c', name: 'Charlie', color: '#1234567' }),
    ];
    const { projectColorsById } = createProjectColorState(projects);
    expect(projectColorsById.a).toBe(COLORS.FALLBACK);
    expect(projectColorsById.b).toBe(COLORS.FALLBACK);
    expect(projectColorsById.c).toBe(COLORS.FALLBACK);
  });

  it('accepts both lower- and upper-case hex digits', () => {
    const projects = [
      makeProject({ id: 'a', name: 'Alpha', color: '#ABCDEF' }),
      makeProject({ id: 'b', name: 'Bravo', color: '#abcdef' }),
    ];
    const { projectColorsById } = createProjectColorState(projects);
    expect(projectColorsById.a).toBe('#ABCDEF');
    expect(projectColorsById.b).toBe('#abcdef');
  });

  it('returns the fallback color when looking up an unknown project id', () => {
    const { projectColorsById } = createProjectColorState([]);
    expect(getProjectColor('unknown', projectColorsById)).toBe(COLORS.FALLBACK);
  });

  it('keeps a project color stable when another project is filtered out of the panel', () => {
    const projects = [
      makeProject({
        id: 'p-hidden',
        name: 'Alpha Hidden',
        color: '#aaaaaa',
        exclude_geojson: true,
        geojson_file: null,
      }),
      makeProject({
        id: 'p-visible',
        name: 'Beta Visible',
        color: '#bbbbbb',
      }),
    ];

    const { projectColorsById } = createProjectColorState(projects);

    expect(getProjectColor('p-visible', projectColorsById)).toBe('#bbbbbb');
  });
});
