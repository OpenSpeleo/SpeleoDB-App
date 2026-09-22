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
| Tiles synced    | `completed / (current area coordinate count × requested layer count)`                                                  | Paint cadence                                                            |
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

`MapDisplaySettings` keeps appearance controls in the existing inset list and
places less frequently used options in inline disclosures. The Settings tab,
other sections, and map toolbar stay unchanged. Rows retain the 52px minimum
height; controls and reset actions have at least 44px touch targets. Disclosure
chevrons turn over 160ms, without height or camera animation; reduced motion
removes the transition. Opening a group never focuses the numeric field or opens
the keyboard. Native disclosure semantics provide keyboard expansion and
collapsed-content accessibility, and collapsing a group returns descendant focus
to its summary.

The controls appear in this order:

- **Color mode**: `By Project` / `By Depth` / `By Shot`, default `project`.
  Project mode uses the model-stored project color. Depth mode shows the depth
  gauge and **Depth limit** disclosure. Shot mode uses exported feature colors
  with project-color fallback, including offline; see
  [Shot colors](shot-colors.md).
- **Depth limit**, present only in By Depth: collapsed by default with a **Full
  range** or formatted maximum summary. Expansion exposes **Maximum depth**, a
  decimal-keyboard input, explanatory text, and **Reset to full range**. The
  existing Map unit determines its input and display unit.
- **Map unit**: `Meters` / `Feet`, default `meters`. Controls the distance
  scale, depth gauge, and depth-limit input. Canonical depths remain in feet.
- **Map visibility**: collapsed by default with **All shown** when every
  category and station type is on, otherwise **Custom**. These summaries
  describe preferences, not feature availability at the current zoom.

Map visibility contains **Cave entrances**, **Survey stations**, **Surface
stations**, **Landmarks**, **Exploration leads**, and **Safety cylinders**. Each
defaults on. Cave entrances controls the star symbols from project GeoJSONs. The
inline **Station types** disclosure under Survey stations contains **Sensor**,
**Biology**, **Bones**, **Artifact**, and **Geology**. Its summary reports **N
of 5 selected** or **Survey stations off**. Turning the parent off disables
subtype switches without changing their selections.

Switches apply immediately, including offline, without a Save button, network
request, loading overlay, or camera change. Individual project, network, and
item selections are preserved. Labels follow their marker gates, and all
existing zoom thresholds still apply. A single light haptic acknowledges a
visibility change; opening groups and editing text are silent.

**Reset visibility** restores only the six category and five subtype flags. It
preserves color mode, map unit, depth limit, camera, cache, and individual
selections. **Reset to full range** clears only the depth cap. Reset actions
require no confirmation and are disabled when already at their default.

#### Depth editing

Depth values must be positive and finite; blank restores automatic scaling.
Decimal dots and commas are accepted, without grouping separators. Validation
runs while typing, but rendering and persistence change only on blur, Done, or
collapse. Done commits once and dismisses the keyboard. Invalid drafts show an
associated inline error and leave the last applied limit intact. An invalid
unit-change attempt retains the previous unit and refocuses the field; a valid
one first commits in the previous unit, then converts the presentation. Repeated
unit switches never reconvert rounded display text into storage.

Leaving depth mode keeps the applied cap and discards an invalid draft. Leaving
Settings discards any uncommitted invalid draft without blocking navigation.
Returning starts with collapsed groups and restored preferences.

A configured cap fixes the color scale to **0–X**, even when visible surveys are
shallower than X. Deeper geometry stays visible with saturated colors and capped
readings; original GeoJSON depths remain unchanged. No visible depth data still
produces N/A. See [Map depth and scale](map-depth-and-scale.md) for the domain
and probe contracts.

#### Ownership and verification

`AuthenticatedAppShell` owns `mapDisplayPreferences` and persists partial
patches through `PreferencesService`. The presentation component never writes
storage directly. Color and unit selectors retain their existing persistence
paths. Legacy `showLandmarks` values migrate into the new landmark category; new
fields receive defaults. Map filtering composes display preferences with
existing selection gates rather than changing cached feature collections.

