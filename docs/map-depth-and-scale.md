# Map Depth Mode and Distance Scale

This document defines the dashboard map distance scale and depth-coloring mode,
including the touch-first depth gauge behavior used on mobile devices.

## Goal

- Port the website map-viewer concepts (distance scale + depth coloring/depth
  gauge) into the app.
- Keep default coloring predictable (`project` mode).
- Add a mobile-first interaction model for "hover depth" behavior.

## Scope

- Dashboard map:
  - always-visible distance scale overlay,
  - project layer coloring mode (`project`, `depth`, or `shot`),
  - depth gauge overlay (visible only in `depth` mode).
- Settings:
  - map setting selectors for color mode and map unit with persistence.

## Parity note

Mobile and the private website map viewer share exported feature colors and
model-stored project colors. Each client owns its controls and rendering; the
mobile implementation remains usable in a standalone clone and offline.

## Settings contract

Map color mode is controlled from `Settings` -> `Map Settings`:

- Selector label: `Color mode`.
- Options: `By Project` (default value), `By Depth`, and `By Shot`.
- Persistence key: `UserPreferences.colorMode` via `PreferencesService`.
- Default when missing or invalid: `project`.

Map measurement units are also controlled from `Settings` -> `Map Settings`:

- Selector label: `Map unit`.
- Options: `Meters` (default value) and `Feet`.
- `Meters`: display metric units (`m`/`km`) converted from feet-based values.
- `Feet`: display imperial units (`ft`/`mi`) from the same feet-based values.
- Persistence key: `UserPreferences.measurementUnit` via `PreferencesService`.
- Default when missing or invalid: `meters`.

Related files:

- `src/pages/Settings.tsx`
- `src/AuthenticatedAppShell.tsx`
- `src/services/PreferencesService.ts`
- `src/types/mapColorMode.ts`
- `src/types/measurementUnit.ts`

## Depth data model

Depth values are normalized per feature in `src/utils/depthColoring.ts`.

### Extraction order

For each feature, depth is resolved in this order:

1. Known numeric property keys (`_speleoDepth`, `depth`, `depth_m`, `z`,
   `elevation`, etc.).
2. Geometry Z coordinates (`coordinates[*][2]`) when properties are missing.

### Geometry fallback rule

- When geometry Z is used, depth is the mean of available Z coordinates for that
  feature.
- If no numeric depth exists, the feature is treated as depthless.

### Normalized property

- Normalized depth is stored on feature properties as `_speleoDepth`.
- Missing `_speleoDepth` is valid and expected for depthless features.

### Internal unit convention

All depth and distance values flow through a feet-based internal pipeline:

- **Depth values**: raw numeric values extracted from GeoJSON properties or
  geometry Z coordinates are treated as feet internally. Property key names like
  `depth_m` or `elevation_m` are checked as candidate keys for compatibility
  with various GeoJSON producers, but the extracted numeric values are not
  converted -- they are used as-is and assumed to be in the same unit. If the
  upstream Django backend stores depths in a different unit, a conversion step
  would need to be added at extraction time.
- **Distance scale**: `computeDistanceScaleMetrics` computes ground distance in
  feet from the Mercator projection. The `distanceFeet` output field is consumed
  by `formatDistanceValue` from `src/utils/measurementUnits.ts`.
- **Display conversion**: `formatDepthValue` and `formatDistanceValue` in
  `src/utils/measurementUnits.ts` accept feet-based values. When the user
  selects `Meters` mode, these functions multiply by `FEET_TO_METERS` (0.3048)
  before display. When `Feet` mode is selected, the raw value is shown directly.

This convention keeps the measurement pipeline unidirectional: raw feet in,
display-unit-formatted string out.

## Project layer coloring

Project line/fill layers support three modes:

- `project` mode:
  - the model-stored project color (`projectColorsById`).
- `depth` mode:
  - maplibre expression uses `_speleoDepth`,
  - depth color scale is 0-limited (`depth < 0` is clamped to `0`),
  - color ramp:
    - uses a richer multi-stop sequence from deep blue -> blue -> cyan -> green
      -> yellow -> orange -> red,
    - applies non-linear emphasis (`sqrt`) so low/mid ranges separate more
      clearly instead of looking flat,
    - keeps gauge depth position linear while color distribution remains
      non-linear.
  - fallback to project color when feature depth is missing.

- `shot` mode uses feature `properties.color` with a per-feature project-color
  fallback. See [Shot colors](shot-colors.md) for source colors, alpha, and
  artifact refresh behavior.

Depth domain (`min`, `max`) is computed from active (visible) project feature
collections only. When a project is shown or hidden via the project panel, the
depth domain is recomputed automatically. Per-project depth domains are cached
at GeoJSON load time and merged in O(projects) on visibility change, so toggling
is instant regardless of feature count. The depth gauge min/max labels and all
visible project layer color expressions update immediately to reflect the new
domain.

## Optional depth limit

In By Depth mode, the inline **Depth limit** disclosure offers one optional
positive maximum. It uses the existing Map unit preference; decimal points and
decimal commas are accepted, but grouping separators and units in the field are
not. Validation occurs while typing. Blur or Enter applies a valid draft;
invalid input keeps the last applied value. Clearing the input or choosing
**Reset to full range** restores automatic scaling.

