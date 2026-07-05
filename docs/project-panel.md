# Project Panel

The project panel is a slide-in side panel on the dashboard that lets users
manage which survey projects are visible on the map and navigate to individual
projects.

## Opening and closing

| Trigger                                  | Result                        |
| ---------------------------------------- | ----------------------------- |
| "Projects" tab in bottom navigation bar  | Panel slides in from the left |
| Close button (X in panel header)         | Panel slides out              |
| Backdrop tap (dark overlay behind panel) | Panel slides out              |
| Clicking a project name                  | Panel slides out (auto-close) |
| Tapping "Projects" tab again (when open) | Panel slides out              |
| Tapping "Map" tab (when open)            | Panel slides out              |

State is the `'projects'` member of the single `DashboardPanel` union owned by
`AuthenticatedAppShell` and shared with Dashboard, Settings, and Pending. The
panel itself (`ProjectPanel.tsx`) is a stateless presentational component
controlled via `isOpen` / `onClose` props. The bottom nav bar transitions the
shared value through `onDashboardPanelChange`; see
`docs/dashboard-panel-state.md`.

### Auto-close on project selection

When the user taps a project name to zoom to it, the panel closes automatically
before the map animation starts. This keeps the selected survey immediately
visible without the user needing to manually dismiss the panel first.

## Layout

- Position: absolute overlay, anchored top-left, full height.
- Width: `w-72` (`18rem`), capped at `max-w-[80vw]` on small screens.
- Z-index: panel at `z-30`, backdrop at `z-20`.
- Slide animation: 300ms ease-in-out translate on the X axis (`translate-x-0`
  open, `-translate-x-full` closed).
- Backdrop: `bg-black/40` fades in/out with the panel.

## Header

- Title: "Projects".
- Subtitle: "{N} of {M} visible" showing the count of active layers vs total.
- Close button: top-right, `aria-label="Close panel"`.

## Header subtitle

The subtitle reads `{N} of {M} visible` where:

- `M` is the total number of projects in the list.
- `N` counts **effectively visible** panel projects (current active map data,
  individual toggle ON, and country gate ON), not just individually-on projects.

## Bulk actions

Two action buttons directly below the header using `.app-btn.app-btn--compact`
(same shape as Settings modal buttons, slightly smaller label for the narrow
panel). **Show all** uses the purple primary fill and **Hide all** uses a slate
secondary style. The header, bulk row, and scrollable list use `shrink-0` /
`min-h-0` so long project lists cannot compress the action buttons. Their
semantics are intentionally asymmetric:

- **Show all**: activates every project (`projectVisibility[id] = true`) **and**
  re-enables every country gate (`countryVisibility[country] = true`). The
  country re-enable is required so a user who previously gated off a country can
  recover with a single tap.
- **Hide all**: deactivates every project (`projectVisibility[id] = false`) and
  **leaves country gates untouched**. The AND naturally hides everything; the
  user's per-country choices survive a "Hide all".

Project visibility is persisted user intent, not a statement that map bytes are
currently usable. Quarantine or a commit transition suppresses effective
visibility without changing the stored toggle. If a newer commit validates, the
project reappears with the prior intent without requiring an app reload.

## Project list

The project list runs in one of two render modes:

- **Flat list** (back-compat path): used when **no** project in the dataset
  carries a `country`. Each row renders directly under the bulk actions,
  alphabetically by name.
- **Grouped by country**: used as soon as any project has a `country`. See
  "Country grouping" below.

In both modes, projects with `exclude_geojson: true`, no `geojson_file`, or no
validated active GeoJSON cache record are filtered out before reaching the
panel. Faulty files quarantined by `docs/project-geojson-validation.md` never
produce a row. Active data is commit-gated: the atomically loaded
`{ commitId, featureCollection, bounds }` record must match
`project.latest_commit.id`. A stale record disappears from the panel as soon as
the project list advances, before any asynchronous cache read completes.

The controller's stable `mapDataRevision` makes Dashboard reload records after
initial, offline, Settings-triggered, and later sync completions. The final
state update swaps the complete project map-data record at once, so a new bbox
cannot be paired with old GeoJSON (or vice versa), and stale async completions
are ignored.

Each row contains:

