import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const temporaryRoots: string[] = [];

function fixture(options: { monorepo?: boolean; packages?: boolean; archived?: 'map-core' | 'map-viewer'; viewerCoreArchive?: boolean; typecheck?: boolean; compilerArgs?: string[] } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'speleodb-map-source-mode-'));
  temporaryRoots.push(root);
  const scripts = path.join(root, 'apps/mobile/scripts');
  mkdirSync(scripts, { recursive: true });
  const modulePath = path.join(scripts, 'shared-map-packages.mjs');
  copyFileSync('scripts/shared-map-packages.mjs', modulePath);
  if (options.typecheck) {
    copyFileSync('scripts/typecheck.mjs', path.join(scripts, 'typecheck.mjs'));
    const compiler = path.join(root, 'apps/mobile/node_modules/typescript/lib');
    mkdirSync(compiler, { recursive: true });
    writeFileSync(path.join(compiler, 'tsc.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
  }
  if (options.monorepo) {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'speleodb-monorepo',
      overrides: { '@speleodb/map-core': 'workspace:*', '@speleodb/map-viewer': 'workspace:*' },
    }));
  }
  if (options.packages) {
    const scope = path.join(root, 'apps/mobile/node_modules/@speleodb');
    mkdirSync(scope, { recursive: true });
    const makePackage = (directory: string, name: string) => {
      mkdirSync(path.join(directory, 'src'), { recursive: true });
      writeFileSync(path.join(directory, 'src/index.ts'), 'export {};\n');
      writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
        name: `@speleodb/${name}`, exports: { './package.json': './package.json' },
      }));
    };
    for (const name of ['map-core', 'map-viewer']) {
      const checkout = path.join(root, 'packages/typescript', name);
      makePackage(checkout, name);
      if (options.archived === name) makePackage(path.join(scope, name), name);
      else symlinkSync(checkout, path.join(scope, name), 'dir');
    }
    const viewerScope = path.join(root, 'packages/typescript/map-viewer/node_modules/@speleodb');
    mkdirSync(viewerScope, { recursive: true });
    if (options.viewerCoreArchive) makePackage(path.join(viewerScope, 'map-core'), 'map-core');
    else symlinkSync(path.join(root, 'packages/typescript/map-core'), path.join(viewerScope, 'map-core'), 'dir');
  }
  return (mode = '') => spawnSync(process.execPath, options.typecheck ? [path.join(scripts, 'typecheck.mjs'), ...(options.compilerArgs ?? [])] : ['-e',
    `import { useLocalSharedMapPackages } from ${JSON.stringify(pathToFileURL(modulePath).href)}; process.stdout.write(String(useLocalSharedMapPackages()));`,
  ], {
    env: { ...process.env, SPELEODB_LOCAL_PACKAGES: mode },
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('shared map source consumption and workspace validation', () => {
  it('uses installed source packages in standalone clones', () => {
    expect(fixture()().stdout).toBe('false');
  });

  it('selects live sources for the root dependency overlay', () => {
    const result = fixture({ monorepo: true, packages: true })();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('true');
  });

  it('does not infer local mode merely from neighboring source directories', () => {
    expect(fixture({ packages: true })().stdout).toBe('false');
  });

  it('allows installed source packages even when local checkouts are missing', () => {
    const result = fixture({ monorepo: true })('0');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('false');
  });

  it('fails before compilation when the configured local packages are absent', () => {
    const result = fixture({ monorepo: true })();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('The local shared map package map-core is missing');
  });

  it('supports an explicit local-source request without a root override', () => {
    const result = fixture({ packages: true })('1');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('true');
  });

  it.each(['map-core', 'map-viewer'] as const)('rejects archived %s sources beside live checkouts', archived => {
    const result = fixture({ monorepo: true, packages: true, archived })();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`The installed ${archived} is not the live local checkout`);
  });

  it('rejects a viewer whose core dependency differs from the app dependency', () => {
    const result = fixture({ monorepo: true, packages: true, viewerCoreArchive: true })();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('The installed map-viewer resolves a different map-core');
  });

  it('selects source exports for standalone type checks', () => {
    const result = fixture({ typecheck: true })('0');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(['--noEmit', '--customConditions', 'speleodb-source']);
  });

  it('selects live type sources only after verifying the installed dependency graph', () => {
    const result = fixture({ monorepo: true, packages: true, typecheck: true })();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(['--noEmit', '--customConditions', 'speleodb-source']);
  });

  it('keeps source conditions authoritative over caller-supplied compiler flags', () => {
    const result = fixture({ typecheck: true, compilerArgs: ['--customConditions', 'irrelevant-condition'] })('0');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).slice(-2)).toEqual(['--customConditions', 'speleodb-source']);
  });

  it.each([false, true])('typechecks installed source without dist (legacy exports: %s)', legacy => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'speleodb-map-source-types-'));
    temporaryRoots.push(root);
    mkdirSync(path.join(root, 'scripts'), { recursive: true });
    mkdirSync(path.join(root, 'node_modules/@speleodb/map-core/src'), { recursive: true });
    for (const name of ['typecheck.mjs', 'shared-map-packages.mjs']) {
      copyFileSync(path.join('scripts', name), path.join(root, 'scripts', name));
    }
    const require = createRequire(import.meta.url);
    symlinkSync(path.dirname(require.resolve('typescript/package.json')), path.join(root, 'node_modules/typescript'), 'dir');
    writeFileSync(path.join(root, 'node_modules/@speleodb/map-core/package.json'), JSON.stringify({
      name: '@speleodb/map-core', type: 'module',
      exports: { '.': legacy
        ? { 'speleodb-source': './src/index.ts', types: './dist/index.d.ts', default: './dist/index.js' }
        : { types: './src/index.ts', default: './src/index.ts' } },
    }));
    writeFileSync(path.join(root, 'node_modules/@speleodb/map-core/src/index.ts'), 'export type Marker = "source";\n');
    writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { module: 'ESNext', moduleResolution: 'bundler', target: 'ES2022', types: [], customConditions: ['speleodb-source'] },
      files: ['consumer.ts'],
    }));
    const run = () => spawnSync(process.execPath, [path.join(root, 'scripts/typecheck.mjs')], {
      cwd: root, env: { ...process.env, SPELEODB_LOCAL_PACKAGES: '0' }, encoding: 'utf8',
    });
    writeFileSync(path.join(root, 'consumer.ts'), 'import type { Marker } from "@speleodb/map-core"; const marker: Marker = "source";\n');
    const accepted = run();
    expect(accepted.status, accepted.stdout + accepted.stderr).toBe(0);
    writeFileSync(path.join(root, 'consumer.ts'), 'import type { Marker } from "@speleodb/map-core"; const marker: Marker = "artifact";\n');
    const rejected = run();
    expect(rejected.status).not.toBe(0);
    expect(rejected.stdout).toContain('not assignable to type');
  });
});
