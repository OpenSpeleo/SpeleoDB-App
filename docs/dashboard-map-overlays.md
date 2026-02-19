# Dashboard Map Overlays (Read-Only)

This document defines the additional dashboard overlay layers rendered from cached GeoJSON, and the strict read-only UX contract for those layers.

## Goal

- Mirror Django map-viewer icon behavior for:
  - landmarks,
  - surface stations,
  - subsurface stations,
  - exploration leads,
  - cylinder installs.
- Keep these overlays available offline with the same lifecycle as project GeoJSON sync.
- Keep the feature read-only: display map markers/icons, map label layers, and non-editable marker details.

## Endpoints

The app fetches these authenticated endpoints during dashboard sync:

- `/api/v1/landmarks/geojson/`
- `/api/v1/stations/subsurface/geojson/`
- `/api/v1/stations/surface/geojson/`
- `/api/v1/exploration-leads/geojson/`
- `/api/v1/cylinder-installs/geojson/`

Implementation lives in:

- `src/services/SpeleoDBService.ts`
- `src/controllers/SpeleoDBController.ts`
- `src/services/ProjectCacheService.ts`
- `src/utils/overlayMarkerDetails.ts`
- `src/components/OverlayMarkerDetailsModal.tsx`

## Rendering contract (Django parity)

Dashboard map rendering is in `src/pages/Dashboard.tsx`.

## Zoom configuration (source of truth: `src/constants.ts`)

All zoom values below are sourced from `MAP` and `MAP_OVERLAYS` in `src/constants.ts`.

### Global map zooms

- Initial map zoom: `MAP.DEFAULT_ZOOM = 5`
- Max map zoom cap: `MAP.MAX_ZOOM = 19.9` (at 20 the map turns black)

### Project GeoJSON layer zooms

- Project line/polygon outline minimum zoom: `MAP.PROJECT_LAYER_ZOOMS.LINE_MIN = 0`
- Project point/star minimum zoom: `MAP.PROJECT_LAYER_ZOOMS.ENTRY_SYMBOL_MIN = 0`

Project GeoJSON drawing order is pinned below marker-oriented layers:

- Project fill/line/point layers are anchored below overlay marker/label layers.
- This ordering remains stable after project toggle/show/hide cycles.

- Landmarks:
  - symbol marker `▼`,
  - blue color (`#3b82f6`),
  - marker min zoom `10`,
  - label layer (`name`) from zoom `12`.
- Surface stations:
  - symbol marker `◆`,
  - color from `properties.color` (normalized from station/tag color), fallback `#fb923c`,
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

Marker context is provided by **map label layers** (Django parity), not a static legend panel.

- Landmarks labels: `properties.name`
- Surface station labels: `properties.name`
- Subsurface station labels: `properties.name`
- Cylinder labels: `install_date @ pressure unit`
- Exploration leads: icon-only (no text label layer)

## Interactive marker details (read-only)

All overlay markers and project GeoJSON point features are interactive. Tapping/clicking a marker opens a read-only detail modal.

### Interactive layers

- Exploration leads: `exploration-leads-icon-layer`, `exploration-leads-fallback-layer`
- Cylinder installs: `cylinder-installs-icon-layer`, `cylinder-installs-fallback-layer`
- Landmarks: `landmarks-layer`
- Surface stations: `surface-stations-layer`
- Subsurface stations: `subsurface-stations-circles`, `subsurface-stations-biology-icons`, `subsurface-stations-bone-icons`, `subsurface-stations-artifact-icons`, `subsurface-stations-geology-icons`
- Project GeoJSON points (stars): `project-{project.id}-point` (dynamic layer IDs computed from active project set)

Non-interactive layers (no modal on tap):

- Project line/polygon/fill layers (`project-{id}-line`, `project-{id}-fill`)

### Static vs. dynamic layer IDs

Overlay layer IDs are static and listed in `INTERACTIVE_OVERLAY_LAYER_IDS` in `src/utils/overlayMarkerDetails.ts`. Project point layer IDs are dynamic (`project-${project.id}-point`) and computed at render time from active project IDs. Both lists are combined before querying `queryRenderedFeatures`.

Project point layer IDs are detected with `isProjectPointLayerId()` using the pattern `/^project-.+-point$/`.

### Modal fields by marker type

Dashboard opens a single reusable read-only modal (`OverlayMarkerDetailsModal`) from map tap/click hits:

- **Exploration lead** (title: "Exploration Lead"):
  - Description (fallback: `No description available.`)
