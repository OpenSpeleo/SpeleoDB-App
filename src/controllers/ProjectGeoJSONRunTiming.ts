import { logPerformanceTiming } from '../utils/performanceTiming';

export type GeoJSONWorkPhase =
  | 'cache_read_work'
  | 'download_work'
  | 'normalization_work'
  | 'validation_work'
  | 'cache_write_work';

type GeoJSONRunTimings = Record<GeoJSONWorkPhase, number>;

const PHASES: readonly GeoJSONWorkPhase[] = [
  'cache_read_work',
  'download_work',
  'normalization_work',
  'validation_work',
  'cache_write_work',
];

/** Constant-memory aggregate timings for one or more overlapping sync runs. */
export class ProjectGeoJSONRunTiming {
  private readonly runs = new Map<number, GeoJSONRunTimings>();

  begin(runId: number): void {
    this.runs.set(runId, {
      cache_read_work: 0,
      download_work: 0,
      normalization_work: 0,
      validation_work: 0,
      cache_write_work: 0,
    });
  }

  async measure<T>(
    runId: number,
    phase: GeoJSONWorkPhase,
    work: () => Promise<T>,
  ): Promise<T> {
    const startedAt = performance.now();
    try {
      return await work();
    } finally {
      this.add(runId, phase, performance.now() - startedAt);
    }
  }

  measureSynchronous<T>(
    runId: number,
    phase: GeoJSONWorkPhase,
    work: () => T,
  ): T {
    const startedAt = performance.now();
    try {
      return work();
    } finally {
      this.add(runId, phase, performance.now() - startedAt);
    }
  }

  finish(runId: number, aborted: boolean): void {
    const timings = this.runs.get(runId);
    if (!timings) return;
    const status = aborted ? 'aborted' : 'applied';
    for (const phase of PHASES) {
      logPerformanceTiming('project-geojson', {
        runId,
        phase,
        durationMs: Math.round(timings[phase] * 10) / 10,
        status,
      });
    }
    this.runs.delete(runId);
  }

  private add(runId: number, phase: GeoJSONWorkPhase, durationMs: number): void {
    const timings = this.runs.get(runId);
    if (!timings || !Number.isFinite(durationMs)) return;
    timings[phase] += Math.max(0, durationMs);
  }
}
