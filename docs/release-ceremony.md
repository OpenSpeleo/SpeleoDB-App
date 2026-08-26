# Trusted mobile release ceremony

## Purpose and authorization boundary

This ceremony separates a reproducible release candidate from the disposable
compile-smoke artifacts produced by `.github/workflows/ci.yml`. Disposable CI
signatures are compilation evidence only; they do not establish publisher
identity, entitlement validity, installation compatibility, or store acceptance.

This repository plan does not authorize publishing. No tag, GitHub release,
store upload, or rollout may occur while executing the July 2026 remediation
work. The steps below become executable only when a release owner receives
separate authorization to use protected signing systems and the independent
release approver accepts the complete evidence record.

## Roles and protected inputs

- The **release owner** prepares one clean, immutable candidate commit, runs the
  ceremony, and records evidence.
- The **signing custodian** grants time-bounded access to the protected secret
  store or performs signing on an approved protected runner. Signing keys,
  passwords, App Store Connect credentials, Google Play credentials, API keys,
  and provisioning profiles are never committed, copied into issue comments, or
  retained in ordinary CI artifacts.
- The **independent release approver** verifies identities, hashes, test
  results, store validation, and rollback readiness. The owner cannot
  self-approve.

Record the expected Android signing-certificate SHA-256 fingerprint and expected
Apple Team ID (`UDUF7J66TN` for the current project) from an independently
controlled release record before building. Do not derive the expected identity
from the artifact being verified.

## 1. Freeze and version the candidate

Start from a clean checkout of the approved source commit with no ignored build
output reused. Record `git rev-parse HEAD`, `git status --porcelain`, Node, npm,
Java, Gradle, Xcode, Cocoa/Swift package resolution, Capacitor, Android SDK, and
iOS SDK versions.

The native store version is authoritative; the npm package version is tooling
metadata and is not silently substituted for it. Update one dedicated release
commit so these values must match across Android and iOS:

| Platform | File                                    | Human version       | Monotonic build           |
| -------- | --------------------------------------- | ------------------- | ------------------------- |
| Android  | `android/app/build.gradle`              | `versionName`       | `versionCode`             |
| iOS      | `ios/App/App.xcodeproj/project.pbxproj` | `MARKETING_VERSION` | `CURRENT_PROJECT_VERSION` |

The current baseline is `1.3.0 (130)`. The human version follows the approved
release number; both integer build values increase beyond every build previously
submitted to either store. Never reuse an Android `versionCode` or iOS
`CURRENT_PROJECT_VERSION`, including after a rejected upload or rollback.

Before signing, run the complete web suite, production build, dependency audits,
Android/iOS unit and native configuration tests, physical-device protocols, and
`npx cap sync android && npx cap sync ios`. Inspect every tracked native diff
after sync. The candidate is frozen only when these gates are green, the
worktree is clean, and the exact commit is approved for signing.

## 2. Build with trusted identities

Use a fresh protected runner with command tracing/history disabled. Inject
secret values from the protected secret store into the process environment for
the single build, then destroy the runner/keychain and revoke leases after
evidence collection. Never print secret variables.

### Android

Build the AAB that will be submitted and an APK signed by the same protected key
for direct installation evidence. The current project accepts signing arguments
through Capacitor; an approved secret-injection wrapper supplies the values:

```bash
npx cap build android --androidreleasetype=AAB \
  --keystorepath="$ANDROID_RELEASE_KEYSTORE" \
  --keystorepass="$ANDROID_RELEASE_KEYSTORE_PASSWORD" \
  --keystorealias="$ANDROID_RELEASE_KEY_ALIAS" \
  --keystorealiaspass="$ANDROID_RELEASE_KEY_PASSWORD"

npx cap build android --androidreleasetype=APK \
  --keystorepath="$ANDROID_RELEASE_KEYSTORE" \
  --keystorepass="$ANDROID_RELEASE_KEYSTORE_PASSWORD" \
  --keystorealias="$ANDROID_RELEASE_KEY_ALIAS" \
  --keystorealiaspass="$ANDROID_RELEASE_KEY_PASSWORD"
```

On an isolated runner, brief command-line exposure is still sensitive; do not
use a shared host, shell tracing, or persisted process telemetry. Verify the APK
with `apksigner verify --verbose --print-certs <apk>` and compare its signer
SHA-256 to the independently recorded fingerprint. Verify the AAB with
`jarsigner -verify -verbose -certs <aab>` and record its signer chain. Reject
the candidate on any mismatch.

Retain `mapping.txt`, `seeds.txt`, `usage.txt`, native debug-symbol archives,
and dependency/license reports when produced. Android currently has
`minifyEnabled false`, so an absent R8 `mapping.txt` must be recorded as **not
generated**, not invented or silently omitted. If minification is enabled later,
`mapping.txt` becomes mandatory and must match the submitted AAB.