`UserPreferences.mapDisplayPreferences.depthLimitFeet` stores canonical feet, or
`null` for the automatic range. Display-unit changes format that same value
without writing a rounded conversion back to storage. The preference works
offline and is retained when switching to another color mode.

A limit fixes the effective color scale to **0–X**, even if all visible surveys
are shallower than X. Deeper geometry stays visible at the maximum color.
Positive depth probe readouts stop at X; existing negative readouts remain
signed. The gauge and project line/fill colors use the same effective domain.
Fractional caps retain more precision than normal one-decimal readings, and
formatting never rounds a capped label above its physical maximum. With no
visible depth data the gauge still shows N/A.

`utils/depthLimit.ts` owns numeric parsing, unit formatting, and the pure domain
override. `useDepthProbe` applies that override after merging cached project
domains, so changing limits, visibility, or display units never scans features.
Original GeoJSON values, per-project domains, exports, and the mobile
square-root color ramp remain unchanged. Clearing the limit immediately uses the
latest visible-project range, including data loaded after the limit was set.

A sampled depth belongs to its query context: color mode, eligible project
layers, and source revision. Changing that context discards an old reading even
when another visible project still supplies depth data; returning to the former
settings does not resurrect the sample. Limit changes reuse the raw sample and
update its displayed cap immediately. Hidden entrance layers are excluded from
sampling without changing the project depth-domain cache.

## Distance scale behavior

- The scale is always visible on the map.
- It updates from current map zoom and latitude.
- Distances are chosen using readable 1/2/5 progression.
- Label formats in meters/kilometers by default.
- When user selects feet, labels are displayed in feet/miles.
- Overlay is non-interactive (`pointer-events: none`) and safe-area compatible
  with existing dashboard layout.

Implementation:

- `src/components/map/DistanceScale.tsx`
- rendered by `src/pages/dashboard/DashboardMapCanvas.tsx`

## Depth gauge behavior

The gauge is visible only when `colorMode === 'depth'`.

- Shows current sampled depth.
- Shows min/max depth domain values.
- Displays a marker along the depth gradient.
- Keeps max/min labels anchored to the exact top/bottom bounds of the gauge bar.
- Marker position is linear against depth (`min`..`max`), while gauge colors
  remain non-linearly distributed to match map coloring emphasis.
- Current depth label is empty when no sample is active.
- Min/max labels show `N/A` when the depth domain is unavailable.
- Values display in meters by default and can switch to feet.
- The gauge sits left of the map toolbar so all four controls and the depth
  labels stay readable. On short screens the [compass](map-compass.md) and
  source credits shift farther left to clear both the gauge and toolbar.

Implementation:

- `src/components/map/DepthGauge.tsx`
- probe state from `src/hooks/useDepthProbe.ts`, connected by
  `src/pages/Dashboard.tsx` and rendered by
  `src/pages/dashboard/DashboardMapCanvas.tsx`

## Mobile and touch interaction contract

This feature prioritizes touch behavior while keeping mouse parity:

- Mouse:
  - depth sample updates on map pointer move.
  - sample clears on map mouse leave.
- Touch/Pen:
  - depth sample updates while pointer is down and moving (touch probe),
  - sample clears on pointer end/cancel,
  - map pan/zoom and existing gesture behavior remain intact.

Existing marker interactions are preserved:

- tap-to-open marker details (minimum zoom gate applies),
- long-press GPS modal (empty-map spot only, minimum zoom gate applies),
- drag/pinch still treated as map gestures.

All marker interactions that open a modal (taps and long-press GPS) share the
same minimum zoom gate: `MAP.MARKER_INTERACTION_MIN_ZOOM` (`15`).

Long-press map-point constraints:

- Requires zoom `>= MAP.MARKER_INTERACTION_MIN_ZOOM` (`15`).
- Uses a bbox hit-test around the press location
  (`MAP.LONG_PRESS_EMPTY_SPOT_RADIUS_PX = 18`).
- If the bbox intersects rendered overlay/project features, the map-point modal
  does not open.

## Testing plan and coverage

Unit:

- `src/utils/depthColoring.test.ts`
- `src/utils/depthLimit.test.ts`
- `src/hooks/useDepthProbe.test.ts`
- `src/components/map/DepthGauge.test.tsx`
- `src/components/map/DistanceScale.test.tsx`
- `src/services/PreferencesService.test.ts`

Integration/component:

- `src/pages/Settings.test.tsx`
- `src/App.state-sync.test.tsx`
- `src/pages/Dashboard.test.tsx`

E2E:

- `tests/browser/map-display.spec.ts` checks actual map pixels, capped gauge
  values, offline preference restoration, station controls, and depth-input
  errors above the tab bar across phone, landscape, and tablet viewports in
  Chromium and WebKit.
- `tests/browser/shot-colors.spec.ts` covers color-mode selection, rendering,
  persistence and offline reuse in Chromium and WebKit.
- `tests/browser/offline-maps.spec.ts` covers depth-overlay layout.

## Change checklist

1. Keep default mode as `project`.
2. Keep depth extraction deterministic and centralized in `depthColoring.ts`.
3. Keep touch probe behavior non-blocking for map gestures.
4. Verify settings changes propagate to dashboard immediately.
5. Run targeted tests for preferences, settings, dashboard, and map utilities.
6. Update this doc if color ramp, depth keys, or interaction contracts change.
