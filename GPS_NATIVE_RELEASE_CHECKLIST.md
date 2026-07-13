# GPS Native Release Checklist

Manual checklist for the GPS menu before shipping to Android and iPhone users.
This focuses on device behavior that automated web tests cannot prove, plus the
store declarations needed for background GPS recording, GPX sharing, and upload.

## Evidence Boundary

Run the repository's lint, typecheck, covered web suite, production build, and
documentation-contract tests before starting this checklist. Automated tests own
deterministic failure paths such as rejected IndexedDB writes, serialized
recorder commands, notification-denial admission, explicit queue replay, and
logout cancellation. This checklist owns behavior only a packaged native runtime
or physical device can prove: permission sheets, visible/hidden OS indicators,
background and lock-screen delivery, OEM battery policy, share sheets, and store
declarations. Record the device model, OS version, build identifier, and outcome
for each executed device case; an unchecked case remains an external release
gate.

## Android Device Testing

Test on at least:

- Android 13+ device or emulator, because `POST_NOTIFICATIONS` is runtime-gated.
- One real device with aggressive battery management if available (Samsung,
  Xiaomi, Huawei, Pixel with battery saver enabled).
- Fresh install and upgrade install from a build without GPS tracks, to verify
  IndexedDB migration and native permission prompts.

## Native Build Prep

1. Run `npm ci` with lifecycle scripts enabled.
2. Confirm the postinstall patch logs that the background-geolocation SwiftPM
   constraint either already allows Capacitor 8 or was widened for Capacitor 8.
3. Run `npx cap sync android && npx cap sync ios`.
4. Re-open native projects only after the sync completes; opening Xcode before
   the node_modules SwiftPM patch runs can show misleading "Missing package
   product" errors for every Capacitor product.

### Install And Startup

1. Install a clean build.
2. Log in, sync a project, and open the Dashboard.
3. Confirm the GPS tab appears left of Map.
4. Tap every bottom tab while a GPS full-screen view is open.
5. Expected: the full-screen GPS view closes and the tapped tab is usable; the
   tab bar is never trapped behind an overlay.

### GPS Track Recording

1. Open GPS -> GPS Track Recording.
2. Tap Start recording.
3. Grant location permission.
4. On Android 13+, grant notification permission.
5. Expected:
   - Recording starts.
   - A persistent foreground-service notification appears.
   - First real fix is recorded quickly; it should not wait 15-20 seconds before
     the first point unless GPS itself has no fix.
   - The GPS tab shows the recording dot.

### Notification Permission Denial

1. Fresh install or reset app permissions.
2. Start GPS Track Recording.
3. Grant location permission but deny notification permission.
4. Expected:
   - Recording starts and continues to accept points.
   - The foreground-service notification may be hidden while permission is
     denied.
   - Pause, Resume, and Stop & Save remain usable.

Notification permission is best-effort on Android 13+. Location authorization
remains the recording gate; notification denial is not presented as a recording
failure.

### Background And Screen-Lock Recording

1. Start recording and wait for at least 2 points.
2. Lock the screen for at least 10 minutes.
3. Unlock and return to the app.
4. Expected:
   - Foreground notification stayed visible.
   - More points were recorded while locked.
   - Duration continued from the original Start time.
   - Stop & Save persists a normal local track.

### Pause, Resume, Cancel, Stop

1. Start recording and collect at least 1 point.
2. Tap Pause.
3. Expected: GPS tab still shows an active/paused recording indicator.
4. Wait 30 seconds, then tap Resume.
5. Expected: stale replayed OS fixes are not added as a jump; the next real fix
   is accepted according to the 15 second cadence.
6. Expected: the displayed duration excludes the paused 30 seconds.
7. Tap the back arrow.
8. Expected: screen closes but recording continues.
9. Re-open recorder and tap Cancel.
10. Confirm discard.
11. Expected: recording stops and no saved track remains.
12. Repeat and tap Stop & Save.
13. Expected: recording stops and a saved track appears in the GPS panel.

### Battery Optimization Banner

1. Start recording on Android with battery optimization still active.
2. Expected: a dismissible banner appears.
3. Tap Allow.
4. Expected: Android exemption/settings flow opens.
5. Return to the app.
6. Expected: if exemption is granted, banner disappears.
7. Repeat and tap Not now.
8. Expected: banner stays dismissed for the current session; recording still
   works without the exemption.

### Offline Upload Replay

1. Turn on airplane mode or otherwise block network.
2. Record and save a track.
3. Tap Upload.
4. Expected: track becomes Pending upload, not Error.
5. Restore network.
6. Use Settings -> Go Online or Pending -> Try Reconnect, or relaunch the app
   and let startup validation succeed.
