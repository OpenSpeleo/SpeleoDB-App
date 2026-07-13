# Release device and E2E evidence

## Intent and architecture

The release E2E gate drives the packaged Capacitor application through the same
Maestro flows on Android and iOS. It uses a dedicated staging OAuth token and a
writable test project supplied only at workflow runtime. Credentials are never
checked into a flow, application bundle, report artifact, screenshot, or log
statement. The workflow is manual-only, read-only at the GitHub permission
boundary, serialized per branch and within each platform matrix, and never
publishes an application artifact.

The automated path proves fresh token login, cached-session relaunch, basic Map
and GPS navigation, a durable offline landmark across process death, explicit
Pending replay, cleanup of the replayed server fixture, zero-pending sign-out,
pending-operation loss acknowledgement, destructive purge, and signed-out
relaunch. Test entities use a unique `RR-E2E-*` name. A successful replay is
immediately deleted online; the separate logout fixture never reaches the
server. A failed cleanup is a release failure and the unique name identifies the
fixture for manual removal.

Android runs API 24, 33, and 36 sequentially against one dedicated account. iOS
runs the latest simulator available on the hosted runner and requires an
explicitly selected runner with the app's iOS 15.0 runtime for the minimum lane;
absence of that runtime is a failed gate, not permission to substitute a newer
simulator. Every workflow summary records the selected iOS device, runtime,
UDID, and result.

## Running the automated gate

Configure repository secrets `SPELEODB_E2E_OAUTH_TOKEN` and
`SPELEODB_E2E_INSTANCE_URL`, plus repository variable
`SPELEODB_E2E_PROJECT_NAME`. The account must be dedicated to release testing,
have a personal writable landmark collection, and be able to read the named
project. Dispatch `.github/workflows/release-e2e.yml` with a minimum-iOS runner
label that has iOS 15.0 installed.

The runner validates that the instance is a credential-free HTTPS origin. The
OAuth token is passed to Maestro with runtime environment arguments and is
masked by GitHub. JUnit files are kept only in an ephemeral temporary directory
and deleted on exit because UI automation reports can echo typed input. The APK
uploaded between build and emulator jobs contains no E2E configuration and is
retained for one day only as intra-workflow compilation input.

The pinned Maestro 2.4.0 archive is SHA-256 verified. Every GitHub Action,
including the Android emulator runner, is pinned to an immutable commit. Network
loss uses emulator airplane mode on Android and temporary host routes for the
iOS simulator; an exit trap restores connectivity on success or failure.
Reconnect and replay remain separate user actions in the flow.

## Physical-device protocols

A compile, emulator, or simulator result is not physical-device evidence.
Complete the following on at least one supported Android device and one iPhone,
and retain the evidence with the release record. Record each case using:

| Device model | OS version | Build identifier | Result            | Evidence                                             |
| ------------ | ---------- | ---------------- | ----------------- | ---------------------------------------------------- |
| _required_   | _required_ | _required_       | Pass/Fail/Blocked | video, logs, screenshots, timing file, or issue link |

### Background and lock-screen GPS delivery

Start a recording, capture two points, background and lock the device for at
least ten minutes, then return and save. Verify points and active duration
advanced, Android kept the foreground service, iOS showed its location
indicator, and the durable track survives a force-quit relaunch.

### Heading orientation and compass cone

With My Location and then active recording, rotate the physical device through
cardinal headings in portrait and supported landscape orientations. Verify the
cone follows device direction, remains anchored to the dot, does not rotate with
the map bearing, and disappears when the final heading consumer stops.

### Android notification denial

On Android 13+, deny notification permission while granting location. Verify
recording starts and accepts points, the notification may be hidden, pause/
resume/save remain usable, and no false permission error or zero-point stuck
state appears.

### Storage pressure and offline-map replacement

Fill the device near its practical storage limit, retain an existing offline
map, and request replacement. Verify a failed replacement keeps the old
generation readable after relaunch, exposes the error, and leaves no partially
published generation. Repeat once with sufficient storage and prove atomic
replacement.

### WebView rendering and cached-map p95

Exercise every bottom tab, both sign-out modal variants, the Pending page, Map
layer controls, and GPS screens on release WebViews. Confirm solid button fills,
MapLibre source/layer rendering, safe areas, and no invisible controls. Record
cold and cached map-ready timings for at least 20 representative launches and
retain the raw samples plus calculated p50/p95.

## Release decision

For each automated lane, retain the workflow URL, commit SHA, exact matrix
value, result, and timestamp. For physical runs, retain the completed table and
evidence links. Missing Android API 24/33/36, latest iOS, true iOS 15.0, or
either physical-platform protocol set blocks release approval. Compilation, a
newer simulator substituted for iOS 15.0, or an undocumented manual statement
does not satisfy the gate.
