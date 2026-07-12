# Dashboard Map Overlays (Read-Only)

This document defines the additional dashboard overlay layers rendered from
cached GeoJSON, and the strict read-only UX contract for those layers.

## Goal

- Mirror Django map-viewer icon behavior for:
  - landmarks,
  - surface stations,
  - subsurface stations,
  - exploration leads,
  - cylinder installs.
- Keep these overlays available offline with the same lifecycle as project
  GeoJSON sync.
- Keep the feature read-only: display map markers/icons, map label layers, and
  non-editable marker details.

## Endpoints

The app fetches these authenticated endpoints during dashboard sync:

- `/api/v2/landmarks/geojson/`
- `/api/v2/stations/subsurface/geojson/`
- `/api/v2/stations/surface/geojson/`
- `/api/v2/exploration-leads/geojson/`
- `/api/v2/cylinder-installs/geojson/`

All five read-only overlay operations and writable landmark-collection metadata
are independent after project GeoJSON is durable, so their transport and cache
work starts concurrently. GPS metadata synchronization starts at the same
boundary. Foreground sync still waits for every durable result, but its elapsed
time is bounded by the slowest independent branch rather than the sum of those
branches. A shared cancellation context prevents stale publication after logout
or a superseding sync.

Implementation lives in:

- `src/services/SpeleoDBService.ts`
- `src/controllers/ProjectOverlaySyncCoordinator.ts`
- `src/controllers/ProjectSyncCoordinator.ts`
- `src/services/ProjectCacheService.ts`
- `src/utils/overlayMarkerDetails.ts`
- `src/pages/dashboard/dashboardMapUtils.ts`
- `src/components/OverlayMarkerDetailsModal.tsx`

Confirmed landmark creates, edits, and removals mutate the cached landmark
`FeatureCollection` through one strict IndexedDB read-write transaction. This
preserves unrelated markers under concurrent confirmations and publishes the
landmark revision only after durable completion. Optional sync snapshots remain
best-effort, but mutation ground truth fails closed on storage, schema, abort,
or transaction errors.

## Rendering contract (Django parity)

Dashboard owns domain orchestration in `src/pages/Dashboard.tsx`, while
`DashboardMapCanvas.tsx` owns MapLibre and map-chrome composition.
`useDashboardMapData.ts` owns revision-driven cached overlay reads,
normalization, stale-completion suppression, and atomic publication; see
`docs/dashboard-map-data.md`. `OverlayMapLayers.tsx` owns declarative overlay
sources and layers, while deterministic map policy is isolated in
`dashboardMapUtils.ts`: overlay normalization and project filtering, marker hit
boxes, per-icon image loading, project/track bounds, and north-up orientation.
See `docs/dashboard-map-shell.md`, `docs/dashboard-map-layers.md`,
`docs/dashboard-map-interactions.md`, and `docs/dashboard-map-utilities.md`.

## Zoom and size configuration (source of truth: `src/constants.ts`)

All zoom and marker size values below are sourced from `PROJECT_LAYERS`, `MAP`,
and `MAP_OVERLAYS` in `src/constants.ts`. Marker sizes for each overlay are in
the `sizes` field of each `MAP_OVERLAYS` entry (typed as `MapOverlaySizes` in
`src/types/mapOverlay.ts`).

### Global map zooms

- Initial map zoom: `MAP.DEFAULT_ZOOM = 5`
- Max map zoom cap: `MAP.MAX_ZOOM = 19.9` (at 20 the map turns black)

### Distance scale, depth coloring, and depth gauge

Distance scale overlay, project depth color mode, depth gauge behavior, and
measurement unit settings are documented in `docs/map-depth-and-scale.md`.

### Project GeoJSON layer zooms

- Project line/polygon outline minimum zoom: `PROJECT_LAYERS.lineMinZoom = 0`
- Project point/star minimum zoom: `PROJECT_LAYERS.entrySymbolMinZoom = 5`
- Project point/star text size: `PROJECT_LAYERS.entrySymbolTextSize` (zoom
  interpolation)

Project GeoJSON drawing order is pinned below marker-oriented layers:

- Project fill/line/point layers are anchored below overlay marker/label layers.
- This ordering remains stable after project toggle/show/hide cycles.

- Landmarks:
  - symbol marker `▼`,
  - color driven by the landmark's collection (`properties.collection_color`),
    fallback `COLORS.FALLBACK` (`#94a3b8`); halo flips to dark slate `#0f172a`
    when the collection color is white so the marker stays visible (mirrors the
    web map viewer). See `docs/landmark-collections.md`.
  - marker min zoom `12`,
  - label layer (`name`) from zoom `14`.
