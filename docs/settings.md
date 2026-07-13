# Settings Page

The Settings page provides account actions, synchronization controls, and map
preferences. It mounts only while `/settings` is active. The authenticated shell
keeps Dashboard mounted separately so map state survives tab switches without
retaining Settings effects, dialogs, or polling on other routes.

## Navigation

Reached via the **Settings** tab in the bottom tab bar (`AppTabBar`). The tab
bar is visible on both Dashboard and Settings.

## Sections

Every row uses a consistent, roomy vertical rhythm. The `IonContent` carries a
`settings-content` class and `src/index.css` sets `--min-height` on
`.settings-content ion-item` with the top/bottom paddings zeroed, so all rows
across all sections share the same spacing without per-item overrides. The
vertical slack comes solely from `--min-height`, so Ionic's native center
alignment (`:host { align-items: center }`) distributes it evenly above/below
the content — rows are never top-heavy. Custom top/bottom paddings are
deliberately `0`: when the content is taller than the padded box they push it
down and look top-heavy.

### Synchronization

Displays live sync statistics and a manual sync trigger.

| Row             | Value source                                                                                                           | Update frequency                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Last sync       | `lastSyncedAt` from `useSpeleoDB()`, formatted via `formatLastSync()` (device-locale absolute date + time, or `Never`) | Reactive (controller notify after every successful project-list refresh) |
| Synced projects | `projects` from `useSpeleoDB()`, filtered to those with GeoJSON                                                        | Reactive (context update)                                                |
| Cache size      | `OfflineMapSyncSnapshot.cacheBytes`                                                                                    | Event-driven after durable writes                                        |
| Sync progress   | Current operation completion from the offline-map store                                                                | Paint cadence                                                            |
| Tiles synced    | `completed / (canonical coordinate count × enabled layer count)`                                                       | Paint cadence                                                            |
| Download speed  | Tiles/second plus a compact ETA (`h`, `m`, or `s`)                                                                     | Paint cadence                                                            |

The **Resync button** (compact success variant with the circular-arrow
`syncOutline` icon in the section header) calls `controller.syncProjects()`. It
does not attempt offline reconnect. `syncProjects()` returns after cache load,
project refresh, validated GeoJSON, overlays, and GPS have durably published.
Its tile phase reports that offline-map preparation was queued; source
collection, plan construction, and downloads continue independently. Errors are
caught locally; cache statistics and map progress continue through the dedicated
event stream rather than a follow-up query.

The button is **disabled while offline-locked** (`isOfflineLocked`): syncing is
an online-only action, and going back online is handled by the dedicated **Go
Online** button (see Account section). It is also disabled while
`syncStatus === 'syncing'`, where it shows an inline spinner plus a `Syncing…`
label (`data-testid="sync-status-label"`) to prevent double-submission. The
button no longer waits for offline-map source collection or plan construction.
The `data-testid` remains `sync-button`.

For a slow `Syncing…` state, the device console provides bounded structured
timing records. `[project-sync:timing]` separates cache load, project refresh,
GeoJSON, overlays, GPS, background admission, and foreground total time;
`[offline-map:timing]` further separates coverage-source collection from plan
generation/admission. See `docs/project-sync-coordination.md` for the schema,
phase boundaries, and privacy contract.

> Runtime offline transition: a Resync only runs while online, but if its
> project-list refresh cannot reach the server (timeout, transport error, or
> 5xx), the controller flips the app to offline mode (see `docs/offline-mode.md`
> and `docs/networking.md`). A `4xx` keeps the existing behavior (cache
> preserved, no logout, no offline flip).

`Last sync` is set by `SpeleoDBController.syncProjects()` only after the
project-list refresh succeeds and the refreshed list is persisted via
`cache.setProjects()`. The timestamp therefore reflects a successful project
refresh phase, not completion of the later GeoJSON / overlay / tile-prefetch
phases. Timeouts, transport errors, and non-2xx responses do **not** advance the
timestamp. The value is persisted via
`PreferencesService.setPreferences({ lastSyncedAt })`, restored on the next app
launch via `restoreSession()`, and reset to `null` on logout.

The engine reads the aggregate cache record during preload, then publishes byte
changes after durable writes. Settings never scans tile metadata or polls
IndexedDB. Browsing-only tiles do not count as offline coverage. Failed attempts
remain in the denominator, are shown in the overall state and affected layer
subtitle, and cannot produce a false 100% state. During initial migration or
plan recovery the counter reads **Preparing…**, never `0 / 0`.

ETA omits zero-value units. Seconds are shown only for estimates under one
minute; minute and hour estimates intentionally hide seconds to avoid noisy
countdown churn.

