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
const backgroundGeolocationPackagePath = path.join(
  repoRoot,
  'node_modules',
  '@capacitor-community',
  'background-geolocation',
  'Package.swift',
);
const backgroundGeolocationAndroidGradlePath = path.join(
  repoRoot,
  'node_modules',
  '@capacitor-community',
  'background-geolocation',
  'android',
  'build.gradle',
);

const sourceDependency = '.product(name: "Sentry", package: "sentry-cocoa")';
const dynamicDependency = '.product(name: "Sentry-Dynamic", package: "sentry-cocoa")';
const legacyProguardConfig = "getDefaultProguardFile('proguard-android.txt')";
const optimizedProguardConfig = "getDefaultProguardFile('proguard-android-optimize.txt')";
const gradle10PropertyAssignments = ['namespace', 'abortOnError'];

// Historical filename aside, this postinstall owns all node_modules patches
// required by the native Capacitor build: Sentry iOS product selection,
// background-geolocation's SwiftPM Capacitor range, Android ProGuard defaults,
// and AGP 9 Kotlin plugin guards.

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

function patchBackgroundGeolocationAndroidProguardDefault() {
  if (!existsSync(backgroundGeolocationAndroidGradlePath)) {
    console.log('[gradle] Skipping patch: @capacitor-community/background-geolocation Android build.gradle not found.');
    return;
  }

  const currentGradle = readFileSync(backgroundGeolocationAndroidGradlePath, 'utf8');
  if (!currentGradle.includes(legacyProguardConfig)) {
    console.log('[gradle] @capacitor-community/background-geolocation Android ProGuard config is already compatible.');
    return;
  }

  const patchedGradle = currentGradle.split(legacyProguardConfig).join(optimizedProguardConfig);
  writeFileSync(backgroundGeolocationAndroidGradlePath, patchedGradle, 'utf8');
  console.log('[gradle] Updated default ProGuard file for: @capacitor-community/background-geolocation');
}

function patchAndroidGradlePropertyAssignments(gradleFilePath, packageName) {
  if (!existsSync(gradleFilePath)) {
    console.log(`[gradle] Skipping Gradle 10 syntax patch: ${packageName} Android build.gradle not found.`);
    return;
  }

  let patchedGradle = readFileSync(gradleFilePath, 'utf8');
  let changed = false;

  for (const propertyName of gradle10PropertyAssignments) {
    const assignment = new RegExp(`^(\\s*)${propertyName}\\s*=`, 'm');
    if (assignment.test(patchedGradle)) {
      continue;
    }

    const deprecatedSpaceAssignment = new RegExp(
      `^(\\s*)${propertyName}\\s+(?![=])(.+)$`,
      'm',
    );
    if (!deprecatedSpaceAssignment.test(patchedGradle)) {
      throw new Error(
        `[gradle] ${packageName} Android build.gradle contains neither the expected deprecated ` +
          `'${propertyName} value' form nor the Gradle 10-compatible '${propertyName} = value' form. ` +
          'The plugin version likely changed; review this compatibility patch before building Android.',
      );
    }

    patchedGradle = patchedGradle.replace(
      deprecatedSpaceAssignment,
      `$1${propertyName} = $2`,
    );
    changed = true;
  }

  if (!changed) {
    console.log(`[gradle] ${packageName} Android property assignments are already Gradle 10-compatible.`);
    return;
  }

  writeFileSync(gradleFilePath, patchedGradle, 'utf8');
  console.log(`[gradle] Updated Android property assignment syntax for: ${packageName}`);
}