- Surface stations:
  - symbol marker `◆`,
  - color from `properties.color` (normalized from station/tag color), fallback
    `#fb923c`,
  - marker min zoom `12`,
  - label layer (`name`) from zoom `14`.
- Subsurface stations:
  - sensor/no-type points rendered as circles with color fallback `#fb923c`,
  - `type=biology|bone|artifact|geology` rendered with icon images,
  - marker min zoom `12`,
  - label layer (`name`) from zoom `14`.
- Exploration leads:
  - `exploration-lead-icon` symbol layer,
  - fallback to red circle when icon cannot load,
  - marker min zoom `12`,
  - no dedicated label layer.
- Cylinder installs:
  - `cylinder-icon` symbol layer,
  - fallback to orange bullet symbol when icon cannot load,
  - marker min zoom `12`,
  - label layer from zoom `14` with `install_date @ pressure unit`.

## Icon assets

Django assets are copied into:

- `src/assets/media/map-icons/`

Files:

- `artifact-icon.png`
- `bones-icon.png`
- `fish-icon.png`
- `rock-icon.png`
- `exploration-lead-icon.png`
- `cylinder-orange-icon.png`

## Label legend contract

Marker context is provided by **map label layers** (Django parity), not a static
legend panel.

- Landmarks labels: `properties.name`
- Surface station labels: `properties.name`
- Subsurface station labels: `properties.name`
- Cylinder labels: `install_date @ pressure unit`
- Exploration leads: icon-only (no text label layer)

## Interactive marker details (read-only)

All overlay markers and project GeoJSON point features are interactive. Tapping
a marker opens a read-only detail modal.

**Minimum zoom gate**: all marker interactions that open a modal (marker taps
and long-press GPS) require `zoom >= MAP.MARKER_INTERACTION_MIN_ZOOM` (`15`).
Below this zoom, taps on markers and long-press GPS are silently ignored to
prevent accidental triggers at region scale.

### Interactive layers

- Exploration leads: `exploration-leads-icon-layer`,
  `exploration-leads-fallback-layer`
- Cylinder installs: `cylinder-installs-icon-layer`,
  `cylinder-installs-fallback-layer`
- Landmarks: `landmarks-layer`
- Surface stations: `surface-stations-layer`
- Subsurface stations: `subsurface-stations-circles`,
  `subsurface-stations-biology-icons`, `subsurface-stations-bone-icons`,
  `subsurface-stations-artifact-icons`, `subsurface-stations-geology-icons`
- Project GeoJSON points (stars): `project-{project.id}-point` (dynamic layer
  IDs computed from active project set)

Non-interactive layers (no modal on tap):

- Project line/polygon/fill layers (`project-{id}-line`, `project-{id}-fill`)

### Static vs. dynamic layer IDs

Overlay layer IDs are static and listed in `INTERACTIVE_OVERLAY_LAYER_IDS` in
`src/utils/overlayMarkerDetails.ts`. Project point layer IDs are dynamic
(`project-${project.id}-point`) and computed at render time from active project
IDs. Both lists are combined before querying `queryRenderedFeatures`.

Project point layer IDs are detected with `isProjectPointLayerId()` using the
pattern `/^project-.+-point$/`.

### Modal fields by marker type

`DashboardLandmarkDialogs` opens a single reusable read-only modal
(`OverlayMarkerDetailsModal`) from map tap/click hits:

- **Exploration lead** (title: "Exploration Lead"):
  - Description (fallback: `No description available.`)
- **Cylinder install** (title: "Cylinder Install"):
  - Pressure + unit (`pressure` + `pressure_unit_system`, with
    `imperial => PSI`, otherwise `BAR`)
  - Gas mix (Django parity from `cylinder_table.html`):
    - `he > 0` => `o2/he`
    - `o2 = 100` => `Oxygen`
    - `o2 = 21` and `he = 0` => `Air`
    - otherwise => `NX{o2}`
  - Install date (`install_date`, normalized to `YYYY-MM-DD` when ISO datetime
    is provided)
- **Subsurface station** (title: "Subsurface Station"):
  - Name (`properties.name`)
  - Description (`properties.description`)
  - Tag (`properties.tag` — string or object with `name` field)
- **Surface station** (title: "Surface Station"):
  - Name (`properties.name`)
  - Description (`properties.description`)
  - GPS coordinate (extracted from feature geometry as `lat, lng`)
- **Landmark** (title: "Landmark"):
  - Name (`properties.name`)
  - Description (`properties.description`)
  - Collection (`properties.collection_name`, with a "Private" badge when
    `properties.is_personal_collection` is true /
    `collection_type === 'PERSONAL'`)
  - GPS coordinate (extracted from feature geometry as `lat, lng`)
