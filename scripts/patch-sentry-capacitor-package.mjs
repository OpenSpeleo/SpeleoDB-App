import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sentryPackagePath = path.join(repoRoot, 'node_modules', '@sentry', 'capacitor', 'Package.swift');

const sourceDependency = '.product(name: "Sentry", package: "sentry-cocoa")';
const dynamicDependency = '.product(name: "Sentry-Dynamic", package: "sentry-cocoa")';

if (!existsSync(sentryPackagePath)) {
  console.log('[sentry] Skipping patch: @sentry/capacitor Package.swift not found.');
  process.exit(0);
}

const current = readFileSync(sentryPackagePath, 'utf8');

if (current.includes(dynamicDependency)) {
  console.log('[sentry] @sentry/capacitor already patched to Sentry-Dynamic.');
  process.exit(0);
}

if (!current.includes(sourceDependency)) {
  console.warn('[sentry] Could not find expected Sentry dependency line in Package.swift.');
  process.exit(0);
}

const patched = current.replace(sourceDependency, dynamicDependency);
writeFileSync(sentryPackagePath, patched, 'utf8');
console.log('[sentry] Patched @sentry/capacitor to use Sentry-Dynamic for iOS dSYM compatibility.');
