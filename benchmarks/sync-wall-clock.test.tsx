import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CacheStore } from '../src/services/CacheStore';
import { ProjectCacheService } from '../src/services/ProjectCacheService';
import { ProjectGeoJSONAnalyzer } from '../src/services/ProjectGeoJSONAnalyzer';
import type { SpeleoDBService } from '../src/services/SpeleoDBService';
import type { Project } from '../src/types/project';
import type { ProjectGeoJSONAnalysis } from '../src/types/projectGeoJSON';
import { useDashboardMapData } from '../src/pages/dashboard/useDashboardMapData';
import { ProjectGeoJSONCoordinator } from '../src/controllers/ProjectGeoJSONCoordinator';
import { ProjectSyncCoordinator } from '../src/controllers/ProjectSyncCoordinator';
import type { ProjectOverlaySyncCoordinator } from '../src/controllers/ProjectOverlaySyncCoordinator';
import type { SessionStore } from '../src/services/SecureSessionStore';

const PROJECT_COUNT = 60;
const FEATURES_PER_PROJECT = 2_000;
const SAMPLE_COUNT = 5;
const FULL_SYNC_SAMPLE_COUNT = 3;

function project(index: number): Project {
  return {
    id: `project-${index}`,
    name: `Project ${index}`,
    description: '',
    country: 'US',
    color: '#377eb8',
    type: 'COMPASS',
    visibility: 'PRIVATE',
    is_active: true,
    created_by: 'benchmark@example.test',
    creation_date: '2026-01-01',
    modified_date: '2026-01-01',
    commit_count: 1,
    active_mutex: null,
    fork_from: null,
    exclude_geojson: false,
    geojson_file: `https://example.test/project-${index}.geojson`,
    latest_commit: {
      id: `commit-${index}`,
      message: 'benchmark',
      author_email: 'benchmark@example.test',
      author_name: 'Benchmark',
      authored_date: '2026-01-01',
      dt_since: 'today',
      parent_ids: [],
      url: '',
      formats: [],
      tree: [],
    },
  };
}

function featureCollection(projectIndex: number): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: Array.from({ length: FEATURES_PER_PROJECT }, (_, featureIndex) => ({
      type: 'Feature' as const,
      properties: {
        name: `station-${projectIndex}-${featureIndex}`,
        depth: featureIndex % 300,
        survey: `survey-${featureIndex % 20}`,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [
          -80 + ((projectIndex * 0.01 + featureIndex * 0.00001) % 10),
          35 + ((projectIndex * 0.01 + featureIndex * 0.00001) % 10),
          -(featureIndex % 300),
        ],
      },
    })),
  };
}

const analysis: ProjectGeoJSONAnalysis = {
  bounds: { west: -80, east: -79.5, south: 35, north: 35.5, crossesDateline: false },
  widthKm: 46,
  heightKm: 56,
  durationMs: 1,
};

