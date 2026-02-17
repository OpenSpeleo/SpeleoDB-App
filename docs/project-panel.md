# Project Panel

The project panel is a slide-in side panel on the dashboard that lets users manage which survey projects are visible on the map and navigate to individual projects.

## Opening and closing

| Trigger | Result |
|---|---|
| Hamburger button (top-left header) | Panel slides in from the left |
| Close button (X in panel header) | Panel slides out |
| Backdrop tap (dark overlay behind panel) | Panel slides out |
| Clicking a project name | Panel slides out (auto-close) |

State is owned by `isPanelOpen` in `Dashboard.tsx`. The panel itself (`ProjectPanel.tsx`) is a stateless presentational component controlled via `isOpen` / `onClose` props.

### Auto-close on project selection

When the user taps a project name to zoom to it, the panel closes automatically before the map animation starts. This keeps the selected survey immediately visible without the user needing to manually dismiss the panel first.

## Layout

- Position: absolute overlay, anchored top-left, full height.
- Width: `w-72` (`18rem`), capped at `max-w-[80vw]` on small screens.
- Z-index: panel at `z-30`, backdrop at `z-20` (above the map and floating header at `z-10`).
- Slide animation: 300ms ease-in-out translate on the X axis (`translate-x-0` open, `-translate-x-full` closed).
- Backdrop: `bg-black/40` fades in/out with the panel.

## Header

- Title: "Projects".
- Subtitle: "{N} of {M} visible" showing the count of active layers vs total.
- Close button: top-right, `aria-label="Close panel"`.

## Bulk actions

Two buttons directly below the header:

- **Show all**: activates every project and persists each as `visible: true`.
- **Hide all**: deactivates every project and persists each as `visible: false`.

Both operate on all projects in the list regardless of which were individually toggled.

## Project list

A scrollable list of all projects that have GeoJSON data (projects with `exclude_geojson: true` or no `geojson_file` are filtered out before reaching the panel).

List scrolling is self-contained and must not leak gesture handling to dashboard pull-to-refresh.

Each row contains:

### Color dot

- A small circle showing the project's assigned color from the palette.
- Filled when active, hollow (border-only) when inactive.
- `data-testid="project-color-dot-{id}"` for test targeting.

### Project name (click to zoom)

Tapping the name or the color dot triggers `onZoomToProject(projectId)`, which:

1. Sets the project's visibility preference to `true` (persisted).
2. Closes the panel immediately (auto-close).
3. Activates the project layer if not already active.
4. Computes the bounding box from the project's GeoJSON data (with 10% padding).
5. Calls `map.fitBounds()` with `padding: 60`, `maxZoom: 16`, `duration: 800` (800ms fly animation).

### Toggle switch

A purple/slate toggle to show or hide the project's map layer without zooming. Persists the visibility preference per project. Does **not** close the panel -- the user stays in the panel to continue managing layers.

### Overlay effect of project toggles

Project toggle state also filters project-linked dashboard overlays:

- Subsurface stations (`properties.project`)
- Exploration leads (`properties.project`)
- Cylinder installs (`properties.project_id`)

Global overlays that are not project-linked remain unaffected:

- Landmarks
- Surface stations

### Tile prefetch status

If the project has a tile prefetch job in progress, a small label appears below the name showing the cache status (e.g. "Caching map (42%)", "Map ready (100%)").

## Empty state

When no projects are available, the list area shows "No projects available" centered text.

## Architecture

```
src/components/ProjectPanel.tsx   -- Presentational component (stateless)
src/pages/Dashboard.tsx           -- State owner (isPanelOpen, activeProjectIds, handlers)
```

`ProjectPanel` receives all data and callbacks as props. It does not hold state, perform network calls, or interact with the map directly. All business logic lives in `Dashboard.tsx` handlers:

- `handleZoomToProject` -- activate + auto-close + fitBounds
- `handleToggleProject` -- toggle layer visibility
- `handleShowAll` / `handleHideAll` -- bulk visibility changes

## Persistence

Project visibility preferences are persisted per-project via `PreferencesService`:

- `setProjectVisibilityPreference(projectId, boolean)` -- single project
- `setProjectVisibilityPreferences(record)` -- bulk (Show All / Hide All)
- `getProjectVisibilityPreferences()` -- read on dashboard mount to restore state

Preferences are cleared on logout (full preference wipe).

## Testing

- `ProjectPanel.test.tsx` -- unit tests for the presentational component (rendering, callback wiring, open/close CSS classes).
- `Dashboard.test.tsx` -- integration tests for panel behavior within the dashboard:
  - Panel opens when menu button is clicked.
  - Show All / Hide All persist preferences.
  - Zoom-to-project persists `visible: true`.
  - Panel auto-closes after zooming to a project.

## Change checklist

1. Keep `ProjectPanel` stateless; all state belongs in `Dashboard.tsx`.
2. If adding new panel actions, wire them as `onXxx` callback props.
3. Verify auto-close still works after any changes to zoom or panel logic.
4. Run `npx vitest run src/components/ProjectPanel.test.tsx src/pages/Dashboard.test.tsx`.
5. Update this document if layout, behavior, or persistence rules change.
