import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sentryPackagePath = path.join(repoRoot, 'node_modules', '@sentry', 'capacitor', 'Package.swift');
const sentryCapacitorAndroidGradlePath = path.join(
  repoRoot,
  'node_modules',
  '@sentry',
  'capacitor',
  'android',
  'build.gradle',
);
const capacitorPackagesDir = path.join(repoRoot, 'node_modules', '@capacitor');

const sourceDependency = '.product(name: "Sentry", package: "sentry-cocoa")';
const dynamicDependency = '.product(name: "Sentry-Dynamic", package: "sentry-cocoa")';
const legacyProguardConfig = "getDefaultProguardFile('proguard-android.txt')";
const optimizedProguardConfig = "getDefaultProguardFile('proguard-android-optimize.txt')";

function patchSentrySwiftPackage() {
  if (!existsSync(sentryPackagePath)) {
    console.log('[sentry] Skipping patch: @sentry/capacitor Package.swift not found.');
    return;
  }

  const current = readFileSync(sentryPackagePath, 'utf8');

  if (current.includes(dynamicDependency)) {
    console.log('[sentry] @sentry/capacitor already patched to Sentry-Dynamic.');
    return;
  }

  if (!current.includes(sourceDependency)) {
    console.warn('[sentry] Could not find expected Sentry dependency line in Package.swift.');
    return;
  }

  const patched = current.replace(sourceDependency, dynamicDependency);
  writeFileSync(sentryPackagePath, patched, 'utf8');
  console.log('[sentry] Patched @sentry/capacitor to use Sentry-Dynamic for iOS dSYM compatibility.');
}

function patchCapacitorAndroidProguardDefaults() {
  if (!existsSync(capacitorPackagesDir)) {
    console.log('[gradle] Skipping patch: @capacitor directory not found.');
    return;
  }

  const patchedPackages = [];

  const packageDirs = readdirSync(capacitorPackagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const packageName of packageDirs) {
    const gradleFilePath = path.join(capacitorPackagesDir, packageName, 'android', 'build.gradle');
    if (!existsSync(gradleFilePath)) {
      continue;
    }

    const currentGradle = readFileSync(gradleFilePath, 'utf8');
    if (!currentGradle.includes(legacyProguardConfig)) {
      continue;
    }

    const patchedGradle = currentGradle.split(legacyProguardConfig).join(optimizedProguardConfig);
    writeFileSync(gradleFilePath, patchedGradle, 'utf8');
    patchedPackages.push(`@capacitor/${packageName}`);
  }

  if (patchedPackages.length === 0) {
    console.log('[gradle] No @capacitor Android ProGuard patches were needed.');
    return;
  }

  console.log(`[gradle] Updated default ProGuard file for: ${patchedPackages.join(', ')}`);
}

function patchSentryCapacitorAndroidProguardDefault() {
  if (!existsSync(sentryCapacitorAndroidGradlePath)) {
    console.log('[gradle] Skipping patch: @sentry/capacitor Android build.gradle not found.');
    return;
  }

  const currentGradle = readFileSync(sentryCapacitorAndroidGradlePath, 'utf8');
  if (!currentGradle.includes(legacyProguardConfig)) {
    console.log('[gradle] @sentry/capacitor Android ProGuard config is already compatible.');
    return;
  }

  const patchedGradle = currentGradle.split(legacyProguardConfig).join(optimizedProguardConfig);
  writeFileSync(sentryCapacitorAndroidGradlePath, patchedGradle, 'utf8');
  console.log('[gradle] Updated default ProGuard file for: @sentry/capacitor');
}

patchSentrySwiftPackage();
patchCapacitorAndroidProguardDefaults();
patchSentryCapacitorAndroidProguardDefault();