7. Expected: the offline lock clears and server data refreshes. Reconnect alone
   must not replay or remove the pending operation.
8. Open Pending and tap Sync for the row or Sync Now.
9. Expected: the upload completes and the pending row disappears only after the
   confirmed server result and local cache transaction complete.
10. Confirm untouched Local tracks do not upload until the user taps Upload.

### GPX Share

1. Save a track with at least 2 points.
2. Tap Share GPX.
3. Expected: Android share sheet opens with a `.gpx` file.

### Force Quit Recovery

1. Start recording and wait for at least 2 points.
2. Force kill the app from the app switcher.
3. Re-open the app.
4. Expected:
   - Recording is no longer active.
   - Captured points appear as a recovered local track.
   - No 0-point track appears.
   - User must start a new recording to continue.

### Pending Operations And Sign-out

1. Queue one offline GPS upload and note the Pending badge count.
2. Open Settings and start sign-out.
3. Expected: the modal names the exact pending-operation count, states that the
   operations are permanently deleted and unrecoverable, and disables Wipe local
   data & Sign Out until the acknowledgement is checked.
4. Cancel, reopen, and confirm the acknowledgement is reset.
5. Acknowledge and sign out.
6. Expected: authentication, cached projects/GeoJSON, pending operations, and
   local/cached GPS records are absent after relaunch.

The acknowledgement is voluntary-sign-out UX only. A credential-invalidating
`401`/`403` uses forced non-interactive logout so revoked credentials and local
user data cannot remain merely because no confirmation UI is available.

## iPhone Device Testing

Test on at least:

- One recent iPhone on the minimum supported iOS version.
- One iPhone on the latest iOS version.
- Fresh install and upgrade install.

### Permission Flow

1. Open GPS -> GPS Track Recording.
2. Start recording.
3. Grant When In Use when prompted.
4. If iOS asks for Always/background location, grant Always.
5. Expected:
   - Recording starts only when the platform allows background tracking.
   - User-facing permission text matches `Info.plist`.

### Denied Or Limited Location Permission

1. Reset location permission for the app.
2. Start recording and deny location permission.
3. Expected:
   - Recording does not start.
   - Error toast is visible.
   - App is not stuck in Recording state.
4. Repeat with Settings -> Location -> While Using only, then lock/background
   the app.
5. Expected:
   - If background delivery is not allowed, the app stops or surfaces a clear
     error rather than silently sitting at 0 points.

### Background And Screen-Lock Recording

1. Start recording and collect at least 2 points.
2. Press the side button to lock the phone for at least 10 minutes.
3. Unlock and return to SpeleoDB.
4. Expected:
   - iOS background location indicator appears while tracking.
   - Points continue to be recorded.
   - Stop & Save persists the track.

### GPS Averaging

1. Open GPS -> High-Accuracy GPS Point.
2. Confirm it opens in held/idle state and GPS does not auto-start.
3. Tap Start.
4. Wait for samples.
5. Tap Stop.
6. Wait 30 seconds.
7. Expected: elapsed/progress remain frozen while stopped.
8. Tap Start again.
9. Expected: sample set continues; stale replayed fixes are not counted.
10. Tap Reset and confirm.
11. Expected: samples clear.
12. Save a point.
13. Expected: shared landmark create form opens and can save online or offline.

### GPX Share

1. Save a track.
2. Tap Share GPX.
3. Expected: iOS share sheet opens with a `.gpx` file.

### Force Quit Recovery

1. Start recording and collect at least 2 points.
2. Force quit SpeleoDB from the app switcher.
3. Re-open the app.
4. Expected:
   - Recording is idle.
   - Partial captured track is visible as a local track.
   - Recording does not auto-resume.

## Apple App Store Declarations

### Xcode Project / App Bundle

Already required in native config:

- `NSLocationWhenInUseUsageDescription`
- `NSLocationAlwaysAndWhenInUseUsageDescription`
- `UIBackgroundModes` containing `location`
- `PrivacyInfo.xcprivacy` declaring precise location collection for app
  functionality and no tracking.

Before submitting:

1. Open `ios/App/App.xcworkspace` in Xcode.
2. Confirm `Info.plist` contains the two location purpose strings.
3. Confirm Background Modes includes Location updates.
4. Confirm `PrivacyInfo.xcprivacy` validates with no empty reason arrays.
5. Archive the app and run Xcode validation.

### App Store Connect: App Privacy

In App Store Connect -> App Privacy:

1. Add Data Type: Location -> Precise Location.
2. Purpose: App Functionality.
3. Data linked to user: Yes, because saved/uploaded tracks and landmarks can be
   associated with the logged-in SpeleoDB account.
4. Used for tracking: No.
5. Third-party advertising/tracking: No.
6. Explain in review notes:
   - Location is user-initiated only.
   - Background location is used only while the user is actively recording a GPS
     track.
   - A visible iOS location indicator is shown by the OS.
   - Tracks remain local until the user uploads or shares GPX.
   - Data is cleared on logout.

### App Review Notes

Include a short note:

> SpeleoDB is a cave-survey field app. The GPS tab lets users record a
> user-initiated surface walking track while the app is backgrounded or the
> screen is locked, then export/upload it as GPX. Background location is active
> only during an explicit recording session and stops when the user taps Stop or
> Cancel. The app also offers a foreground high-accuracy point averaging tool
> for saving a landmark.

## Google Play Store Declarations

### Android Manifest / Runtime Permissions

Declared or plugin-merged permissions to verify in the final merged manifest:

- `android.permission.ACCESS_COARSE_LOCATION`
- `android.permission.ACCESS_FINE_LOCATION`
- `android.permission.POST_NOTIFICATIONS`
- `android.permission.FOREGROUND_SERVICE`
- `android.permission.FOREGROUND_SERVICE_LOCATION`
- `android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`

Current implementation does not declare `ACCESS_BACKGROUND_LOCATION`. If future
device testing proves true background-location permission is required, add it
deliberately and complete the Play background-location declaration. Do not add
it casually; it increases Play review scrutiny.

### Google Play Console: Data Safety

In Play Console -> App content -> Data safety:

1. Data collected: Location.
2. Location type: Precise location.
3. Purpose: App functionality.
4. Collection required: yes for GPS recording/averaging features, but only when
   the user starts them.
5. Shared: yes only when the user uploads to SpeleoDB or shares GPX via Android
   share sheet. Explain that there is no automatic third-party transfer.
6. Processed ephemerally: no for recorded tracks, because tracks are persisted
   locally until deleted/logout; averaging samples are ephemeral unless saved as
   a landmark.
7. Data encrypted in transit: yes for SpeleoDB HTTPS uploads.
8. User can request deletion: yes through account/project data handling and
   local logout clearing on device.

### Google Play Console: Foreground Service Declaration

If prompted for Android foreground service permissions:

1. Declare foreground service type: Location.
2. User-visible purpose: user-initiated GPS track recording for field surveying.
3. Explain:
   - The user taps Start recording.
   - A persistent notification is shown.
   - Recording continues while the screen is locked/backgrounded.
   - The user stops it with Stop & Save or Cancel.
   - The app does not track location passively.

### Google Play Console: Background Location Declaration

Only complete this if the app declares `ACCESS_BACKGROUND_LOCATION` in the final
merged manifest.

If required:

1. Go to App content -> Sensitive permissions and APIs -> Location permissions.
2. Select background location.
3. Provide video showing:
   - User starts recording.
   - Persistent notification appears.
   - App is backgrounded/locked.
   - Track continues recording.
   - User returns and stops recording.
4. Justification:
   - Core fieldwork feature.
   - User initiated.
   - Visible notification.
   - No passive tracking, ads, or marketing.

### Google Play Console: Battery Optimization Permission

`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` is policy-sensitive.

1. In Play Console, disclose restricted permission/API use if prompted.
2. Explain it is optional and user-initiated:
   - Banner appears only after the user starts recording.
   - User may choose Allow or Not now.
   - Recording still works without the exemption, but long recordings are more
     reliable on aggressive OEM power managers.
3. If Play review rejects the direct exemption request, switch
   `BatteryOptimizationGuard.requestExemption()`
   (`src/services/BatteryOptimizationGuard.ts`) from
   `requestIgnoreBatteryOptimization()` to the plugin's
   `openBatteryOptimizationSettings()` (opens the settings screen without the
   restricted direct grant). The manifest `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`
   permission can then be removed.

### Play Review Notes

Include:

> SpeleoDB records GPS only after the user explicitly starts GPS Track
> Recording. Android shows a persistent foreground-service notification while
> recording. The feature is for cave-survey fieldwork: recording a surface
> walking route to overlay on cave survey data. Location is not used for
> advertising, analytics, geofencing, or passive tracking.

## Release Gate

Do not submit native builds until:

- All Android tests above pass on a real device.
- All iPhone tests above pass on a real device.
- Xcode archive validation passes.
- Google Play merged manifest is reviewed.
- Store privacy declarations match the final permissions and runtime behavior.