The overall completed count is summed from the same bounded per-layer counters
rendered in the Map Layers rows. A persisted counter cannot exceed its layer
total or compensate for missing tiles in another layer. **Tiles synced** is the
only coverage counter shown; retained-generation state remains an internal
rolling-refresh safety mechanism.

**Refresh offline maps** is a compact, solid, full-width action at the bottom of
the Map Layers list. It opens a confirmation and calls
`controller.refreshOfflineMaps()`. It is disabled offline and while a refresh is
active. The rolling refresh covers satellite and enabled optional layers,
bypasses the 180-day freshness check, and keeps old tiles usable until valid
replacements commit.

### Map Settings

- **Show landmarks** toggle: controls visibility of landmark marker and label
  layers on the map. Persisted in `UserPreferences.showLandmarks` via
  `PreferencesService`. Default: `true`. Changes propagate to Dashboard in real
  time via a shared React state in `App.tsx`.
- **Color mode** selector: `By Project` / `By Depth`. `By Project` uses the
  standard project color palette; `By Depth` enables depth-based coloring and
  the dashboard depth gauge. Persisted in `UserPreferences.colorMode` via
  `PreferencesService`. Default: `project`. Changes propagate to Dashboard in
  real time via shared React state in `App.tsx`.
- **Map unit** selector: `Meters` / `Feet`. Controls display units for both
  distance scale and depth gauge values. Base values remain feet-based
  internally and are converted for display when metric mode is active. Persisted
  in `UserPreferences.measurementUnit` via `PreferencesService`. Default:
  `meters`. Changes propagate to Dashboard in real time via shared React state
  in `App.tsx`.

### Map Layers

Lists every map tile layer (`MAP_LAYERS`) with an offline-sync toggle and a
per-layer sync percentage. The layer name renders in white with a smaller muted
subtitle. Label lines use `<span class="block">` rather than `<p>`: Ionic ships
an unlayered `ion-label p { color; font-size; margin }` rule that would
otherwise override Tailwind's color/size and add asymmetric top margin. See
`docs/map-layers.md` for the full feature.

- The satellite layer toggle is forced ON and disabled (satellite is always
  synced).
- Other layers (ESRI Hillshade light/dark) are opt-in. Toggling calls
  `controller.setLayerOfflineSync(layerId, enabled)`. Enabling reuses the active
  satellite plan and falls back to full planning only when no valid plan exists.
  Disabling releases successfully before eviction, refreshes statistics, and
  resumes remaining layers from that plan. Failure rolls the toggle back.
- Extra-layer toggles are disabled while the app is offline-locked
  (`isOfflineLocked`): enabling needs the network to prefetch and disabling
  reconciles cached tiles, so neither is allowed offline. Such rows show
  "Offline sync off (unavailable offline)".
- Every layer uses the same immutable coordinate count `N`; overall expected
  coverage is exactly `N * enabled layer count`. Enabling a layer changes the
  total once and never reconstructs it from streamed jobs.
- Current-operation progress and last committed usable coverage are separate.
  Rolling refresh can restart its replacement counter without making usable
  coverage move backward.
- Every tile transition updates in-memory state immediately. React publication
  is coalesced to the next animation frame, with a 50 ms WebView fallback, and
  is independent of one-second durable checkpoints.
- Snapshots also expose audited and queued counters. Completed and failed are
  mutually exclusive normalized layer values; persisted corrupt counters are
  repaired during preload rather than clamped only in the view.
- `layerOfflineSync` is shared state owned by `AuthenticatedAppShell` and passed
  to both Dashboard (for offline selection gating) and Settings.

### Tutorial

- **Show Tutorial** button: closes the project panel (if open), navigates to
  `/dashboard`, and restarts the guided tour from step 1 via the lazy runtime
  loader `restartGuidedTourFromHelp()`. Ignores `hasCompletedGuidedTour`.

### Go Online (offline only)

A dedicated section rendered **only while offline-locked** (`isOfflineLocked`),
placed between the Tutorial and Account sections.

- **Go Online** button (`data-testid="go-online-button"`): calls
  `controller.attemptReconnect()`, the second allowed reconnect trigger
  alongside app relaunch. It is user-driven, not a passive connectivity
  listener.
  - `ok`: the controller clears the offline lock (online restored) and launches
    a sync; the section unmounts automatically because `isOfflineLocked` becomes
    false.
  - `network_error`: still unreachable. A local **Couldn't reconnect** modal
    (`data-testid="reconnect-failed-modal"`) is shown, the app stays offline,
    and the button remains. Nothing else changes.
  - `unauthorized` (`401`/`403`): the controller has already logged out and
    purged local data; Settings navigates to `/login`. Other error statuses
    remain non-destructive `network_error` outcomes.
- Local `isReconnecting` state provides button feedback (`Reconnecting…`) and
  disables the rendered control. `SessionCoordinator` is the authoritative
  re-entry guard: concurrent callers share one probe and can start one sync.

