# Settings Page

The Settings page provides account actions, synchronization controls, and map preferences. It is always mounted alongside the Dashboard (both stay in the DOM) so map state is preserved across tab switches.

## Navigation

Reached via the **Settings** tab in the bottom tab bar (`AppTabBar`). The tab bar is visible on both Dashboard and Settings.

## Sections

### Synchronization

Displays live sync statistics and a manual sync trigger.

| Row | Value source | Update frequency |
|---|---|---|
| Last sync | `lastSyncedAt` from `useSpeleoDB()`, formatted via `formatLastSync()` (device-locale absolute date + time, or `Never`) | Reactive (controller notify after every successful sync) |
| Synced projects | `projects` from `useSpeleoDB()`, filtered to those with GeoJSON | Reactive (context update) |
| Cache size | `getTotalCacheBytes()` from `TileCacheRepository` | Polled every 3 s while on `/settings` |
| Sync progress | Computed from `tilePrefetchJobs` + manual tile count | Reactive + polled |
| Tiles synced | Same as sync progress, formatted as `processed / total` | Reactive + polled |

The **Sync button** (circular arrow icon in the section header) calls `controller.syncProjects()`. It does not attempt offline reconnect (`retryConnection()`). Errors from `syncProjects()` are caught and swallowed; cache stats are refreshed afterward regardless.

While `syncStatus === 'syncing'`, the sync button widens to display an inline spinner plus a `Syncing…` label (`data-testid="sync-status-label"`). The button is also disabled in this state to prevent double-submission.

`Last sync` is set by `SpeleoDBController.syncProjects()` only after the projects payload is successfully fetched and persisted. Timeouts, transport errors, and non-2xx responses do **not** advance the timestamp. The value is persisted via `PreferencesService.setPreferences({ lastSyncedAt })` and restored on the next app launch via `restoreSession()`. It resets to `null` on logout.

Manual tile count and cache byte totals are read from IndexedDB via cursor-based iteration to avoid loading the full metadata store into memory.

### Map Settings

- **Show landmarks** toggle: controls visibility of landmark marker and label layers on the map. Persisted in `UserPreferences.showLandmarks` via `PreferencesService`. Default: `true`. Changes propagate to Dashboard in real time via a shared React state in `App.tsx`.
- **Color mode** selector: `By Project` / `By Depth`. `By Project` uses the standard project color palette; `By Depth` enables depth-based coloring and the dashboard depth gauge. Persisted in `UserPreferences.colorMode` via `PreferencesService`. Default: `project`. Changes propagate to Dashboard in real time via shared React state in `App.tsx`.
- **Map unit** selector: `Meters` / `Feet`. Controls display units for both distance scale and depth gauge values. Base values remain feet-based internally and are converted for display when metric mode is active. Persisted in `UserPreferences.measurementUnit` via `PreferencesService`. Default: `meters`. Changes propagate to Dashboard in real time via shared React state in `App.tsx`.

### Tutorial

- **Show Tutorial** button: closes the project panel (if open), navigates to `/dashboard`, and restarts the guided tour from step 1 via `restartGuidedTourFromHelp()`. Ignores `hasCompletedGuidedTour`.

### Account

- **Sign Out** button: opens a confirmation modal. On confirm, calls `controller.logout()`, dismisses the modal, and navigates to `/login`. The button is disabled while logout is in progress to prevent double-submission.

## State ownership

- Sync stats (`cacheBytes`, `manualTileCount`): local state, polled via `useEffect`.
- Sync metrics (`syncTotalTiles`, `syncProcessedTiles`, `syncPct`): derived via `useMemo` from `tilePrefetchJobs` + `manualTileCount`.
- `lastSyncedAt`: owned by `SpeleoDBController`, persisted via `PreferencesService`, exposed through `useSpeleoDB()`. UI is read-only.
- `showLandmarks`: shared state owned by `AppRoutes` in `App.tsx`, passed via props.
- `colorMode`: shared state owned by `AppRoutes` in `App.tsx`, passed via props.
- `measurementUnit`: shared state owned by `AppRoutes` in `App.tsx`, passed via props.
- `isProjectPanelOpen`: shared state owned by `AppRoutes` in `App.tsx`, passed via props.
- Logout modal: local state (`showLogoutConfirmModal`, `isLoggingOut`).

## Polling lifecycle

The 3-second polling interval for cache stats activates only when `location.pathname === '/settings'`. When the user navigates away, the effect cleans up and the interval stops. The effect re-activates on navigation back.

## Offline behavior

- The sync button calls `syncProjects()` which respects the controller's offline lock. When offline-locked, the sync is effectively a no-op (cached data is already present).
- The Settings page does not attempt `retryConnection()`. Reconnect is limited to app relaunch per the networking contract.

## Source code

- Page component: `src/pages/Settings.tsx`
- Tab bar: `src/components/AppTabBar.tsx`
- Tile cache queries: `src/services/tileCache/TileCacheRepository.ts`
- Landmark persistence: `src/services/PreferencesService.ts`
- Color mode persistence: `src/services/PreferencesService.ts`
- Measurement unit persistence: `src/services/PreferencesService.ts`
- Last sync timestamp: tracked in `SpeleoDBController._lastSyncedAt`, persisted via `PreferencesService.setPreferences({ lastSyncedAt })`, formatted by `src/utils/formatLastSync.ts`.
- Tour re-trigger: `src/onboarding/guidedTour/engine.ts`
- Tests: `src/pages/Settings.test.tsx`, `src/utils/formatLastSync.test.ts`

## Change checklist

1. Keep sync metric computation inside `useMemo`.
2. Verify the polling interval stops when navigating away from `/settings`.
3. Verify the logout guard prevents double-submission.
4. Verify landmark toggle propagates to Dashboard map layers in real time.
5. Verify color mode selector propagates to Dashboard map rendering in real time.
6. Verify map unit selector changes depth gauge + distance scale labels on Dashboard.
7. Verify `Last sync` updates after a successful sync and shows `Never` after logout.
8. Verify the `Syncing…` label appears on the sync button while `syncStatus === 'syncing'`.
9. Run `npx vitest run src/pages/Settings.test.tsx`.
10. Update this document if sections, state ownership, or offline behavior changes.
