import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { useLocalSharedMapPackages } from './shared-map-packages.mjs';

const require = createRequire(import.meta.url);
useLocalSharedMapPackages();
// Older Git pins expose source through this condition; new pins default to source.
const args = [require.resolve('typescript/lib/tsc.js'), '--noEmit', ...process.argv.slice(2), '--customConditions', 'speleodb-source'];
const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
