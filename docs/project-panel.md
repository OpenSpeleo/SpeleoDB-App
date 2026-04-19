# Project Panel

The project panel is a slide-in side panel on the dashboard that lets users manage which survey projects are visible on the map and navigate to individual projects.

## Opening and closing

| Trigger | Result |
| "Projects" tab in bottom navigation bar | Panel slides in from the left |
| Close button (X in panel header) | Panel slides out |
| Backdrop tap (dark overlay behind panel) | Panel slides out |
| Clicking a project name | Panel slides out (auto-close) |
| Tapping "Projects" tab again (when open) | Panel slides out |
| Tapping "Map" tab (when open) | Panel slides out |

State is owned by `isProjectPanelOpen` in `App.tsx` (`AppRoutes`) and shared with both `Dashboard.tsx` and `Settings.tsx`. The panel itself (`ProjectPanel.tsx`) is a stateless presentational component controlled via `isOpen` / `onClose` props. The bottom nav bar toggles the panel through the shared `onProjectPanelChange` callback prop.

### Auto-close on project selection

When the user taps a project name to zoom to it, the panel closes automatically before the map animation starts. This keeps the selected survey immediately visible without the user needing to manually dismiss the panel first.

## Layout

- Position: absolute overlay, anchored top-left, full height.
- Width: `w-72` (`18rem`), capped at `max-w-[80vw]` on small screens.
- Z-index: panel at `z-30`, backdrop at `z-20`.
- Slide animation: 300ms ease-in-out translate on the X axis (`translate-x-0` open, `-translate-x-full` closed).
- Backdrop: `bg-black/40` fades in/out with the panel.

## Header

- Title: "Projects".
- Subtitle: "{N} of {M} visible" showing the count of active layers vs total.
- Close button: top-right, `aria-label="Close panel"`.

## Header subtitle

The subtitle reads `{N} of {M} visible` where:

- `M` is the total number of projects in the list.
- `N` counts **effectively visible** projects (individual toggle ON **AND** country gate ON), not just individually-on projects.

## Bulk actions

Two buttons directly below the header. Their semantics are intentionally asymmetric:

- **Show all**: activates every project (`projectVisibility[id] = true`) **and** re-enables every country gate (`countryVisibility[country] = true`). The country re-enable is required so a user who previously gated off a country can recover with a single tap.
- **Hide all**: deactivates every project (`projectVisibility[id] = false`) and **leaves country gates untouched**. The AND naturally hides everything; the user's per-country choices survive a "Hide all".

## Project list

The project list runs in one of two render modes:

- **Flat list** (back-compat path): used when **no** project in the dataset carries a `country`. Each row renders directly under the bulk actions, alphabetically by name.
- **Grouped by country**: used as soon as any project has a `country`. See "Country grouping" below.

In both modes, projects with `exclude_geojson: true` or no `geojson_file` are filtered out before reaching the panel.

Each row contains:

### Color dot

- A small circle whose color comes from `project.color` (model-driven; see `docs/project-colors.md`). Missing or invalid hex values fall back to the neutral gray defined as `COLORS.FALLBACK` (`#94a3b8`).
- Filled when **effectively visible** (individual toggle ON AND country gate ON), hollow (border-only) otherwise.
- `data-testid="project-color-dot-{id}"` for test targeting.

### Project name (click to zoom)

Tapping the name or the color dot triggers `onZoomToProject(projectId)`, which:

1. Ensures the project layer is visible: activates the project if not already active and persists the visibility preference as `true`.
2. **If the target project's country gate is OFF, force it ON** and persist that change. Without this, the user would tap a row and zoom into nothing because the AND would still hide the project.
3. Closes the panel immediately (auto-close) so the map is unobstructed.
4. Computes the bounding box from the project's GeoJSON data (with 10% padding).
5. Calls `map.fitBounds()` with `padding: 60`, `maxZoom: 16`, `duration: 800` (800ms fly animation).

### Toggle switch

A native IonToggle whose `checked` state always reflects the **individual** preference (not the effective visibility). Tapping it persists the per-project preference. Does **not** close the panel — the user stays in the panel to continue managing layers.

### Overlay effect of project toggles

Effective visibility (individual AND country) filters project-linked dashboard overlays:

- Subsurface stations (`properties.project`)
- Exploration leads (`properties.project`)
- Cylinder installs (`properties.project_id`)

Global overlays that are not project-linked remain unaffected:

- Landmarks
- Surface stations

## Country grouping

When at least one project carries a `country`, the panel renders one collapsible group per distinct ISO alpha-2 code, sorted alphabetically. Projects whose `country` is empty are grouped under a synthetic `Unknown` bucket displayed without a flag.

### Header layout

Each group header carries (left to right):

- Chevron icon (rotates 90° on collapse).
- Country flag emoji generated from the ISO code via `src/utils/countryFlag.ts`. Skipped for the `Unknown` bucket.
- Country code (or `Unknown`).
- `(N)` count of projects in the group.
- An `IonToggle` for the **country gate**.

