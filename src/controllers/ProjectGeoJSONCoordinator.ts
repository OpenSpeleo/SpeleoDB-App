import type { ProjectCacheService } from '../services/ProjectCacheService';
import type { SpeleoDBService } from '../services/SpeleoDBService';
import {
  ProjectGeoJSONAnalysisError,
  type ProjectGeoJSONAnalyzerPort,
} from '../services/ProjectGeoJSONAnalyzer';
import type { Project } from '../types/project';
import type {
  ProjectGeoJSONAcknowledgementResult,
  ProjectGeoJSONAnalysis,
  ProjectGeoJSONCacheRecord,
  ProjectGeoJSONContentFailureReason,
  ProjectGeoJSONFailureDiagnostics,
  ProjectGeoJSONFailureReason,
  ProjectGeoJSONMapData,
  ProjectGeoJSONWarning,
} from '../types/projectGeoJSON';
import type { GeoJSONSyncPhaseResult } from '../types/sync';
import { isAbortError, throwIfAborted } from '../utils/abort';
import { normalizeGeoJSON } from '../utils/normalizeGeoJSON';
import { normalizeGeoJSONRevision } from '../utils/geojsonRevision';
import { isProjectGeoJSONOversized } from '../utils/projectGeoJSONBounds';
import { CancellationContext } from './CancellationContext';
import { ProjectGeoJSONRunTiming } from './ProjectGeoJSONRunTiming';
import {
  createSkippedGeoJSONPhase,
  NO_PROJECT_GEOJSON_OUTCOME as NO_OUTCOME,
  type ProjectGeoJSONOutcome as ProjectOutcome,
} from './ProjectGeoJSONSyncOutcome';

export { createSkippedGeoJSONPhase } from './ProjectGeoJSONSyncOutcome';

interface SessionProjectGeoJSONDisposition {
  reason: ProjectGeoJSONFailureReason;
  diagnostics: ProjectGeoJSONFailureDiagnostics;
  warningAcknowledged: boolean;
  retryWhenOnline: boolean;
  preserveActive: boolean;
}

interface ProjectGeoJSONCoordinatorDependencies {
  cache: ProjectCacheService;
  transport: SpeleoDBService;
  analyzer: ProjectGeoJSONAnalyzerPort;
  hasNetworkAccess(): boolean;
  removePrefetchTarget(projectId: string, signal: AbortSignal): Promise<void>;
  notifyStateChanged(): void;
}

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

/** Owns project GeoJSON validation, quarantine, warnings, and session blocks. */
export class ProjectGeoJSONCoordinator {
  private _warnings: ProjectGeoJSONWarning[] = [];
  private readonly blockedCommits = new Map<string, SessionProjectGeoJSONDisposition>();
  private readonly runTiming = new ProjectGeoJSONRunTiming();

  constructor(private readonly dependencies: ProjectGeoJSONCoordinatorDependencies) {}

  get warnings(): ProjectGeoJSONWarning[] {
    return this._warnings;
  }

  reset(): void {
    this._warnings = [];
    this.blockedCommits.clear();
  }

  isBlocked(projectId: string, commitId: string, revision?: string | null): boolean {
    return this.blockedCommits.has(this.key(projectId, commitId, revision));
  }