- **Project entry point** (title: "Project Entry Point"):
  - Project name (resolved from `Project.name` via layer ID, not from GeoJSON
    properties)
  - Name (`properties.name`)
  - GPS coordinate (extracted from feature geometry as `lat, lng`)
- **Map long press** (title: "Map Point"):
  - GPS coordinate (converted from pixel position via `map.unproject()`)

### Fallback values

- Missing/malformed string properties use `N/A`.
- Exploration lead description fallback: `No description available.`
- Missing or non-Point geometry for GPS coordinate: `N/A`.
- Non-finite coordinate values: `N/A`.
- Missing project name context for project points: `N/A`.
- Tag parsing: string value used directly; object with `name` field uses
  `tag.name`; otherwise `N/A`.

### GPS coordinate formatting

GPS coordinates are extracted from Point geometry
(`feature.geometry.coordinates`) and formatted as `lat, lng` (decimal degrees,
limited to 7 decimal places, trailing zeros stripped). The GeoJSON coordinate
order is `[lng, lat]`, so the formatter swaps them for display.

### Project name resolution

Project GeoJSON star features do not carry the project name in their GeoJSON
properties. Instead, the project name is resolved from the layer ID:

1. Dashboard builds a `MarkerParseContext` map from `sortedProjects`, keyed by
   `project-${project.id}-point`.
2. When a tap hits a project point layer, `parseOverlayMarkerDetails` looks up
   the project name from this context map.

### Touch detection mechanism

- Mobile interaction intent:
  - quick tap/click on interactive markers opens the modal,
  - map drag/pan and pinch-zoom remain map interactions and do not open marker
    details.
- A wrapper div over the map canvas captures pointer events
  (`onPointerDownCapture`/`onPointerUpCapture`).
- `useDashboardMapInteractions` owns the pointer candidate, timers, hit queries,
  selected marker detail, and loading-ring state; Dashboard only wires its
  returned handlers and state into the page.
- Tap recognition uses movement threshold (`12px`) and duration limit (`550ms`)
  to distinguish taps from drags.
- maplibre-gl's `queryRenderedFeatures` with a bounding box (`26px` radius)
  tests whether the tap hit an interactive layer.
- The layer ID list is filtered through `map.getLayer()` before querying,
  because icon-layer and fallback-layer are mutually exclusive (only one exists
  at a time), and passing a non-existent layer ID to `queryRenderedFeatures`
  throws.

### Long press GPS coordinate

Long-pressing on an empty map spot (touch/pen only) opens the detail modal with
just the GPS coordinate of the pressed point.

- Duration: `MAP.LONG_PRESS_DURATION_MS = 300` in `src/constants.ts` (0.3 second
  hold).
- Minimum zoom gate: `MAP.MARKER_INTERACTION_MIN_ZOOM = 15` (shared with marker
  taps).
- A `setTimeout` is started on `pointerdown` for touch/pen events. If the
  pointer stays within the movement threshold (`12px`) for the full duration,
  the timer fires and opens the modal.
- The timer is cancelled when:
  - the pointer moves beyond the movement threshold (drag),
  - the pointer is released before the timer fires (short tap or cancelled
    gesture).
- Empty-spot gating:
  - On timer fire, the app queries rendered features in a bbox around the
    pointer (`MAP.LONG_PRESS_EMPTY_SPOT_RADIUS_PX = 18`).
  - The bbox is checked against existing interactive/overlay marker layers,
    project geometry layers (`project-{id}-point|line|fill`), key overlay label
    layers, and user location dot.
  - If any feature exists in that bbox, `Map Point` does not open.
- Pixel-to-coordinate conversion uses maplibre-gl's `map.unproject()` to convert
  the pointer's canvas position to `{ lng, lat }`.
- The resulting coordinate is formatted using `formatLatLng(lat, lng)` with the
  same 7-decimal-place, trailing-zero-stripped format as all other GPS fields.
- The tap candidate ref is nulled when the long-press fires, preventing the
  subsequent `pointerup` from also triggering a marker tap query.

Zoom levels and marker sizes are sourced from `MAP_OVERLAYS` in
`src/constants.ts` (`markerMinZoom`, `labelMinZoom`, `sizes`).

### Overlay zoom matrix

- `landmarks`:
  - `markerMinZoom = 12`
  - `labelMinZoom = 14`
- `surfaceStations`:
  - `markerMinZoom = 12`
  - `labelMinZoom = 14`
- `subsurfaceStations`:
  - `markerMinZoom = 12`
  - `labelMinZoom = 14`