### Color dot

- A small circle whose color comes from `project.color` (model-driven; see
  `docs/project-colors.md`). Missing or invalid hex values fall back to the
  neutral gray defined as `COLORS.FALLBACK` (`#94a3b8`).
- Filled when **effectively visible** (individual toggle ON AND country gate
  ON), hollow (border-only) otherwise.
- `data-testid="project-color-dot-{id}"` for test targeting.

### Project name (click to zoom)

Tapping the name or the color dot triggers `onZoomToProject(projectId)`, which:

1. Ensures the project layer is visible: activates the project if not already
   active and persists the visibility preference as `true`.
2. **If the target project's country gate is OFF, force it ON** and persist that
   change. Without this, the user would tap a row and zoom into nothing because
   the AND would still hide the project.
3. Closes the panel immediately (auto-close) so the map is unobstructed.
4. Reads the current commit-matched prevalidated cached bounding box and applies
   10% display padding; it never rescans GeoJSON coordinates. Directed longitude
   intervals preserve antimeridian coverage, and fit latitude is clamped to the
   finite Web-Mercator range.
5. Calls `map.fitBounds()` with `padding: 60`, `maxZoom: 16`, `duration: 800`
   (800ms fly animation).

### Toggle switch

A native IonToggle whose `checked` state always reflects the **individual**
preference (not the effective visibility). Tapping it persists the per-project
preference. Does **not** close the panel — the user stays in the panel to
continue managing layers.

### Overlay effect of project toggles

Effective visibility (individual AND country) filters project-linked dashboard
overlays:

- Subsurface stations (`properties.project`)
- Exploration leads (`properties.project`)
- Cylinder installs (`properties.project_id`)

Global overlays that are not project-linked remain unaffected:

- Landmarks
- Surface stations

## Country grouping

When at least one project carries a `country`, the panel renders one collapsible
group per distinct ISO alpha-2 code, sorted alphabetically. Projects whose
`country` is empty are grouped under a synthetic `Unknown` bucket displayed
without a flag.

### Header layout

Each group header carries (left to right):

- Chevron icon (rotates 90° on collapse).
- Country flag emoji generated from the ISO code via `src/utils/countryFlag.ts`.
  Skipped for the `Unknown` bucket.
- Country code (or `Unknown`).
- `(N)` count of projects in the group.
- An `IonToggle` for the **country gate**.

Tapping the header (anywhere except the toggle) toggles collapse. Tapping the
toggle invokes `onToggleCountry(country, visible)`. The toggle stops click
propagation so it never also collapses the section.

`data-testid` selectors:

- `country-group-{ISO}` on the group `<li>`.
- `country-collapse-{ISO}` on the header (the click target for collapse).
- `country-toggle-{ISO}` on the gate toggle.

### Effective visibility model

A project is **effectively visible** on the map iff all three conditions hold:

1. its map-data record is active and matches `latest_commit.id`;
2. its individual toggle is ON; and
3. its country gate is ON.

Defaults: a country is visible unless `countryVisibility[country] === false`; a
country is expanded unless `countryCollapsed[country] === true`.

The AND is computed exactly once by `useDashboardProjectVisibility` via the
`effectiveActiveProjectIds` memo. Every map-side consumer reads from that set:

- Project `<Source>`/`<Layer>` mount/unmount.
- Project-linked overlay filtering (`filterOverlayByProjectVisibility`).
- Depth-domain merge in `useDepthProbe`.
- Auto-fit-bounds on first load.

The panel itself keeps the **raw** `activeProjectIds` so its individual toggle
reflects user intent independent of the gate.

### Toggling a country gate

Toggling a country gate OFF:

- Persists `countryVisibility[country] = false`.
- Removes every project in that country from the map and from project-linked
  overlays.
- In depth color mode, recomputes the merged depth domain from only the
  remaining effectively-visible projects.
- **Does not** mutate `projectVisibility`.
- Mutes the corresponding project rows in the panel (hollow dot, dimmed text),
  but keeps each row's toggle `checked` state intact.

Toggling a country gate ON: the cascade reverses; projects whose individual
toggle is OFF stay hidden; projects whose individual toggle is ON reappear.

### Tile prefetch status