### iOS

Archive `org.speleodb.app` in Release configuration with the approved Apple
distribution identity, expected Apple Team ID, App Store provisioning profile,
and production entitlements. Export the IPA with the release organization's
reviewed export-options file using `xcodebuild -exportArchive`; do not reuse the
temporary identity or entitlement-stripped archive from CI.

Verify the exported application with
`codesign --verify --deep --strict <App.app>` and inspect
`codesign -d --verbose=4 <App.app>`. Decode `embedded.mobileprovision` with
`security cms -D -i <App.app/embedded.mobileprovision>` and verify team,
application identifier, expiration, distribution method, associated domains, and
entitlements against the approved record. Reject wildcard identifiers or
unexpected entitlements.

Retain the `.xcarchive`, exported IPA, export options, export/validation logs,
and every `.dSYM`. Use `dwarfdump --uuid` on the app binary and `.dSYM` and
record the matching UUIDs. Preserve any Sentry/debug-symbol upload receipt
without placing its authentication token in the evidence bundle.

## 3. Hash and bind every artifact

Place distributable artifacts, symbols/mappings, validation logs, and the
machine-readable evidence manifest in a write-protected candidate directory. The
manifest binds every artifact to the source commit, native versions, build
tools, signing fingerprints/team, entitlements, and test evidence URLs.

Generate `SHA256SUMS` only after the directory is final:

```bash
shasum -a 256 <artifact-and-symbol-paths...> > SHA256SUMS
shasum -a 256 -c SHA256SUMS
```

Have the independent approver verify `SHA256SUMS` on a second trusted machine.
Any rebuild creates a new candidate and invalidates all prior hashes, install
results, store validation, and approvals.

## 4. Installation and migration evidence

Use the exact hashed APK/IPA or store-processed derivative whose relationship is
recorded. Capture device model, OS, artifact hash/build, timestamp, result, and
logs/video for every case.

### Clean installation

- Uninstall SpeleoDB and remove prior app data/keychain state on at least one
  supported Android device and one iPhone.
- Install the candidate, log in, sync, exercise Map/GPS/Pending/Settings, create
  local durable state, sign out, and prove purge after relaunch.
- Confirm identifiers, version display, permissions, privacy prompts, deep
  links, background declarations, and crash/symbol reporting match the
  candidate.

### Upgrade installation

- Install the currently distributed store version, create representative cached
  projects, offline maps, a local GPS recording, preferences, and a pending
  operation, then terminate the app.
- Upgrade in place to the candidate without clearing data. Verify authentication
  restoration, IndexedDB/native migration, cached/offline usability, pending
  replay, GPS recovery, and subsequent logout purge.
- Repeat for Android and iOS. A clean install cannot substitute for upgrade
  installation evidence.

## 5. Store validation without publication

- In Google Play Console, upload the trusted AAB only to an authorized draft or
  internal-validation surface. Verify package, version code, signing
  certificate/ Play App Signing relationship, target SDK, merged permissions,
  Data Safety, foreground-service declarations, pre-launch report,
  symbol/mapping association, and upgrade compatibility. Do not promote or roll
  out.
- In Xcode Organizer, run **Validate App** on the trusted archive. Verify bundle
  identifier, version/build, distribution certificate/team, provisioning,
  entitlements, privacy manifest, associated domains, export compliance, and
  `.dSYM` availability. If authorized, upload only to a non-public internal
  TestFlight validation group and repeat clean/upgrade checks on the
  store-processed build. Do not submit for review or release.

Store processing may alter the distributed binary. Record store artifact/build
identifiers and receipts so installation evidence can be traced back to the
hashed submitted artifact.

## 6. Approval, rollout, and rollback

The release owner and independent release approver sign the evidence manifest.
Approval requires every automated matrix, physical protocol, clean/upgrade case,
identity check, symbol check, hash verification, and store validation to be
green with no unexplained generated diff or warning.

Before any separately authorized rollout, identify the last known-good store
version and server/API compatibility window. Use staged rollout with monitoring
owners and explicit stop thresholds for authentication, data loss, crash rate,
sync/replay, GPS persistence, and map readiness. If a threshold trips, stop the
staged rollout immediately. Mobile stores generally cannot downgrade installed
clients: rollback means halt distribution and prepare a forward-fix build with a
new, higher `versionCode` and `CURRENT_PROJECT_VERSION`. Never overwrite or
reuse the failed build identity.

Preserve the rejected/rolled-back artifact, hashes, symbols, store reports, and
incident decision. Resume only from a new immutable candidate that repeats the
entire ceremony and receives new independent approval.
