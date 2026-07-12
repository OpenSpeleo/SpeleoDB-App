import type { ProjectGeoJSONCacheRecord } from '../types/projectGeoJSON';

interface ActiveLoad {
  promise: Promise<ProjectGeoJSONCacheRecord>;
}

/** Bounded LRU and single-flight owner for immutable, validated project records. */
export class ProjectGeoJSONRecordMemoryCache {
  private readonly records = new Map<string, ProjectGeoJSONCacheRecord>();
  private readonly loads = new Map<string, ActiveLoad>();
  private readonly versions = new Map<string, number>();
  private generation = 0;

  constructor(private readonly capacity = 64) {}

  get(
    projectId: string,
    load: () => Promise<ProjectGeoJSONCacheRecord>,
  ): Promise<ProjectGeoJSONCacheRecord> {
    const cached = this.records.get(projectId);
    if (cached) {
      this.touch(projectId, cached);
      return Promise.resolve(cached);
    }

    const active = this.loads.get(projectId);
    if (active) return active.promise;

    const generation = this.generation;
    const version = this.version(projectId);
    const loadState: ActiveLoad = {
      promise: Promise.resolve({ state: 'missing', commitId: null, data: null }),
    };
    loadState.promise = load()
      .then((record) => {
        if (this.generation === generation && this.version(projectId) === version) {
          this.touch(projectId, record);
        }
        return record;
      })
      .finally(() => {
        if (this.loads.get(projectId) === loadState) this.loads.delete(projectId);
      });
    this.loads.set(projectId, loadState);
    return loadState.promise;
  }

  peek(projectId: string): ProjectGeoJSONCacheRecord | undefined {
    return this.records.get(projectId);
  }

  publish(projectId: string, record: ProjectGeoJSONCacheRecord): void {
    this.versions.set(projectId, this.version(projectId) + 1);
    this.touch(projectId, record);
  }

  invalidate(projectId: string): void {
    this.versions.set(projectId, this.version(projectId) + 1);
    this.records.delete(projectId);
  }

  clear(): void {
    this.generation += 1;
    this.records.clear();
    this.loads.clear();
    this.versions.clear();
  }

  private version(projectId: string): number {
    return this.versions.get(projectId) ?? 0;
  }

  private touch(projectId: string, record: ProjectGeoJSONCacheRecord): void {
    this.records.delete(projectId);
    this.records.set(projectId, record);
    while (this.records.size > this.capacity) {
      const oldest = this.records.keys().next().value;
      if (oldest === undefined) return;
      this.records.delete(oldest);
    }
  }
}