If the project has a tile prefetch job in progress, a small label appears below
the name showing the cache status (e.g. "Caching map (42%)", "Map ready
(100%)"). Progress is shown only when the project also has current active map
data, so a stale or quarantined job cannot keep a disabled row alive.

## Empty state

When no projects are available, the list area shows "No projects available"
centered text.

## Architecture

```
src/components/ProjectPanel.tsx   -- Presentational component (stateless)
src/AuthenticatedAppShell.tsx     -- Single `DashboardPanel` state owner + prop wiring
src/pages/Dashboard.tsx           -- Connects map data and visibility outputs to consumers
src/pages/dashboard/useDashboardMapData.ts -- Loads commit-matched cached map data
src/pages/dashboard/useDashboardProjectVisibility.ts -- Visibility state + actions
src/components/AppTabBar.tsx      -- Navigation + atomic panel transition policy
```

`ProjectPanel` receives all data and callbacks as props. It does not hold state,
perform network calls, or interact with the map directly. Visibility business
logic lives in the focused hook and is exposed through these actions:

- `zoomToProject` -- activate + force-on country gate + auto-close + fitBounds
- `toggleProject` -- toggle individual layer visibility
- `showAll` / `hideAll` -- bulk visibility changes (Show all also re-enables
  country gates)
- `toggleCountry` -- flip the country gate; cascades through
  `effectiveActiveProjectIds`
- `toggleCountryCollapsed` -- UI-only collapse persistence

Those actions, local country-state maps (`countryVisibility`,
`countryCollapsed`), raw per-project visibility intent, and the effective set
are owned by `useDashboardProjectVisibility`. `Dashboard.tsx` supplies current
commit-matched map data and routes the hook outputs to panel rows/progress, map
sources, combined fit, row zoom, depth mode/probing, and project-linked
overlays. Country UX state never reaches the controller. See
`docs/dashboard-project-visibility.md` for the ownership and test contract.

## Persistence

All preferences live in a single `localStorage` blob managed by
`PreferencesService` and serialized through its mutation queue:

- Per-project visibility:
  - `getProjectVisibilityPreferences()` /
    `setProjectVisibilityPreference(id, bool)` /
    `setProjectVisibilityPreferences(record)`.
- Per-country visibility (the gate; missing key implies visible):
  - `getCountryVisibilityPreferences()` /
    `setCountryVisibilityPreference(country, bool)` /
    `setCountryVisibilityPreferences(record)`.
- Per-country collapse state (missing key implies expanded):
  - `getCountryCollapsedPreferences()` /
    `setCountryCollapsedPreference(country, bool)`.

`useDashboardProjectVisibility` reads country state through lazy mount-time
initializers. It reads project visibility when the eligible-project set changes
so new or removed projects are reconciled without storage reads on ordinary
rerenders.

`clearPreferences()` wipes the entire blob, so logout cleans up all three maps
for free.

## Testing

- `ProjectPanel.test.tsx` -- unit tests for the presentational component
  (rendering, callback wiring, open/close CSS classes).
- `useDashboardProjectVisibility.test.ts` -- direct 100% statement, branch,
  function, and line coverage of restoration, derivation, persistence, bulk
  actions, country gates, haptics, and scheduled zoom failure modes.
- `Dashboard.test.tsx` -- integration tests for panel behavior within the
  dashboard:
  - Panel opens when Projects tab is clicked.
  - Show All / Hide All persist preferences.
  - Zoom-to-project persists `visible: true`.
  - Panel auto-closes after zooming to a project.
  - Commit advances hide stale data immediately and late loads cannot restore
    it.
  - Active-to-quarantined-to-new-valid transitions preserve visibility intent.
  - Antimeridian/opposite-side/high-latitude fits use directed, clamped bounds.

## Change checklist

1. Keep `ProjectPanel` stateless; panel open/close state belongs in `App.tsx`
   (`AppRoutes`).
2. If adding new panel actions, wire them as `onXxx` callback props.
3. Verify auto-close still works after any changes to zoom or panel logic.
4. Run
   `npx vitest run src/components/ProjectPanel.test.tsx src/pages/Dashboard.test.tsx`.
5. Update this document if layout, behavior, or persistence rules change.
