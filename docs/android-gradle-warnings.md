# Android Gradle warning ownership

## Intent

The Android release gate runs Gradle with `--warning-mode all` so a successful
build cannot hide a future compatibility break. Every warning must either be
fixed at a repository-owned seam or recorded here with its owner, effect, and
removal condition. This is an attribution ledger, not permission for a blanket
Gradle or dependency upgrade. Do not perform a blanket upgrade to clear these
warnings.

## August 2026 Gradle 10 readiness

Gradle 10 has not been released as of August 26, 2026. The supported migration
baseline is therefore Android Gradle Plugin (AGP) 9.3.2 with Gradle 9.5.0: AGP
9.3 declares Gradle 9.5.0 as both its minimum and default version. Gradle 9.5's
`--warning-mode all` output is the forward-compatibility gate until a Gradle 10
distribution and a supporting AGP release are available. Do not put an
unreleased Gradle distribution URL in the wrapper.

Capacitor 8's Filesystem and Geolocation plugins request a Java 21 Kotlin
toolchain. A build that happened to find a JDK previously downloaded into the
Gradle user home configured successfully on Gradle 9, but Gradle 9.5 reported
that using an auto-provisioned toolchain without a declared download repository
becomes an error in Gradle 10. `android/settings.gradle` now applies Gradle's
Foojay resolver convention settings plugin. This makes Java 21 provisioning an
explicit, reproducible build contract instead of relying on developer-machine
cache state. The resolver performs no download when a matching local toolchain
is available.

The VS Code Gradle Build Server must import the application through
`android/settings.gradle`. Capacitor plugin directories under `node_modules` are
modules of that build, not standalone Gradle roots. When VS Code probes those
directories independently, their own legacy wrappers run and references such as
`project(':capacitor-android')` fail because only the application settings file
declares that project. The workspace configuration therefore:

- limits `gradle.nestedProjects` to `android`; and
- excludes `node_modules` from Java project import discovery.

Errors reported while independently opening `node_modules/@capacitor/*/android`,
`@sentry/capacitor/android`, or other plugin Android directories do not
establish a failure of the application build. Reproduce any native failure from
`android/` with `./gradlew` before changing a plugin or dependency.

