import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config';

interface CoverageThresholds {
  statements?: number;
  branches?: number;
  functions?: number;
  lines?: number;
  perFile?: boolean;
  autoUpdate?: boolean;
  [file: string]: number | boolean | CoverageThresholds | undefined;
}

function configuredThresholds(): CoverageThresholds | undefined {
  const factory = viteConfig as unknown as (environment: {
    command: 'serve';
    mode: 'test';
    isSsrBuild: false;
    isPreview: false;
  }) => {
    test?: { coverage?: { thresholds?: CoverageThresholds } };
  };
  return factory({
    command: 'serve',
    mode: 'test',
    isSsrBuild: false,
    isPreview: false,
  }).test?.coverage?.thresholds;
}

describe('release coverage thresholds', () => {
  it('enforces audited global non-regression floors', () => {
    expect(configuredThresholds()).toMatchObject({
      statements: 90,
      branches: 82,
      functions: 92,
      lines: 92,
      perFile: false,
      autoUpdate: false,
    });
  });

  it('pins stronger owning-seam floors for critical state and persistence modules', () => {
    expect(configuredThresholds()).toMatchObject({
      'src/controllers/GpsRecordingCoordinator.ts': {
        statements: 97,
        branches: 91,
        functions: 100,
        lines: 100,
      },
      'src/controllers/SessionCoordinator.ts': {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
      'src/offline/OfflineOpQueue.ts': {
        statements: 82,
        branches: 65,
        functions: 93,
        lines: 83,
      },
      'src/services/CacheStore.ts': {
        statements: 81,
        branches: 69,
        functions: 88,
        lines: 81,
      },
    });
  });
});