- `explorationLeads`:
  - `markerMinZoom = 12`
  - `labelMinZoom = null` (no label layer)
- `cylinderInstalls`:
  - `markerMinZoom = 12`
  - `labelMinZoom = 14`

## Offline/cache/resync/logout lifecycle

- Overlay payloads are cached in IndexedDB (`geojson` store) using namespaced
  keys (`overlay:<id>`).
- Successful overlay sync only persists payloads that normalize to a GeoJSON
  `FeatureCollection`. Non-`2xx` or malformed `2xx` responses are ignored so the
  last good cached overlay remains available offline.
- Sync trigger parity with projects:
  - app open/login path (`syncProjects()`),
  - Settings page sync button.
- Offline behavior:
  - dashboard loads overlays from cache,
  - normal offline lock skips outbound sync calls.
- Logout:
  - cache clear wipes project + overlay GeoJSON together via `clearAll()`.

## Project visibility interaction

- `useDashboardProjectVisibility` derives `effectiveActiveProjectIds` once per
  render from the current projects, loaded GeoJSON, per-project intent, and the
  per-country gate. A project is in this set iff current map data exists, its
  individual toggle is ON, and its country gate is ON. See
  `docs/dashboard-project-visibility.md` and `docs/project-panel.md` for the
  full two-level visibility model.
- Every map-side consumer reads from `effectiveActiveProjectIds`:
  - project `<Source>`/`<Layer>` mount/unmount,
  - project-linked overlay filtering,
  - depth-domain merge in `useDepthProbe`,
  - auto-fit-bounds on first load,
  - dynamic project layer ID lists (`projectPointLayerIds`,
    `projectGeometryLayerIds`).
- Project-linked overlay filters use `effectiveActiveProjectIds`:
  - subsurface stations by `properties.project`,
  - exploration leads by `properties.project`,
  - cylinder installs by `properties.project_id`.
- Landmarks and surface stations are not project-linked and stay independent
  from project toggles.
- Toggling a country gate cascades through every consumer above. Per-project
  preferences are not mutated; the panel still shows each project row's toggle
  in its individual `checked` state, just with muted styling on the dot and
  name.
- In depth color mode, toggling either an individual toggle or a country gate
  automatically recomputes the depth domain (min/max range) using only
  effectively-visible projects. Depth gauge labels and layer color expressions
  update immediately.

## Landmark visibility toggle

The Settings page includes a "Show landmarks" toggle under the "Map Settings"
section. This is the **global master gate**: when off, no landmark layers render
regardless of per-collection state.

- Persisted in `UserPreferences.showLandmarks` via `PreferencesService`.
- Default: `true` (landmarks shown when preference is missing or undefined).
- Settings communicates the toggle state to Dashboard in real time via shared
  React state in `App.tsx` since both pages stay mounted simultaneously.
- Implementation: `src/pages/Settings.tsx`, `src/pages/Dashboard.tsx`,
  `src/services/PreferencesService.ts`.

Finer-grained, **per-collection** visibility (plus the Landmarks tab/panel that
hosts those toggles) is documented in `docs/landmark-collections.md`. The map
draws a landmark only when the global toggle is on **and** its collection is not
toggled off.

## Share functionality

The marker detail modal includes a native Share button (via `@capacitor/share`)
for a subset of marker types:

- **Landmark**: shares name, collection (with `(Private)` suffix for personal
  collections), and GPS coordinate.
- **Surface station**: shares name and GPS coordinate.
- **Project entry point** (star): shares project name, name, and GPS coordinate.
- **Map point** (long press): shares GPS coordinate.

Other marker types (exploration leads, cylinder installs, subsurface stations)
do not show the Share button. When Share is not available, the Close button
renders full-width.

The shareable type set is defined as `SHAREABLE_TYPES` in
`src/components/OverlayMarkerDetailsModal.tsx`.

## Read-only UX constraints

- These overlays (exploration leads, cylinder installs, subsurface/surface
  stations, project points) remain strictly read-only: display + view-only
  details, no create/edit/delete/move UI.
- **Exception — landmarks.** The `landmark` and `mapLongPress` detail types now
  expose create/edit/delete actions (gated by `can_write`/`can_delete`). This is
  the one mutable overlay surface; see `docs/landmark-crud.md`. All other
  overlay detail types stay view-only.

## Regression tests

- `src/services/SpeleoDBService.test.ts`
- `src/services/ProjectCacheService.test.ts`
- `src/controllers/SpeleoDBController.test.ts`
- `src/pages/Dashboard.test.tsx`
- `src/utils/overlayMarkerDetails.test.ts`
- `src/components/OverlayMarkerDetailsModal.test.tsx`