Tapping the header (anywhere except the toggle) toggles collapse. Tapping the toggle invokes `onToggleCountry(country, visible)`. The toggle stops click propagation so it never also collapses the section.

`data-testid` selectors:

- `country-group-{ISO}` on the group `<li>`.
- `country-collapse-{ISO}` on the header (the click target for collapse).
- `country-toggle-{ISO}` on the gate toggle.

### Two-level visibility model

A project is **effectively visible** on the map iff both:

1. its individual toggle is ON, **AND**
2. its country gate is ON.

Defaults: a country is visible unless `countryVisibility[country] === false`; a country is expanded unless `countryCollapsed[country] === true`.

The AND is computed exactly once in `Dashboard.tsx` via the `effectiveActiveProjectIds` memo. Every map-side consumer reads from that set:

- Project `<Source>`/`<Layer>` mount/unmount.
- Project-linked overlay filtering (`filterOverlayByProjectVisibility`).
- Depth-domain merge in `useDepthProbe`.
- Auto-fit-bounds on first load.

The panel itself keeps the **raw** `activeProjectIds` so its individual toggle reflects user intent independent of the gate.

### Toggling a country gate

Toggling a country gate OFF:

- Persists `countryVisibility[country] = false`.
- Removes every project in that country from the map and from project-linked overlays.
- In depth color mode, recomputes the merged depth domain from only the remaining effectively-visible projects.
- **Does not** mutate `projectVisibility`.
- Mutes the corresponding project rows in the panel (hollow dot, dimmed text), but keeps each row's toggle `checked` state intact.

Toggling a country gate ON: the cascade reverses; projects whose individual toggle is OFF stay hidden; projects whose individual toggle is ON reappear.

### Tile prefetch status

If the project has a tile prefetch job in progress, a small label appears below the name showing the cache status (e.g. "Caching map (42%)", "Map ready (100%)").

## Empty state

When no projects are available, the list area shows "No projects available" centered text.

## Architecture

```
src/components/ProjectPanel.tsx   -- Presentational component (stateless)
src/App.tsx                       -- Shared panel state owner + prop wiring (`isProjectPanelOpen`)
src/pages/Dashboard.tsx           -- Map + project visibility handlers passed to panel
src/components/AppTabBar.tsx      -- Navigation trigger (Projects tab calls `onProjectPanelChange`)
```

`ProjectPanel` receives all data and callbacks as props. It does not hold state, perform network calls, or interact with the map directly. All business logic lives in `Dashboard.tsx` handlers:

- `handleZoomToProject` -- activate + force-on country gate + auto-close + fitBounds
- `handleToggleProject` -- toggle individual layer visibility
- `handleShowAll` / `handleHideAll` -- bulk visibility changes (Show all also re-enables country gates)
- `handleToggleCountry` -- flip the country gate; cascades through `effectiveActiveProjectIds`
- `handleToggleCountryCollapsed` -- UI-only collapse persistence

`Dashboard.tsx` also owns the two new local-state maps (`countryVisibility`, `countryCollapsed`) and the `effectiveActiveProjectIds` memo that computes the AND. Country UX state never reaches the controller.

## Persistence

All preferences live in a single `localStorage` blob managed by `PreferencesService` and serialized through its mutation queue:

- Per-project visibility:
  - `getProjectVisibilityPreferences()` / `setProjectVisibilityPreference(id, bool)` / `setProjectVisibilityPreferences(record)`.
- Per-country visibility (the gate; missing key implies visible):
  - `getCountryVisibilityPreferences()` / `setCountryVisibilityPreference(country, bool)` / `setCountryVisibilityPreferences(record)`.
- Per-country collapse state (missing key implies expanded):
  - `getCountryCollapsedPreferences()` / `setCountryCollapsedPreference(country, bool)`.

`Dashboard.tsx` reads all three at mount time via lazy state initializers (`useState(() => getXxxPreferences())`) so storage is touched once per render lifecycle.

`clearPreferences()` wipes the entire blob, so logout cleans up all three maps for free.

## Testing

- `ProjectPanel.test.tsx` -- unit tests for the presentational component (rendering, callback wiring, open/close CSS classes).
- `Dashboard.test.tsx` -- integration tests for panel behavior within the dashboard:
  - Panel opens when Projects tab is clicked.
  - Show All / Hide All persist preferences.
  - Zoom-to-project persists `visible: true`.
  - Panel auto-closes after zooming to a project.

## Change checklist

1. Keep `ProjectPanel` stateless; panel open/close state belongs in `App.tsx` (`AppRoutes`).
2. If adding new panel actions, wire them as `onXxx` callback props.
3. Verify auto-close still works after any changes to zoom or panel logic.
4. Run `npx vitest run src/components/ProjectPanel.test.tsx src/pages/Dashboard.test.tsx`.
5. Update this document if layout, behavior, or persistence rules change.