- **Cylinder install** (title: "Cylinder Install"):
  - Pressure + unit (`pressure` + `pressure_unit_system`, with `imperial => PSI`, otherwise `BAR`)
  - Gas mix (Django parity from `cylinder_table.html`):
    - `he > 0` => `o2/he`
    - `o2 = 100` => `Oxygen`
    - `o2 = 21` and `he = 0` => `Air`
    - otherwise => `NX{o2}`
  - Install date (`install_date`, normalized to `YYYY-MM-DD` when ISO datetime is provided)
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
  - GPS coordinate (extracted from feature geometry as `lat, lng`)
- **Project entry point** (title: "Project Entry Point"):
  - Project name (resolved from `Project.name` via layer ID, not from GeoJSON properties)
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
- Tag parsing: string value used directly; object with `name` field uses `tag.name`; otherwise `N/A`.

### GPS coordinate formatting

GPS coordinates are extracted from Point geometry (`feature.geometry.coordinates`) and formatted as `lat, lng` (decimal degrees, limited to 7 decimal places, trailing zeros stripped). The GeoJSON coordinate order is `[lng, lat]`, so the formatter swaps them for display.

### Project name resolution

Project GeoJSON star features do not carry the project name in their GeoJSON properties. Instead, the project name is resolved from the layer ID:

1. Dashboard builds a `MarkerParseContext` map from `sortedProjects`, keyed by `project-${project.id}-point`.
2. When a tap hits a project point layer, `parseOverlayMarkerDetails` looks up the project name from this context map.

### Touch detection mechanism

- Mobile interaction intent:
  - quick tap/click on interactive markers opens the modal,
  - map drag/pan and pinch-zoom remain map interactions and do not open marker details.
- A wrapper div over the map canvas captures pointer events (`onPointerDownCapture`/`onPointerUpCapture`).
- Tap recognition uses movement threshold (`12px`) and duration limit (`550ms`) to distinguish taps from drags.
- maplibre-gl's `queryRenderedFeatures` with a bounding box (`26px` radius) tests whether the tap hit an interactive layer.
- The layer ID list is filtered through `map.getLayer()` before querying, because icon-layer and fallback-layer are mutually exclusive (only one exists at a time), and passing a non-existent layer ID to `queryRenderedFeatures` throws.

### Long press GPS coordinate

Long-pressing anywhere on the map (touch/pen only) opens the detail modal with just the GPS coordinate of the pressed point.

- Duration: `MAP.LONG_PRESS_DURATION_MS = 300` in `src/constants.ts` (0.5 second hold).
- A `setTimeout` is started on `pointerdown` for touch/pen events. If the pointer stays within the movement threshold (`12px`) for the full duration, the timer fires and opens the modal.
- The timer is cancelled when:
  - the pointer moves beyond the movement threshold (drag),
  - the pointer is released before the timer fires (short tap or cancelled gesture).
- Pixel-to-coordinate conversion uses maplibre-gl's `map.unproject()` to convert the pointer's canvas position to `{ lng, lat }`.
- The resulting coordinate is formatted using `formatLatLng(lat, lng)` with the same 7-decimal-place, trailing-zero-stripped format as all other GPS fields.
- The tap candidate ref is nulled when the long-press fires, preventing the subsequent `pointerup` from also triggering a marker tap query.

Zoom levels are sourced from `MAP_OVERLAYS` in `src/constants.ts` (`markerMinZoom`, `labelMinZoom`).

### Overlay zoom matrix

- `landmarks`:
  - `markerMinZoom = 10`
  - `labelMinZoom = 12`
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

- Overlay payloads are cached in IndexedDB (`geojson` store) using namespaced keys (`overlay:<id>`).
- Sync trigger parity with projects:
  - app open/login path (`syncProjects()`),
  - dashboard pull-to-refresh.
- Offline behavior:
  - dashboard loads overlays from cache,
  - normal offline lock skips outbound sync calls.
- Logout:
  - cache clear wipes project + overlay GeoJSON together via `clearAll()`.

## Project visibility interaction

- Project panel toggles filter **project-linked overlays** only:
  - subsurface stations by `properties.project`,
  - exploration leads by `properties.project`,
  - cylinder installs by `properties.project_id`.
- Landmarks and surface stations are not project-linked and stay independent from project toggles.

## Read-only UX constraints

- No create/edit/delete/move UI.
- Overlay marker details are view-only and never allow edits.
- Overlay functionality remains read-only.

## Regression tests

- `src/services/SpeleoDBService.test.ts`
- `src/services/ProjectCacheService.test.ts`
- `src/controllers/SpeleoDBController.test.ts`
- `src/pages/Dashboard.test.tsx`
- `src/utils/overlayMarkerDetails.test.ts`
