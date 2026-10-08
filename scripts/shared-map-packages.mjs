import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Validate live workspace links when the monorepo overlay is selected. */
export function useLocalSharedMapPackages() {
  if (process.env.SPELEODB_LOCAL_PACKAGES === '0') return false;
  const root = path.resolve(appRoot, '../..');
  const manifestPath = path.join(root, 'package.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  const local = process.env.SPELEODB_LOCAL_PACKAGES === '1'
    || (manifest?.name === 'speleodb-monorepo' && Boolean(manifest.overrides?.['@speleodb/map-core']));
  if (local) {
    const fromApp = createRequire(path.join(appRoot, 'package.json'));
    const installed = new Map();
    for (const name of ['map-core', 'map-viewer']) {
      const expected = path.join(root, 'packages/typescript', name, 'src/index.ts');
      if (!existsSync(expected)) {
        throw new Error(`The local shared map package ${name} is missing. Initialize its checkout or install the standalone source packages.`);
      }
      let packagePath;
      try { packagePath = fromApp.resolve(`@speleodb/${name}/package.json`); }
      catch { throw new Error(`The local shared map package ${name} is not installed. Run bun run install:local from the monorepo root.`); }
      const installedSource = path.join(path.dirname(packagePath), 'src/index.ts');
      if (!existsSync(installedSource) || realpathSync(installedSource) !== realpathSync(expected)) {
        throw new Error(`The installed ${name} is not the live local checkout. Run bun run install:local from the monorepo root before using shared sources.`);
      }
      installed.set(name, packagePath);
    }
    const fromViewer = createRequire(installed.get('map-viewer'));
    let viewerCore;
    try { viewerCore = fromViewer.resolve('@speleodb/map-core/package.json'); }
    catch { throw new Error('The installed map-viewer cannot resolve its map-core dependency. Run bun run install:local from the monorepo root.'); }
    if (realpathSync(viewerCore) !== realpathSync(installed.get('map-core'))) {
      throw new Error('The installed map-viewer resolves a different map-core. Run bun run install:local from the monorepo root before using shared sources.');
    }
  }
  return local;
}
