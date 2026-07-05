# App Permissions

This document lists all native permissions declared by the app, why each is
needed, and the privacy guarantees around their use.

## Location (iOS + Android)

### Declared permissions

**iOS** (`ios/App/App/Info.plist`):

- `NSLocationWhenInUseUsageDescription`
- `NSLocationAlwaysAndWhenInUseUsageDescription` (background track recording)
- `UIBackgroundModes` → `location` (lets recording continue with the app
  backgrounded / screen locked)

`location` is the only declared iOS background mode. The app does not schedule
background fetch or `BGProcessingTask` work, so declaring `fetch` or
`processing` would overstate its execution contract and must fail native
configuration verification.

**Android** (`android/app/src/main/AndroidManifest.xml`):

- `ACCESS_COARSE_LOCATION`
- `ACCESS_FINE_LOCATION`
- `POST_NOTIFICATIONS` (Android 13+, requested best-effort before recording
  starts for the persistent "recording" notification, via a local Android-only
  Capacitor plugin; recording still works if it is denied)
- `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_LOCATION` are contributed by the
  `@capacitor-community/background-geolocation` plugin's manifest via merge
  (used only by track recording).
- `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` — optional reliability nudge so OEM
  power managers don't kill the recording foreground service. Requested only on
  an explicit user tap from the recording screen's banner; recording works
  without it. iOS has no equivalent.

### Why

Location powers three field-work features:

1. The **"My Location"** toggle: start a foreground live-position watch, fly
   once on its first valid fix, and keep the shared map dot current until the
   user disables it (`@capacitor/geolocation`).
2. **GPS track recording** (the GPS menu): records the path the user walks. This
   runs in the **background / with the screen locked** so a surface route can be
   captured without keeping the app open, via
   `@capacitor-community/background-geolocation` (a foreground service +
   notification on Android; background location updates on iOS). See
   `docs/gps-tracks.md`.
3. **GPS point averaging** (the GPS menu): a foreground watch collects fixes
   over ~1-2 minutes to compute a single high-confidence point the user can save
   as a landmark (`@capacitor/geolocation`, foreground).

All three are essential for fieldwork -- cavers need to locate themselves and
capture survey-grade points/tracks relative to cave survey data.

### Privacy guarantees

- **User-initiated only.** Location is accessed only as a direct result of a
  user action: enabling "My Location", starting a recording, or starting the
  averaging collector. Watches are torn down the moment the user disables My
  Location, stops/pauses/cancels recording, stops/closes averaging, or logs out.
  The foreground My Location watch is also suspended while the Dashboard is
  hidden or the app is backgrounded, without clearing the user's enabled toggle.
  The recording screen's back button intentionally leaves recording running.
  There is no geofencing or location-based marketing.
- **Background use is recording-only and always visible.** Only **track
  recording** uses background location, and only while a recording is actually
  running. While it runs the user sees a persistent notification (Android) or a
  blue status bar (iOS), and recording ends as soon as they tap Stop/Cancel. "My
  Location" and averaging remain strictly foreground.
- **Stored only when the user records.** The "My Location" dot and phone heading
  are ephemeral React state. Recorded **GPS tracks** are, by design, persisted
  on-device in the `gps_tracks` IndexedDB store so a force-quit does not lose
  already captured points; they are wiped on logout. The averaging session's
  samples are ephemeral; only the averaged point the user explicitly saves
  becomes a landmark. iOS declares precise-location collection in
  `PrivacyInfo.xcprivacy` for app functionality, with no tracking.
- **Transmitted only on an explicit upload.** Location data leaves the device
  only when the user explicitly uploads a track to SpeleoDB
  (`PUT /api/v2/import/gpx/`) or saves an averaged point as a landmark (which
  syncs like any landmark). Sharing a GPX routes through the OS share sheet at
  the user's request. Nothing is sent to any third-party service automatically.
- **Not logged.** No location or heading data appears in console logs,
  analytics, crash reports, or any telemetry. Heading is never persisted or
  transmitted.

### Phone heading sensor

The shared location dot may show a phone-direction cone while My Location is
enabled or a track is actively recording. `@capgo/capacitor-compass` uses the
device sensors on Android and Core Location true heading on iOS. Android needs
no additional permission. iOS reuses the existing location authorization and
purpose text; no new purpose string is required. Unsupported/web sensors or
runtime failures degrade silently to a dot. The first/last-consumer service
stops native heading after the final live reason, and route/app suspension also
releases it. See `docs/user-location-heading.md`.

### User-facing purpose strings