Settings tests exercise every category, subtype preservation, offline changes,
local reset scope, decimal entry, validation, unit changes, and the guided-tour
target. Browser tests verify real Ionic controls and map rendering. Visual QA
covers 320/390px portrait, short landscape, tablet, larger text, keyboard-open
input, and reduced motion; native checks must include iOS and Android WebViews,
particularly keyboard dismissal and solid button backgrounds.

### Map layers

Lists every map tile layer (`MAP_LAYERS`) with an offline-sync toggle and a
per-layer sync percentage. The layer name renders in white with a smaller muted
subtitle. Label lines use `<span class="block">` rather than `<p>`: Ionic ships
an unlayered `ion-label p { color; font-size; margin }` rule that would
otherwise override Tailwind's color/size and add asymmetric top margin. See
`docs/map-layers.md` for the full feature.

- The satellite layer toggle is forced ON and disabled (satellite is always
  synced).
- Other layers (ESRI Hillshade light/dark) are opt-in. Toggling calls
  `controller.setLayerOfflineSync(layerId, enabled)`. Changes reconcile the
  enabled layers of every area, including manual rectangles. Disabling releases
  that provider’s claims while preserving cached bytes and other layers. A
  catalog write failure rolls the preference back.
- Extra-layer toggles are disabled while the app is offline-locked
  (`isOfflineLocked`): enabling needs the network to prefetch and disabling
  reconciles cached tiles, so neither is allowed offline. Such rows show
  "Offline sync off (unavailable offline)".
- Every enabled layer uses the same immutable, deduplicated union coordinate
  count `N`; expected coverage is `N * enabled layer count`. Switches reuse this
  plan and leave unrelated providers’ progress and downloads untouched.
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
- `mapDisplayPreferences`: shared state owned by `AuthenticatedAppShell`, passed
  to Settings and Dashboard; partial visibility/depth patches update state and
  persistence through the shell.
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
- Display controls: `src/components/MapDisplaySettings.tsx`
- Display preference model: `src/types/mapDisplayPreferences.ts`
- Display persistence: `src/services/PreferencesService.ts`
- Color mode persistence: `src/services/PreferencesService.ts`
- Measurement unit persistence: `src/services/PreferencesService.ts`
- Last sync timestamp: tracked in `SpeleoDBController._lastSyncedAt`, persisted
  via `PreferencesService.setPreferences({ lastSyncedAt })`, formatted by
  `src/utils/formatLastSync.ts`.
- Tour runtime loader: `src/onboarding/guidedTour/runtime.ts`
- Guided tour engine: `src/onboarding/guidedTour/engine.ts`
- Tests: `src/pages/Settings.test.tsx`, `src/utils/formatLastSync.test.ts`
- Browser coverage: `tests/browser/map-display.spec.ts` exercises the real
  Settings route and retained map, offline restoration, and responsive depth
  validation in Chromium and WebKit. Run after the production build with
  `npx playwright test tests/browser/map-display.spec.ts` from this app.

## Change checklist

1. Keep sync metric computation inside `useMemo`.
2. Verify Settings never polls IndexedDB and only the offline-map subscription
   updates per-tile rows.
3. Verify the logout guard prevents double-submission.
4. Verify every visibility toggle propagates to markers and labels in real time,
   retains individual selections, and survives offline use and relaunch.
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

## Offline Maps manager

**Offline Maps** opens the shared dashboard manager described in
[Offline download areas](offline-download-areas.md). Manual and automatic areas
use the same enabled **Map layers**. Layer switches reuse the shared tile plan;
only area geometry changes trigger planning. Disabling a provider releases its
offline claims while preserving other layers and reusable cached bytes. Offline
saving is local; **Go Online** resumes waiting areas. The overall progress row
describes the shared union across enabled layers; the manager lists colored
areas with per-area completion states and direct show/hide, edit, and delete
icons. **Add new offline area** opens boundary selection with Cancel/Save and no
name entry.
