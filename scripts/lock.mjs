import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const helper = fileURLToPath(new URL('../../../utilities/bun-lock/lock.mjs', import.meta.url));
if (!existsSync(helper)) {
    console.error('bun run lock requires the SpeleoDB monorepo. In a standalone clone, use bun install --lockfile-only --ignore-scripts.');
    process.exit(1);
}
const result = spawnSync(process.execPath, [helper, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
