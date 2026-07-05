/**
 * Type definitions for the SpeleoDB projects/geojson API.
 *
 * Matches the response shape of GET /api/v2/projects/geojson/ — a bare `Project[]`.
 * The v1 envelope (`data`, `success`, `timestamp`, `url`) is no longer present.
 */

// ==================== Nested types ====================

export interface DownloadFormat {
  name: string;
  download_url: string;
}

export interface CommitTreeEntry {
  mode: string;
  object: string;
  path: string;
  type: string;
}

export interface ProjectCommit {
  id: string;
  message: string;
  author_email: string;
  author_name: string;
  authored_date: string;
  dt_since: string;
  parent_ids: string[];
  url: string;
  formats: DownloadFormat[];
  tree: CommitTreeEntry[];
}

// ==================== Project ====================

export interface Project {
  id: string;
  name: string;
  description: string;
  country: string;
  color: string;
  type: string;
  visibility: string;
  is_active: boolean;
  created_by: string;
  creation_date: string;
  modified_date: string;
  commit_count: number;
  active_mutex: unknown | null;
  fork_from: string | null;
  exclude_geojson: boolean;
  geojson_file: string | null;
  latitude?: number;
  longitude?: number;
  latest_commit: ProjectCommit;
}
