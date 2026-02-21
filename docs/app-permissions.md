# App Permissions

This document lists all native permissions declared by the app, why each is needed, and the privacy guarantees around their use.

## Location (iOS + Android)

### Declared permissions

**iOS** (`ios/App/App/Info.plist`):
- `NSLocationWhenInUseUsageDescription`
- `NSLocationAlwaysAndWhenInUseUsageDescription`

**Android** (`android/app/src/main/AndroidManifest.xml`):
- `ACCESS_COARSE_LOCATION`
- `ACCESS_FINE_LOCATION`

### Why

The "My Location" button on the map uses `@capacitor/geolocation` to get the user's current position and fly the map to that location. This is essential for fieldwork -- cavers need to locate themselves relative to cave survey data.

### Privacy guarantees

- **On-demand only.** Location is accessed exclusively when the user taps the "My Location" button. There is no background location tracking, no continuous GPS polling, no geofencing, and no location-based notifications.
- **Minimal permission level.** The code explicitly requests only `'location'` (foreground/when-in-use) via `Geolocation.requestPermissions({ permissions: ['location'] })`. The app never requests "always" or background location authorization.
- **Not stored.** The coordinates are held in ephemeral React state (`userLocation`) to render a temporary blue dot on the map. The state resets when the user navigates away. No location data is written to localStorage, IndexedDB, or any persistent store.
- **Not transmitted.** Location coordinates are never sent to the SpeleoDB backend or any third-party service. They stay entirely on-device.
- **Not logged.** No location data appears in console logs, analytics, crash reports, or any telemetry.
- **No "always" access used.** The `NSLocationAlwaysAndWhenInUseUsageDescription` key is declared in Info.plist solely because the Capacitor geolocation plugin binary references the CoreLocation API at link time. The app never calls `requestAlwaysAuthorization()` and iOS will only ever show the "while using the app" prompt. The `NSLocationAlwaysUsageDescription` key (which would enable legacy "always" access) is intentionally absent.

### User-facing purpose strings

Both iOS keys use the same string:

> SpeleoDB uses your location to center the map on your current position during fieldwork.

Android handles location permission via a runtime dialog managed by Capacitor. No custom string is needed in the manifest.

### Error handling UX

When the "My Location" button fails, the app shows a modal (`GeolocationErrorModal`) with a user-friendly title, description, and platform-specific instructions. The modal maps `@capacitor/geolocation` plugin error codes (`OS-PLUG-GLOC-*`) into five categories:

| Category | Plugin codes | Icon color | When it appears |
|---|---|---|---|
| Permission Denied | `0003`, `0008` | Amber | User denied the prompt or location is restricted (e.g. iOS parental controls) |
| Location Services Disabled | `0007`, `0009`, `0016`, `0017` | Amber | Device location toggle is off, or user declined the "enable location" system prompt |
| Timeout | `0010` | Blue | GPS couldn't get a fix in time (indoors, poor signal) |
| Google Play Services | `0014`, `0015` | Red | Android only -- Play Services missing or outdated |
| Position Unavailable | `0002`, unknown | Red | Generic fallback for unexpected errors |

Instructions vary by platform. For example, "Permission Denied" tells iOS users to open Settings > Privacy > Location Services, while Android users are directed to Settings > Apps > SpeleoDB > Permissions.

The modal is dismissed with a single "OK" button. No location data is logged or transmitted on error.

## Internet (Android)

### Declared permission

- `android.permission.INTERNET`

### Why

Required for all network operations: API authentication, project sync, GeoJSON downloads, map tile fetching.

## Source files

- iOS permissions: `ios/App/App/Info.plist`
- Android permissions: `android/app/src/main/AndroidManifest.xml`
- Geolocation usage: `src/pages/Dashboard.tsx` (`handleGoToMyLocation`)
- Geolocation error modal: `src/components/GeolocationErrorModal.tsx`
- Error code parsing: `src/utils/geolocationError.ts`
- Capacitor plugin: `@capacitor/geolocation`
