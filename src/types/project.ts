import type { ProjectWithGeoJson, ProjectCommit } from '@speleodb/api';

export type { ProjectCommit } from '@speleodb/api';

/**
 * Durable project record. Older cached lists may omit artifact identity fields
 * and contain enum values from a different server version. Shared wire fields
 * remain derived from the generated API model.
 */
export type Project = Omit<ProjectWithGeoJson,
  'geojson_revision' | 'geojson_commit_sha' | 'country' | 'type' | 'visibility' | 'active_mutex'
> & {
  geojson_revision?: ProjectWithGeoJson['geojson_revision'];
  geojson_commit_sha?: ProjectWithGeoJson['geojson_commit_sha'];
  country: string;
  type: string;
  visibility: string;
  active_mutex: unknown | null;
};

export type ProjectWithCommit = Project & { latest_commit: ProjectCommit };

/** Empty projects have no committed map artifact to load, cache, or prefetch. */
export function hasProjectCommit(project: Project): project is ProjectWithCommit {
  return typeof project.latest_commit?.id === 'string' && project.latest_commit.id.length > 0;
}
