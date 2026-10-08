import { copyFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pins = spawnSync(process.execPath, [path.join(appRoot, 'scripts/check-shared-package-pins.mjs')], { cwd: appRoot, stdio: 'inherit' });
if (pins.error) throw pins.error;
if (pins.status !== 0) process.exit(pins.status ?? 1);
if (statSync(path.join(appRoot, 'bun.lock')).size === 0) throw new Error('bun.lock must not be empty.');
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'speleodb-mobile-lock-'));
try {
  for (const file of ['package.json', 'bun.lock', 'bunfig.toml']) copyFileSync(path.join(appRoot, file), path.join(temporaryRoot, file));
  const result = spawnSync(process.execPath, ['install', '--frozen-lockfile', '--lockfile-only', '--ignore-scripts'], { cwd: temporaryRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