- `NSLocationWhenInUseUsageDescription`:
  > SpeleoDB uses your location to center the map on your position, record GPS
  > tracks, and collect high-accuracy survey points during fieldwork.
- `NSLocationAlwaysAndWhenInUseUsageDescription`:
  > SpeleoDB records your GPS track while the app is in the background or your
  > screen is locked, so you can capture a surface route without keeping the app
  > open.

Android handles location via Capacitor / the plugin and the `POST_NOTIFICATIONS`
permission via a small **local, Android-only** Capacitor plugin
(`RecordingNotificationPermission`, in `android/app/src/main/java/.../`), so
nothing notification-related is linked into the iOS build. The
background-tracking notification text comes from `GPS.BACKGROUND_TRACKING_TITLE`
/ `BACKGROUND_TRACKING_MESSAGE` and the channel name from `strings.xml`.

### Error handling UX

When the "My Location" button fails, the app shows a modal
(`GeolocationErrorModal`) with a user-friendly title, description, and
platform-specific instructions. The modal maps `@capacitor/geolocation` plugin
error codes (`OS-PLUG-GLOC-*`) into five categories:

| Category                   | Plugin codes                   | Icon color | When it appears                                                                     |
| -------------------------- | ------------------------------ | ---------- | ----------------------------------------------------------------------------------- |
| Permission Denied          | `0003`, `0008`                 | Amber      | User denied the prompt or location is restricted (e.g. iOS parental controls)       |
| Location Services Disabled | `0007`, `0009`, `0016`, `0017` | Amber      | Device location toggle is off, or user declined the "enable location" system prompt |
| Timeout                    | `0010`                         | Blue       | GPS couldn't get a fix in time (indoors, poor signal)                               |
| Google Play Services       | `0014`, `0015`                 | Red        | Android only -- Play Services missing or outdated                                   |
| Position Unavailable       | `0002`, unknown                | Red        | Generic fallback for unexpected errors                                              |

Instructions vary by platform. For example, "Permission Denied" tells iOS users
to open Settings > Privacy > Location Services, while Android users are directed
to Settings > Apps > SpeleoDB > Permissions.

The modal is dismissed with a single "OK" button. No location data is logged or
transmitted on error.

**GPS track recording** errors are handled separately (recording uses the
background watcher, not the "My Location" path). An up-front permission denial
when starting a recording throws and shows a toast. A _fatal_ authorization
error _during_ a live recording -- the background plugin's `NOT_AUTHORIZED`
(permission revoked / "Always" denied / location services off) or the web
`GeolocationPositionError.code === 1` -- stops the recording, resets it to idle,
and shows a toast; any already-captured points are finalized into a saved track
so nothing is lost. A transient error (brief signal loss) is logged and
recording continues. See `docs/gps-tracks.md` ("Permissions").

## Internet (Android)

### Declared permission

- `android.permission.INTERNET`

### Why

Required for all network operations: API authentication, project sync, GeoJSON
downloads, map tile fetching.

## Source files

- iOS permissions: `ios/App/App/Info.plist`
- Android permissions: `android/app/src/main/AndroidManifest.xml`
- Geolocation usage: `src/pages/dashboard/useDashboardMapShell.ts` (foreground
  My Location), GPS track recording + averaging
  (`src/services/GeolocationWatcher.ts`,
  `src/services/BackgroundGeolocationWatcher.ts`,
  `src/hooks/useGpsAveraging.ts`, `src/controllers/SpeleoDBController.ts`); see
  `docs/dashboard-map-shell.md` and `docs/gps-tracks.md`
- Background tracking notification config: `capacitor.config.ts`
  (`android.useLegacyBridge`), `android/app/src/main/res/values/strings.xml`,
  `src/constants.ts` (`GPS.BACKGROUND_TRACKING_*`)
- Battery-optimization nudge (Android):
  `src/services/BatteryOptimizationGuard.ts`, recording-screen banner in
  `src/components/GpsRecordingScreen.tsx`, plugin
  `@capawesome-team/capacitor-android-battery-optimization`
- Geolocation error modal: `src/components/GeolocationErrorModal.tsx`
- Error code parsing: `src/utils/geolocationError.ts`
- Heading lifecycle/rendering: `src/services/DeviceHeadingService.ts`,
  `src/hooks/useDeviceHeading.ts`,
  `src/components/map/UserLocationIndicator.tsx`
- Capacitor plugins: `@capacitor/geolocation` (foreground),
  `@capacitor-community/background-geolocation` (background recording),
  `@capgo/capacitor-compass` (ephemeral phone direction)