function patchCapacitorKotlinPluginForAgp9() {
  if (!existsSync(capacitorPackagesDir)) {
    console.log('[gradle] Skipping Kotlin patch: @capacitor directory not found.');
    return;
  }

  const bare = "apply plugin: 'kotlin-android'";
  const guardLine = "if (!project.extensions.findByName('kotlin')) {";

  const patchedPackages = [];

  const packageDirs = readdirSync(capacitorPackagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const packageName of packageDirs) {
    const gradleFilePath = path.join(capacitorPackagesDir, packageName, 'android', 'build.gradle');
    if (!existsSync(gradleFilePath)) {
      continue;
    }

    const content = readFileSync(gradleFilePath, 'utf8');
    if (!content.includes(bare)) {
      continue;
    }

    const lines = content.split('\n');
    let changed = false;
    const patchedLines = [];

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.trim() !== bare) {
        patchedLines.push(line);
        continue;
      }

      const prevTrim = (lines[i - 1] ?? '').trim();
      const nextTrim = (lines[i + 1] ?? '').trim();
      if (prevTrim === guardLine && nextTrim === '}') {
        patchedLines.push(line);
        continue;
      }

      const indent = line.match(/^\s*/)?.[0] ?? '';
      patchedLines.push(`${indent}${guardLine}`);
      patchedLines.push(`${indent}    ${bare}`);
      patchedLines.push(`${indent}}`);
      changed = true;
    }

    if (!changed) {
      continue;
    }

    const patched = patchedLines.join('\n');
    writeFileSync(gradleFilePath, patched, 'utf8');
    patchedPackages.push(`@capacitor/${packageName}`);
  }

  if (patchedPackages.length === 0) {
    console.log('[gradle] No @capacitor Kotlin plugin patches were needed (AGP 9 compat).');
    return;
  }

  console.log(`[gradle] Guarded kotlin-android plugin for AGP 9 in: ${patchedPackages.join(', ')}`);
}

// @capacitor-community/background-geolocation@1.x pins capacitor-swift-pm to
// `from: "7.0.0"` (i.e. >=7.0.0 <8.0.0). This app pins it to `exact: "8.4.0"`,
// so SwiftPM cannot resolve the graph and Xcode reports EVERY Capacitor product
// as "Missing package product". Widen the plugin's constraint to also accept the
// 8.x line. The plugin's Swift uses stable CAPPlugin APIs, so it builds against
// Capacitor 8.
function patchBackgroundGeolocationSwiftPackage() {
  if (!existsSync(backgroundGeolocationPackagePath)) {
    console.log('[bg-geo] Skipping patch: @capacitor-community/background-geolocation Package.swift not found.');
    return;
  }

  const current = readFileSync(backgroundGeolocationPackagePath, 'utf8');
  const widenedConstraint = '"7.0.0" ..< "9.0.0"';

  if (current.includes(widenedConstraint)) {
    console.log('[bg-geo] background-geolocation Package.swift already allows Capacitor 8.');
    return;
  }

  const pinnedConstraint = 'from: "7.0.0"';
  if (!current.includes(pinnedConstraint)) {
    // Fail loudly rather than warn-and-skip: the plugin is installed but its
    // capacitor-swift-pm constraint no longer matches what we widen. Skipping
    // would let `cap sync` / Xcode resolve SwiftPM and fail later with a
    // misleading "Missing package product" for EVERY Capacitor product. A bumped
    // plugin version (which changes this spelling) must be re-verified here.
    throw new Error(
      '[bg-geo] @capacitor-community/background-geolocation Package.swift no longer contains ' +
        `the expected '${pinnedConstraint}' capacitor-swift-pm constraint (and is not already ` +
        `widened to '${widenedConstraint}'). The plugin version likely changed; update ` +
        'scripts/patch-sentry-capacitor-package.mjs to match before building iOS.',
    );
  }

  const patched = current.replace(pinnedConstraint, widenedConstraint);
  writeFileSync(backgroundGeolocationPackagePath, patched, 'utf8');
  console.log('[bg-geo] Widened background-geolocation capacitor-swift-pm constraint to include Capacitor 8.');
}

patchSentrySwiftPackage();
patchBackgroundGeolocationSwiftPackage();
patchCapacitorAndroidProguardDefaults();
patchSentryCapacitorAndroidProguardDefault();
patchBackgroundGeolocationAndroidProguardDefault();
patchAndroidGradlePropertyAssignments(
  sentryCapacitorAndroidGradlePath,
  '@sentry/capacitor',
);
patchAndroidGradlePropertyAssignments(
  backgroundGeolocationAndroidGradlePath,
  '@capacitor-community/background-geolocation',
);
patchCapacitorKotlinPluginForAgp9();