  async getMapData(
    projects: Project[],
    projectId: string,
    signal?: AbortSignal,
  ): Promise<ProjectGeoJSONMapData | null> {
    throwIfAborted(signal);
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) return null;
    const commitId = project.latest_commit.id;
    const disposition = this.blockedCommits.get(this.key(projectId, commitId, project.geojson_revision));
    if (disposition && !disposition.preserveActive) return null;
    const record = await this.dependencies.cache.getProjectGeoJSONRecord(projectId, { signal });
    throwIfAborted(signal);
    if (record.state !== 'active' || record.commitId !== commitId) return null;
    if (this.isBlocked(projectId, commitId, record.geojsonRevision)) return null;
    return {
      commitId,
      featureCollection: record.data,
      bounds: record.analysis.bounds,
      ...(record.geojsonRevision ? { geojsonRevision: record.geojsonRevision } : {}),
    };
  }

  async acknowledgeWarnings(signal?: AbortSignal): Promise<ProjectGeoJSONAcknowledgementResult> {
    throwIfAborted(signal);
    const warnings = [...this._warnings];
    const results = await Promise.all(warnings.map(async (warning) => {
      const key = this.key(warning.projectId, warning.commitId, warning.geojsonRevision);
      if (!warning.persistent) {
        const disposition = this.blockedCommits.get(key);
        if (disposition) disposition.warningAcknowledged = true;
        return key;
      }
      const persisted = await this.dependencies.cache.acknowledgeProjectGeoJSONQuarantine(
        warning.projectId,
        warning.commitId,
        { signal, geojsonRevision: warning.geojsonRevision },
      );
      return persisted ? key : null;
    }));
    throwIfAborted(signal);
    const acknowledged = new Set(results.filter((key): key is string => key !== null));
    if (acknowledged.size === 0) {
      return { acknowledgedCount: 0, failedCount: warnings.length };
    }
    this._warnings = this._warnings.filter((warning) => !acknowledged.has(
      this.key(warning.projectId, warning.commitId, warning.geojsonRevision),
    ));
    this.dependencies.notifyStateChanged();
    return {
      acknowledgedCount: acknowledged.size,
      failedCount: warnings.length - acknowledged.size,
    };
  }

  async sync(
    context: CancellationContext,
    projects: Project[],
    allowDownloads: boolean,
  ): Promise<GeoJSONSyncPhaseResult> {
    const eligible = projects.filter((project) => project.geojson_file && !project.exclude_geojson);
    if (eligible.length === 0) {
      this.reset();
      return createSkippedGeoJSONPhase('no_geojson_candidates');
    }
    this.pruneStaleState(eligible);
    this.runTiming.begin(context.runId);

    try {
      const outcomes: ProjectOutcome[] = [];
      const queue = [...eligible];
      const worker = async (): Promise<void> => {
        while (queue.length > 0) {
          context.throwIfAborted();
          const project = queue.shift();
          if (!project) return;
          try {
            outcomes.push(await this.processProject(context, project, allowDownloads));
          } catch (error) {
            if (isAbortError(error)) throw error;
            console.warn('Failed to cache project GeoJSON:', error);
            outcomes.push({ ...NO_OUTCOME, failed: 1 });
          }
        }
      };
      await Promise.all(Array.from(
        { length: Math.min(3, eligible.length) },
        () => worker(),
      ));

      const totals = outcomes.reduce((sum, outcome) => ({
        downloaded: sum.downloaded + outcome.downloaded,
        validated: sum.validated + outcome.validated,
        quarantined: sum.quarantined + outcome.quarantined,
        skipped: sum.skipped + outcome.skipped,
        failed: sum.failed + outcome.failed,
        localWork: sum.localWork || outcome.localWork,
      }), NO_OUTCOME);
      if (!allowDownloads && !totals.localWork && totals.failed === 0) {
        return this.result('skipped', 'offline_locked', eligible.length, totals);
      }
      return this.result(
        totals.failed > 0 ? 'failed' : 'applied',
        totals.failed > 0 ? 'geojson_sync_partial_failure' : 'geojson_synced',
        eligible.length,
        totals,
      );
    } finally {
      this.runTiming.finish(context.runId, context.signal.aborted);
    }
  }

  private async processProject(
    context: CancellationContext,
    project: Project,
    allowDownloads: boolean,
  ): Promise<ProjectOutcome> {
    const disposition = await this.applySessionDisposition(context, project, allowDownloads);
    if (disposition) return disposition;

    let record: ProjectGeoJSONCacheRecord;
    try {
      record = await this.runTiming.measure(
        context.runId,
        'cache_read_work',
        () => this.dependencies.cache.getProjectGeoJSONRecord(
          project.id,
          { signal: context.signal },
        ),
      );
    } catch (error) {
      if (isAbortError(error)) throw error;
      return this.blockUnavailableRecord(context, project, false);
    }
    context.throwIfAborted();

    if (
      record.state === 'legacy'
      && record.commitId === null
      && (!allowDownloads || !this.dependencies.hasNetworkAccess())
    ) {
      return this.blockUnavailableRecord(context, project, true);
    }

    if (record.commitId === project.latest_commit.id) {
      const cached = await this.processCurrentRecord(context, project, record, allowDownloads);
      if (cached) return cached;
    }

    if (!allowDownloads || !this.dependencies.hasNetworkAccess()) {
      return { ...NO_OUTCOME, skipped: 1 };
    }
    return this.downloadAndValidate(context, project,
      record.state === 'active' && record.commitId === project.latest_commit.id);
  }

  private async applySessionDisposition(
    context: CancellationContext,
    project: Project,
    allowDownloads: boolean,
  ): Promise<ProjectOutcome | null> {
    const commitKey = this.key(project.id, project.latest_commit.id, project.geojson_revision);
    const disposition = this.blockedCommits.get(commitKey);
    if (!disposition) return null;
    if (disposition.retryWhenOnline && allowDownloads && this.dependencies.hasNetworkAccess()) {
      this.blockedCommits.delete(commitKey);
      return null;
    }
    if (!disposition.preserveActive) await this.removePrefetchTarget(project.id, context);
    this.log(project, disposition.diagnostics, 'cache', 'quarantined', disposition.reason);
    if (!disposition.warningAcknowledged) {
      this.addWarning(project, disposition.reason, disposition.diagnostics, false, disposition.preserveActive);
    }
    return { ...NO_OUTCOME, quarantined: 1, failed: 1, skipped: 1 };
  }

  private async blockUnavailableRecord(
    context: CancellationContext,
    project: Project,
    retryWhenOnline: boolean,
  ): Promise<ProjectOutcome> {
    const diagnostics = this.emptyDiagnostics();
    this.blockForSession(project, 'validation_unavailable', diagnostics, retryWhenOnline);
    await this.removePrefetchTarget(project.id, context);
    this.log(project, diagnostics, 'cache', 'quarantined', 'validation_unavailable');
    this.addWarning(project, 'validation_unavailable', diagnostics, false);
    return { ...NO_OUTCOME, quarantined: 1, failed: 1, skipped: 1 };
  }

  private async processCurrentRecord(
    context: CancellationContext,
    project: Project,
    record: ProjectGeoJSONCacheRecord,
    allowDownloads: boolean,
  ): Promise<ProjectOutcome | null> {
    const revision = normalizeGeoJSONRevision(project.geojson_revision);
    const outdated = revision !== null
      && revision !== normalizeGeoJSONRevision(record.state === 'missing' ? null : record.geojsonRevision);
    if (record.state === 'active') {
      const rejected = record.rejectedReplacement;
      if (outdated && rejected?.geojsonRevision === revision) {
        this.log(project, rejected.diagnostics, 'cache', 'quarantined', rejected.reason);
        if (!rejected.warningAcknowledged) {
          this.addWarning(project, rejected.reason, rejected.diagnostics, true, true);
        }
        return { ...NO_OUTCOME, quarantined: 1, failed: 1, skipped: 1 };
      }
      if (outdated) return null;
      this.log(project, record.analysis, 'cache', 'active');
      return { ...NO_OUTCOME, skipped: 1 };
    }
    if (record.state === 'quarantined') {
      if (outdated) return null;
      if (
        record.reason === 'bbox_timeout'
        && allowDownloads
        && this.dependencies.hasNetworkAccess()
      ) {
        // Historical schema-v2 builds treated a 500 ms deadline as file
        // corruption. Preserve the old marker until successful validation
        // atomically replaces it, but retry the same commit while online.
        return null;
      }
      this.log(project, record.diagnostics, 'cache', 'quarantined', record.reason);
      await this.removePrefetchTarget(project.id, context);
      if (!record.warningAcknowledged) {
        this.addWarning({ ...project, geojson_revision: record.geojsonRevision }, record.reason, record.diagnostics, true);
      }
      return { ...NO_OUTCOME, quarantined: 1, failed: 1, skipped: 1 };
    }
    if (record.state !== 'legacy') return null;
    if (outdated && allowDownloads && this.dependencies.hasNetworkAccess()) return null;
    // An offline audit validates the cached artifact, never the advertised replacement.
    const cachedProject = { ...project, geojson_revision: record.geojsonRevision };

    const normalized = this.runTiming.measureSynchronous(
      context.runId,
      'normalization_work',
      () => normalizeGeoJSON(record.data),
    );
    if (!normalized) {
      await this.quarantine(
        context,
        cachedProject,
        'invalid_geojson',
        this.emptyDiagnostics(),
      );
      return { ...NO_OUTCOME, quarantined: 1, failed: 1, localWork: true };
    }
    return this.validateOutcome(context, cachedProject, normalized, 0);
  }

  private async downloadAndValidate(
    context: CancellationContext,
    project: Project,
    preserveActive: boolean,
  ): Promise<ProjectOutcome> {
    const response = await this.runTiming.measure(
      context.runId,
      'download_work',
      () => this.dependencies.transport.downloadJSON(
        project.geojson_file!,
        { signal: context.signal },
      ),
    );
    context.throwIfAborted();
    if (!isSuccessfulStatus(response.status)) {
      console.warn(`Skipping project GeoJSON cache: status ${response.status}`);
      return { ...NO_OUTCOME, failed: 1 };
    }
    const normalized = this.runTiming.measureSynchronous(
      context.runId,
      'normalization_work',
      () => normalizeGeoJSON(response.data),
    );
    if (!normalized) {
      await this.quarantine(context, project, 'invalid_geojson', this.emptyDiagnostics(), preserveActive);
      return { ...NO_OUTCOME, downloaded: 1, quarantined: 1, failed: 1, localWork: true };
    }
    return this.validateOutcome(context, project, normalized, 1, preserveActive);
  }

  private async validateOutcome(
    context: CancellationContext,
    project: Project,
    featureCollection: GeoJSON.FeatureCollection,
    downloaded: number,
    preserveActive = false,
  ): Promise<ProjectOutcome> {
    const outcome = await this.validate(context, project, featureCollection, preserveActive);
    return outcome === 'active'
      ? { ...NO_OUTCOME, downloaded, validated: 1, localWork: true }
      : { ...NO_OUTCOME, downloaded, quarantined: 1, failed: 1, localWork: true };
  }

  private async validate(
    context: CancellationContext,
    project: Project,
    featureCollection: GeoJSON.FeatureCollection,
    preserveActive: boolean,
  ): Promise<'active' | 'quarantined'> {
    let analysis: ProjectGeoJSONAnalysis;
    try {
      analysis = await this.runTiming.measure(
        context.runId,
        'validation_work',
        () => this.dependencies.analyzer.analyze(
          featureCollection,
          { signal: context.signal },
        ),
      );
      context.throwIfAborted();
    } catch (error) {
      if (isAbortError(error)) throw error;
      const reason = error instanceof ProjectGeoJSONAnalysisError ? error.reason : 'bbox_error';
      const diagnostics = error instanceof ProjectGeoJSONAnalysisError
        ? error.diagnostics
        : this.emptyDiagnostics();
      await this.quarantine(context, project, reason, diagnostics, preserveActive);
      return 'quarantined';
    }

    if (isProjectGeoJSONOversized(analysis)) {
      await this.quarantine(
        context,
        project,
        'bbox_too_large',
        this.diagnosticsFromAnalysis(analysis),
        preserveActive,
      );
      return 'quarantined';
    }
    const didCache = await this.runTiming.measure(
      context.runId,
      'cache_write_work',
      () => this.dependencies.cache.setValidatedProjectGeoJSON(
        project.id,
        featureCollection,
        project.latest_commit.id,
        analysis,
        { signal: context.signal, geojsonRevision: project.geojson_revision },
      ),
    );
    context.throwIfAborted();
    if (!didCache) {
      await this.quarantine(
        context,
        project,
        'validation_unavailable',
        this.diagnosticsFromAnalysis(analysis),
        preserveActive,
      );
      return 'quarantined';
    }
    this.blockedCommits.delete(this.key(project.id, project.latest_commit.id, project.geojson_revision));
    this._warnings = this._warnings.filter((warning) => warning.projectId !== project.id);
    this.log(project, analysis, 'computed', 'active');
    return 'active';
  }

  private async quarantine(
    context: CancellationContext,
    project: Project,
    reason: ProjectGeoJSONFailureReason,
    diagnostics: ProjectGeoJSONFailureDiagnostics,
    preserveActive = false,
  ): Promise<void> {
    const key = this.key(project.id, project.latest_commit.id, project.geojson_revision);
    const geojsonRevision = normalizeGeoJSONRevision(project.geojson_revision);
    const fileScoped = this.isContentFailure(reason);
    let persisted = false;
    if (fileScoped) {
      persisted = await this.runTiming.measure(
        context.runId,
        'cache_write_work',
        () => preserveActive && geojsonRevision
          ? this.dependencies.cache.rejectProjectGeoJSONReplacement(
            project.id,
            project.latest_commit.id,
            { geojsonRevision, reason, diagnostics, warningAcknowledged: false },
            { signal: context.signal },
          )
          : this.dependencies.cache.setQuarantinedProjectGeoJSON(
          project.id,
          project.latest_commit.id,
          reason,
          diagnostics,
          { signal: context.signal, geojsonRevision },
        ),
      );
      context.throwIfAborted();
    }
    if (persisted) this.blockedCommits.delete(key);
    else this.blockForSession(project, reason, diagnostics, false, preserveActive);

    if (!preserveActive) await this.removePrefetchTarget(project.id, context);
    this.log(project, diagnostics, 'computed', 'quarantined', reason);
    this.addWarning(project, reason, diagnostics, persisted, preserveActive);
    if (fileScoped && !persisted) {
      console.warn('[project-geojson:quarantine-persistence-failed]', {
        projectId: project.id,
        projectName: project.name,
        commitId: project.latest_commit.id,
      });
    }
  }

  private async removePrefetchTarget(
    projectId: string,
    context: CancellationContext,
  ): Promise<void> {
    try {
      await this.dependencies.removePrefetchTarget(projectId, context.signal);
      context.throwIfAborted();
    } catch (error) {
      if (isAbortError(error)) throw error;
      console.warn('Failed removing project map prefetch:', error);
    }
    context.throwIfAborted();
  }

  private pruneStaleState(projects: Project[]): void {
    const currentProjects = new Map(projects.map((project) => [project.id, project]));
    const isCurrent = (projectId: string, commitId: string, revision?: string | null): boolean => {
      const project = currentProjects.get(projectId);
      if (!project || project.latest_commit.id !== commitId) return false;
      const advertisedRevision = normalizeGeoJSONRevision(project.geojson_revision);
      // Older servers still identify artifacts by source commit. Keep the cached
      // artifact's actual identity so warnings remain stable and acknowledgeable.
      return advertisedRevision === null || advertisedRevision === normalizeGeoJSONRevision(revision);
    };
    const retainedWarnings = this._warnings.filter((warning) => isCurrent(
      warning.projectId, warning.commitId, warning.geojsonRevision,
    ));
    if (retainedWarnings.length !== this._warnings.length) {
      this._warnings = retainedWarnings;
    }
    for (const key of this.blockedCommits.keys()) {
      const [projectId, commitId, revision] = JSON.parse(key) as [string, string, string | null];
      if (!isCurrent(projectId, commitId, revision)) this.blockedCommits.delete(key);
    }
  }

  private addWarning(
    project: Project,
    reason: ProjectGeoJSONFailureReason,
    diagnostics: ProjectGeoJSONFailureDiagnostics,
    persistent: boolean,
    preservesCachedMap = false,
  ): void {
    const warning: ProjectGeoJSONWarning = {
      projectId: project.id,
      projectName: project.name,
      commitId: project.latest_commit.id,
      reason,
      widthKm: diagnostics.widthKm,
      heightKm: diagnostics.heightKm,
      durationMs: diagnostics.durationMs,
      persistent,
      ...(project.geojson_revision ? { geojsonRevision: project.geojson_revision } : {}),
      ...(preservesCachedMap ? { preservesCachedMap } : {}),
    };
    const existing = this._warnings.find((candidate) => (
      candidate.projectId === warning.projectId && candidate.commitId === warning.commitId
    ));
    if (existing && this.sameWarning(existing, warning)) return;
    const next = this._warnings.filter((candidate) => candidate.projectId !== project.id);
    next.push(warning);
    next.sort((left, right) => left.projectName.localeCompare(right.projectName));
    this._warnings = next;
    this.dependencies.notifyStateChanged();
  }

  private sameWarning(left: ProjectGeoJSONWarning, right: ProjectGeoJSONWarning): boolean {
    return left.projectName === right.projectName
      && left.reason === right.reason
      && left.widthKm === right.widthKm
      && left.heightKm === right.heightKm
      && left.durationMs === right.durationMs
      && left.persistent === right.persistent
      && left.preservesCachedMap === right.preservesCachedMap
      && normalizeGeoJSONRevision(left.geojsonRevision) === normalizeGeoJSONRevision(right.geojsonRevision);
  }

  private blockForSession(
    project: Project,
    reason: ProjectGeoJSONFailureReason,
    diagnostics: ProjectGeoJSONFailureDiagnostics,
    retryWhenOnline = false,
    preserveActive = false,
  ): void {
    this.blockedCommits.set(this.key(project.id, project.latest_commit.id, project.geojson_revision), {
      reason,
      diagnostics,
      warningAcknowledged: false,
      retryWhenOnline,
      preserveActive,
    });
  }

  private log(
    project: Project,
    diagnostics: ProjectGeoJSONAnalysis | ProjectGeoJSONFailureDiagnostics,
    source: 'computed' | 'cache',
    status: 'active' | 'quarantined',
    reason?: ProjectGeoJSONFailureReason,
  ): void {
    const details = {
      projectId: project.id,
      projectName: project.name,
      commitId: project.latest_commit.id,
      source,
      widthKm: diagnostics.widthKm,
      heightKm: diagnostics.heightKm,
      durationMs: diagnostics.durationMs,
      status,
      ...(reason ? { reason } : {}),
    };
    if (status === 'active') console.info('[project-geojson:bbox]', details);
    else console.warn('[project-geojson:bbox]', details);
  }

  private result(
    status: GeoJSONSyncPhaseResult['status'],
    reason: GeoJSONSyncPhaseResult['reason'],
    eligibleProjectCount: number,
    counts: ProjectOutcome,
  ): GeoJSONSyncPhaseResult {
    return {
      phase: 'geojson_sync',
      status,
      reason,
      eligibleProjectCount,
      downloadedProjectCount: counts.downloaded,
      validatedProjectCount: counts.validated,
      quarantinedProjectCount: counts.quarantined,
      skippedProjectCount: counts.skipped,
      failedProjectCount: counts.failed,
    };
  }

  private key(projectId: string, commitId: string, revision?: string | null): string {
    return JSON.stringify([projectId, commitId, normalizeGeoJSONRevision(revision)]);
  }

  private emptyDiagnostics(): ProjectGeoJSONFailureDiagnostics {
    return { bounds: null, widthKm: null, heightKm: null, durationMs: null };
  }

  private diagnosticsFromAnalysis(
    analysis: ProjectGeoJSONAnalysis,
  ): ProjectGeoJSONFailureDiagnostics {
    return {
      bounds: analysis.bounds,
      widthKm: analysis.widthKm,
      heightKm: analysis.heightKm,
      durationMs: analysis.durationMs,
    };
  }

  private isContentFailure(
    reason: ProjectGeoJSONFailureReason,
  ): reason is ProjectGeoJSONContentFailureReason {
    return reason !== 'validation_unavailable' && reason !== 'bbox_timeout';
  }

}