function percentile(samples: number[], fraction: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

describe('60-project cache-to-Dashboard wall clock', () => {
  const projects = Array.from({ length: PROJECT_COUNT }, (_, index) => project(index));
  const payloads = projects.map((_, index) => featureCollection(index));
  const store = new CacheStore();
  const firstPublicationSamples: number[] = [];
  const coldSamples: number[] = [];
  const warmSamples: number[] = [];
  const mountedHeapDeltaMiB: number[] = [];

  beforeAll(async () => {
    const seeder = new ProjectCacheService(store);
    await seeder.clearAll();
    for (let index = 0; index < PROJECT_COUNT; index += 1) {
      const saved = await seeder.setValidatedProjectGeoJSON(
        projects[index].id,
        payloads[index],
        projects[index].latest_commit.id,
        analysis,
      );
      expect(saved).toBe(true);
    }
  });

  afterAll(async () => {
    cleanup();
    await new ProjectCacheService(store).clearAll();
  });

  it('records cold and same-session revision latency', async () => {
    for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
      const collectGarbage = (globalThis as typeof globalThis & { gc?: () => void }).gc;
      collectGarbage?.();
      const heapBefore = process.memoryUsage().heapUsed;
      const cache = new ProjectCacheService(store);
      const source = {
        getProjectMapData: async (projectId: string) => {
          const record = await cache.getProjectGeoJSONRecord(projectId);
          return record.state === 'active'
            ? {
              commitId: record.commitId,
              featureCollection: record.data,
              bounds: record.analysis.bounds,
            }
            : null;
        },
        getOverlayGeoJSON: async () => null,
      };
      const startedAt = performance.now();
      const { result, rerender, unmount } = renderHook(
        ({ revision }) => useDashboardMapData({
          source,
          projects,
          mapDataRevision: revision,
          landmarksRevision: 0,
          yieldWork: async () => {},
        }),
        { initialProps: { revision: 1 } },
      );
      await waitFor(() => {
        expect(Object.keys(result.current.currentProjectMapData).length).toBeGreaterThan(0);
      });
      firstPublicationSamples.push(performance.now() - startedAt);
      await waitFor(() => {
        expect(Object.keys(result.current.currentProjectMapData)).toHaveLength(PROJECT_COUNT);
      });
      coldSamples.push(performance.now() - startedAt);
      collectGarbage?.();
      mountedHeapDeltaMiB.push((process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024);

      const warmStartedAt = performance.now();
      rerender({ revision: 2 });
      await waitFor(() => {
        expect(Object.keys(result.current.currentProjectMapData)).toHaveLength(PROJECT_COUNT);
      });
      warmSamples.push(performance.now() - warmStartedAt);
      unmount();
    }

    const payloadBytes = payloads.reduce(
      (sum, payload) => sum + new TextEncoder().encode(JSON.stringify(payload)).byteLength,
      0,
    );
    const record = {
      projectCount: PROJECT_COUNT,
      featuresPerProject: FEATURES_PER_PROJECT,
      payloadMiB: Math.round((payloadBytes / 1024 / 1024) * 10) / 10,
      firstPublicationMs: firstPublicationSamples.map((value) => Math.round(value * 10) / 10),
      firstPublicationMedianMs:
        Math.round(percentile(firstPublicationSamples, 0.5) * 10) / 10,
      coldMs: coldSamples.map((value) => Math.round(value * 10) / 10),
      coldMedianMs: Math.round(percentile(coldSamples, 0.5) * 10) / 10,
      coldWorstMs: Math.round(Math.max(...coldSamples) * 10) / 10,
      warmMs: warmSamples.map((value) => Math.round(value * 10) / 10),
      warmMedianMs: Math.round(percentile(warmSamples, 0.5) * 10) / 10,
      warmWorstMs: Math.round(Math.max(...warmSamples) * 10) / 10,
      mountedHeapDeltaMiB: mountedHeapDeltaMiB.map((value) => Math.round(value * 10) / 10),
      mountedHeapMedianMiB: Math.round(percentile(mountedHeapDeltaMiB, 0.5) * 10) / 10,
    };
    process.stdout.write(`SYNC_WALL_CLOCK ${JSON.stringify(record)}\n`);
  });

  it('records the complete post-network synchronization path', async () => {
    const syncSamples: number[] = [];
    const maximumTimerDelaySamples: number[] = [];

    for (let sample = 0; sample < FULL_SYNC_SAMPLE_COUNT; sample += 1) {
      const cache = new ProjectCacheService(store);
      await cache.clearAll();
      const transport = {
        getProjectsGeoJSON: async () => ({ status: 200, data: projects }),
        downloadJSON: async (url: string) => {
          const projectIndex = Number(url.match(/project-(\d+)/)?.[1] ?? -1);
          return { status: 200, data: payloads[projectIndex] };
        },
      } as unknown as SpeleoDBService;
      const geoJSON = new ProjectGeoJSONCoordinator({
        cache,
        transport,
        analyzer: new ProjectGeoJSONAnalyzer(),
        hasNetworkAccess: () => true,
        removePrefetchTarget: async () => {},
        notifyStateChanged: () => {},
      });
      const overlays = {
        sync: async () => ({
          phase: 'overlay_sync' as const,
          status: 'applied' as const,
          reason: 'overlays_synced' as const,
          attemptedOverlayCount: 5,
          syncedOverlayCount: 5,
          failedOverlayCount: 0,
        }),
      } as ProjectOverlaySyncCoordinator;
      const sessions = {
        initialize: async () => ({ instance: 'https://example.test', token: 'token' }),
        getSession: () => ({ instance: 'https://example.test', token: 'token' }),
        establish: async () => {},
        clear: async () => {},
      } as SessionStore;
      const coordinator = new ProjectSyncCoordinator({
        cache,
        transport,
        sessions,
        metadata: { getLastSyncedAt: () => undefined, setLastSyncedAt: () => {} },
        geoJSON,
        overlays,
        hooks: {
          hasNetworkAccess: () => true,
          markOnline: () => {},
          enterOfflineMode: () => {},
          notifyStateChanged: () => {},
          bumpLandmarksRevision: () => {},
          syncGpsTracks: async () => {},
          queueTilePrefetch: () => {},
        },
        now: () => Date.now(),
        elapsedNow: () => performance.now(),
      });

      let lastTimerAt = performance.now();
      let maximumTimerDelay = 0;
      const timer = setInterval(() => {
        const now = performance.now();
        maximumTimerDelay = Math.max(maximumTimerDelay, now - lastTimerAt);
        lastTimerAt = now;
      }, 1);
      const startedAt = performance.now();
      const result = await coordinator.sync();
      syncSamples.push(performance.now() - startedAt);
      clearInterval(timer);
      maximumTimerDelaySamples.push(maximumTimerDelay);
      expect(result.phases.geojsonSync).toMatchObject({
        status: 'applied',
        downloadedProjectCount: PROJECT_COUNT,
        validatedProjectCount: PROJECT_COUNT,
      });
    }

    const record = {
      projectCount: PROJECT_COUNT,
      payloadMiB: 18.1,
      syncMs: syncSamples.map((value) => Math.round(value * 10) / 10),
      syncMedianMs: Math.round(percentile(syncSamples, 0.5) * 10) / 10,
      syncWorstMs: Math.round(Math.max(...syncSamples) * 10) / 10,
      maximumTimerDelayMs:
        maximumTimerDelaySamples.map((value) => Math.round(value * 10) / 10),
      maximumTimerDelayMedianMs:
        Math.round(percentile(maximumTimerDelaySamples, 0.5) * 10) / 10,
    };
    process.stdout.write(`SYNC_FULL_PATH ${JSON.stringify(record)}\n`);
  });
});