### Account

- **Sign Out** button: users with no pending offline operations see the generic
  local-data confirmation. Users with pending operations instead see one
  mutually exclusive irreversible-loss confirmation with the exact operation
  count and required acknowledgement; accepting it calls `controller.logout()`
  directly without a second generic confirmation. Successful logout dismisses
  the modal and navigates to `/login`. Actions and dismissal are disabled while
  logout is in progress to prevent double-submission.

## State ownership

- Cache bytes and sync metrics: read from `offlineMapSync`, a dedicated
  `useSyncExternalStore` subscription. Per-tile events never publish through the
  controller-wide observer.
- `lastSyncedAt`: owned by `SpeleoDBController`, persisted via
  `PreferencesService`, exposed through `useSpeleoDB()`. UI is read-only.
- `showLandmarks`: shared state owned by `AuthenticatedAppShell`, passed via
  props.
- `colorMode`: shared state owned by `AuthenticatedAppShell`, passed via props.
- `measurementUnit`: shared state owned by `AuthenticatedAppShell`, passed via
  props.
- `selectedMapLayerId` / `layerOfflineSync`: shared state owned by
  `AuthenticatedAppShell`, passed to Dashboard + Settings; persisted via
  `PreferencesService`. Layer offline-sync side effects (prefetch enqueue /
  cleanup) are owned by `SpeleoDBController`.
- `activeDashboardPanel`: single mutually exclusive panel state owned by
  `AuthenticatedAppShell`, passed with `onDashboardPanelChange`; see
  `docs/dashboard-panel-state.md`.
- Logout modal: local state (`showLogoutConfirmModal`, `isLoggingOut`).
- Reconnect flow: local state (`isReconnecting`, `showReconnectFailedModal`).
  The authoritative online/offline state (`isOfflineLocked`) is owned by
  `SpeleoDBController` and consumed read-only via `useSpeleoDB()`.

## Progress lifecycle

There is no Settings polling interval. The offline-map store is updated after
each audit, commit, and failure and notifies the mounted page at paint cadence.
Leaving Settings removes only its subscription; synchronization and durable
checkpoints continue without a hidden page timer.

## Offline behavior

- The Resync button is disabled while offline-locked, so `syncProjects()` is not
  invoked offline. (It still respects the controller's offline lock
  defensively.)
- Reconnect from offline mode is performed by the **Go Online** button via
  `controller.attemptReconnect()`. This is one of the two allowed reconnect
  triggers (the other is app relaunch) per the networking contract; the app
  still uses no passive `online`/`offline` listeners.
- A Resync that runs while online but cannot reach the server (timeout /
  transport error / 5xx) flips the app to offline mode via the controller
  (offline modal shown, Go Online button revealed). A `4xx` does not flip
  offline.

## Source code

- Page component: `src/pages/Settings.tsx`
- Tab bar: `src/components/AppTabBar.tsx`
- Offline-map engine/store: `src/services/OfflineMapSyncEngine.ts`,
  `src/services/OfflineMapSyncStore.ts`
- Landmark persistence: `src/services/PreferencesService.ts`
- Color mode persistence: `src/services/PreferencesService.ts`
- Measurement unit persistence: `src/services/PreferencesService.ts`
- Last sync timestamp: tracked in `SpeleoDBController._lastSyncedAt`, persisted
  via `PreferencesService.setPreferences({ lastSyncedAt })`, formatted by
  `src/utils/formatLastSync.ts`.
- Tour runtime loader: `src/onboarding/guidedTour/runtime.ts`
- Guided tour engine: `src/onboarding/guidedTour/engine.ts`
- Tests: `src/pages/Settings.test.tsx`, `src/utils/formatLastSync.test.ts`

## Change checklist

1. Keep sync metric computation inside `useMemo`.
2. Verify Settings never polls IndexedDB and only the offline-map subscription
   updates per-tile rows.
3. Verify the logout guard prevents double-submission.
4. Verify landmark toggle propagates to Dashboard map layers in real time.
5. Verify color mode selector propagates to Dashboard map rendering in real
   time.
6. Verify map unit selector changes depth gauge + distance scale labels on
   Dashboard.
7. Verify `Last sync` updates after a successful sync and shows `Never` after
   logout.
8. Verify the `Syncing…` label appears on the Resync button while
   `syncStatus === 'syncing'`, and that the button is disabled while
   offline-locked.
9. Verify the Go Online button appears only while offline-locked and routes
   `ok`/`network_error`/`unauthorized` correctly (sync + auto-hide / failure
   modal / redirect to login).
10. Run `npx vitest run src/pages/Settings.test.tsx`.
11. Update this document if sections, state ownership, or offline behavior
    changes.
