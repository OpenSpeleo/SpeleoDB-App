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

Overlay marker click/touch interactions are intentionally scoped:

- Interactive overlays:
  - exploration leads (`exploration-leads-icon-layer`, `exploration-leads-fallback-layer`)
  - cylinder installs (`cylinder-installs-icon-layer`, `cylinder-installs-fallback-layer`)
- Non-interactive overlays:
  - landmarks
  - surface stations
  - subsurface stations
  - project GeoJSON layers

Dashboard opens a single reusable read-only modal from map tap/click hits on those interactive layers:

- Exploration lead modal field:
  - `description` (fallback: `No description available.`)
- Cylinder install modal fields:
  - pressure + unit (`pressure` + `pressure_unit_system`, with `imperial => PSI`, otherwise `BAR`)
  - gas mix (Django parity from `cylinder_table.html`):
    - `he > 0` => `o2/he`
    - `o2 = 100` => `Oxygen`
    - `o2 = 21` and `he = 0` => `Air`
    - otherwise => `NX{o2}`
  - install date (`install_date`, normalized to `YYYY-MM-DD` when ISO datetime is provided)
- Missing/malformed values use safe `N/A` fallbacks (except exploration description fallback above).
- Mobile interaction intent:
  - quick tap/click on interactive markers opens the modal,
  - map drag/pan and pinch-zoom remain map interactions and do not open marker details.
- Touch detection mechanism:
  - A wrapper div over the map canvas captures pointer events (`onPointerDownCapture`/`onPointerUpCapture`).
  - Tap recognition uses movement threshold (`12px`) and duration limit (`550ms`) to distinguish taps from drags.
  - maplibre-gl's `queryRenderedFeatures` with a bounding box (`26px` radius) tests whether the tap hit an interactive layer.
  - The layer ID list is filtered through `map.getLayer()` before querying, because icon-layer and fallback-layer are mutually exclusive (only one exists at a time), and passing a non-existent layer ID to `queryRenderedFeatures` throws.

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