The owning primary references are Gradle's
[Java toolchain documentation](https://docs.gradle.org/9.5.0/userguide/toolchains.html#sub:download_repositories),
the Android Developers
[AGP/Gradle compatibility table](https://developer.android.com/build/releases/about-agp),
and the VS Code Gradle extension's
[project discovery contract](https://github.com/microsoft/vscode-gradle#project-discovery).

## July 2026 audit

The audited clean-build commands are:

```bash
npm ci
cd android
./gradlew testDebugUnitTest lint assembleDebug assembleRelease bundleRelease \
  assembleDebugAndroidTest --warning-mode all --console=plain
./gradlew :sentry-capacitor:compileReleaseJavaWithJavac \
  :capacitor-community-background-geolocation:compileReleaseJavaWithJavac \
  --rerun-tasks -I ../quality/gradle-deprecation.init.gradle \
  --warning-mode all --console=plain
```

The initial configuration run reported five warnings. A clean debug compile
exposed two additional compiler deprecations, and the complete Release matrix
exposed background-geolocation deprecations, a Filesystem nullability mismatch,
and Sentry native-library strip notices that up-to-date debug tasks do not emit:

| Count | Source                                                                                                                               | Owner                                                                                       | Resolution                                                                                                                        |
| ----: | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
|     2 | `node_modules/@capacitor-community/background-geolocation/android/build.gradle` (`namespace` and `abortOnError`)                     | Third-party plugin source, with an existing repository-owned postinstall compatibility seam | `scripts/patch-sentry-capacitor-package.mjs` now rewrites the deprecated Groovy space-assignment form to explicit `=` assignment. |
|     2 | `node_modules/@sentry/capacitor/android/build.gradle` (`namespace` and `abortOnError`)                                               | Third-party plugin source, with an existing repository-owned postinstall compatibility seam | The same deterministic postinstall patch rewrites both assignments.                                                               |
|     1 | `android/capacitor-cordova-android-plugins/build.gradle` (`flatDir`)                                                                 | Generated by Capacitor CLI for its Cordova compatibility project                            | Accepted temporarily and tracked below; do not hand-edit generated output.                                                        |
|     1 | `node_modules/@sentry/capacitor/android/src/main/java/io/sentry/capacitor/SentryCapacitor.java` (`PackageInfo.versionCode`)          | Third-party Sentry bridge                                                                   | Retained pending an upstream Android-API compatibility correction; `-Xlint:deprecation` identifies line 246 exactly.              |
|     1 | `node_modules/@capacitor/filesystem/android/src/main/kotlin/com/capacitorjs/plugins/filesystem/FilesystemPlugin.kt` (`downloadFile`) | Third-party Capacitor plugin                                                                | Retained pending upstream removal of its deprecated compatibility method; SpeleoDB uses `writeFile`, not `downloadFile`.          |
|    13 | `node_modules/@capacitor-community/background-geolocation/android/src/main/java/...`                                                 | Third-party background-geolocation plugin                                                   | Retained pending an upstream Android/Google Play Services API migration; exact APIs are listed below.                             |
|     1 | `node_modules/@capacitor/filesystem/android/src/main/kotlin/.../LegacyFilesystemImplementation.kt` (`String?` to `String`)           | Third-party Capacitor plugin                                                                | Retained in the plugin's unused legacy download path; exact line 66 is listed below.                                              |
|     2 | Sentry native libraries in app Release and Sentry instrumentation packaging                                                          | Third-party prebuilt Sentry native objects                                                  | Gradle packages the libraries unchanged; trusted symbol/archive validation remains a release-ceremony gate.                       |

After the compatible syntax patch, the full matrix completes with six attributed
third-party/generated warning categories:

```text
WARNING: Using flatDir should be avoided because it doesn't support any meta-data formats.
SentryCapacitor.java uses or overrides a deprecated API.
'fun downloadFile(call: PluginCall): Unit' is deprecated. Use @capacitor/file-transfer plugin instead.
BackgroundGeolocation.java uses or overrides a deprecated API.
LegacyFilesystemImplementation.kt: Java type mismatch: inferred type is 'String?', but 'String' was expected.
Unable to strip the following libraries, packaging them as they are: libsentry-android.so, libsentry.so.
BUILD SUCCESSFUL
```

The postinstall patch is intentionally fail-closed. If either plugin stops
containing the known deprecated form and does not contain the compatible form,
installation fails with a version-change diagnostic instead of silently applying
an unreviewed transformation. The owning quality test reads the installed plugin
scripts, so a clean `npm ci` proves the patch actually ran at the production
dependency seam.

## Remaining third-party/generated warnings

### `flatDir`

Capacitor 8.4.1 generates the Cordova compatibility project and its `flatDir`
repository during `cap sync`. This application currently has no JAR or AAR in
that project's `libs` or `src/main/libs` directories, so the declaration does
not resolve a shipped dependency. Removing it from the checked-in generated file
would be temporary: the next sync would restore it and create native drift.

Remove this exception only when one of these conditions is proven:

1. a reviewed Capacitor release stops generating `flatDir` and passes the full
   Android/native sync matrix; or
2. the repository owns a deterministic post-sync transformation that is covered
   by sync-idempotence and Android dependency-resolution tests.

Until then, any additional Gradle warning is a release failure and must be
attributed independently. Do not suppress warnings, add a global warning
allowlist, or upgrade Gradle/AGP/Capacitor solely to make this message
disappear.

### Sentry `PackageInfo.versionCode`

`@sentry/capacitor` reads the deprecated 32-bit `PackageInfo.versionCode` field
when reporting its native release. A focused Java compile with
`-Xlint:deprecation` proves this is the only Sentry Java deprecation currently
reported. Replacing it safely requires the plugin to preserve behavior below
Android API 28 while using `getLongVersionCode()` on newer devices. That is
third-party runtime logic, not a build-file syntax correction, so this release
does not rewrite or suppress it. Reassess when upgrading `@sentry/capacitor`.

### Capacitor Filesystem `downloadFile`

`@capacitor/filesystem` retains a deprecated `downloadFile` plugin method and
calls it from its permission callback for backward compatibility. SpeleoDB's
`GpxFileService` uses only `Filesystem.writeFile`; it does not invoke the legacy
download API. Removing or suppressing that plugin method locally would alter a
public third-party bridge for no application benefit. Reassess when Capacitor
removes the compatibility path or when the Filesystem dependency is reviewed.

The same unused legacy download implementation also passes nullable
`call.getString("url", "")` output to a Java method that expects a non-null
`String` (`LegacyFilesystemImplementation.kt:66`). Kotlin reports this as a Java
type mismatch, but the app does not invoke the legacy download method. It
remains owned by the same upstream migration; it is neither suppressed nor
patched.

### Background-geolocation Android APIs

`@capacitor-community/background-geolocation` produces 13 exact Java
deprecations when Release compilation is forced with `-Xlint:deprecation`:

- `Notification.Builder(Context)`, `Notification.PRIORITY_HIGH`, and
  `Notification.Builder.setPriority(int)`;
- `Settings.Secure.LOCATION_MODE`, `Location.isFromMockProvider()`, and
  `Intent.getParcelableExtra(String)`;
- the legacy `LocationRequest()` constructor plus `setMaxWaitTime`,
  `setInterval`, `LocationRequest.PRIORITY_HIGH_ACCURACY`, `setPriority`, and
  `setSmallestDisplacement`; and
- `Service.stopForeground(boolean)`.

These APIs span notification, mock-location, intent, location-request, and
foreground-service compatibility branches. Rewriting them locally would change
the native GPS lifecycle across supported Android API levels, so this P3 audit
does not apply an unreviewed plugin fork. The Android compile is green; the
physical background/lock/permission/battery matrix remains required before
distribution, and an upstream plugin update needs its own compatibility review.

### Sentry native-library stripping

Release APK/AAB and Sentry instrumentation packaging report that
`libsentry-android.so` and `libsentry.so` cannot be stripped and are packaged as
provided by the Sentry Android dependency. This is not a repository C/C++ build
or a signing result. The compile artifacts are disposable evidence only; the
trusted release ceremony must retain/validate the corresponding Sentry symbols
and inspect final publisher-signed artifact size and contents.

Gradle also prints `Note: Some input files use unchecked or unsafe operations`
for Capacitor core. This is a compiler note rather than a warning; it is
recorded here so future audits do not confuse it with an unclassified warning.
The `uses or overrides a deprecated API` summaries are expanded by the committed
`-Xlint:deprecation` init script above.

## Verification and performance

- `quality/gradle-deprecation-audit.test.ts` enforces Gradle-10-compatible
  property assignment in both installed plugins, the settings-level Java
  toolchain resolver, and the single-root VS Code discovery configuration. It
  also requires this ledger to attribute every accepted warning. It
  intentionally does not read ignored Capacitor-generated output: a clean
  unit-test checkout has not run `cap sync` yet.
- The Android unit, lint, Debug/Release APK, Release AAB, and instrumentation
  compilation tasks run after `npx cap sync android` with all warnings shown;
  that native gate owns verification of the generated Cordova `flatDir` warning.
- `quality/gradle-deprecation.init.gradle` expands Java deprecation summaries
  into exact source/API diagnostics without changing normal production builds.
- A clean dependency install/non-cached build is required when refreshing this
  ledger because Gradle does not re-emit compiler warnings for up-to-date tasks.
- `npx cap sync android` must leave no unexplained tracked native diff.
- Dependency upgrades require their own compatibility review and full native
  matrix.

The dependency patch runs once during installation and performs two small file
rewrites. The settings plugin adds configuration-only work and reaches the
toolchain resolver only when Java 21 is unavailable locally. Neither change adds
application code, startup work, persistent storage, or runtime performance cost
on Android or iOS.
