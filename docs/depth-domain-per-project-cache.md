# Per-Project Depth Domain Cache -- Plan and Implementation

This document records the design rationale, implementation details, performance
analysis, and test coverage for the per-project depth domain caching
optimization shipped alongside the depth coloring feature.

## Problem statement

In depth color mode, the depth domain (`{ min, max }`) determines how feature
colors are mapped across the gradient and what the gauge min/max labels display.
Prior to this change, the domain was recomputed by iterating **every feature
across all active projects** whenever `activeProjectIds` changed (i.e., on every
project show/hide toggle). For N projects with F features each, every toggle
cost O(N * F).

This is unacceptable for large survey datasets. A user toggling a single project
should not trigger a full re-scan of tens of thousands of features.

## Solution overview

Cache each project's individual depth domain once at GeoJSON load time. When a
project is toggled, merge only the per-project domain objects to produce the
combined domain -- O(P) where P is the number of active projects, regardless of
feature count.

```
GeoJSON load (one-time, O(F)):
  for each project:
    projectDepthDomains[projectId] = computeDepthDomain([fc])

Project toggle (O(P)):
  activeDomains = [projectDepthDomains[id] for id in activeProjectIds]
  depthDomain = mergeDepthDomains(activeDomains)
```

## Files changed

### `src/utils/depthColoring.ts`

Added `mergeDepthDomains`:

```typescript
export function mergeDepthDomains(
  domains: (DepthDomain | null)[],
): DepthDomain | null {
  let max = 0;
  let hasDepth = false;

  for (const domain of domains) {
    if (!domain) continue;
    hasDepth = true;
    if (domain.max > max) max = domain.max;
  }

  if (!hasDepth) return null;
  return { min: 0, max };
}
```

This mirrors the 0-limited clamping logic of `computeDepthDomain` (min is
always 0) but operates on pre-computed domain objects instead of raw features.
`computeDepthDomain` remains available for single-shot use.

### `src/hooks/useDepthProbe.ts`

Replaced the single `depthDomain` useMemo with a two-stage computation:

**Stage A -- Per-project domain cache** (`projectDepthDomains`):

- Dependency: `[geoJsonData]` -- only changes on sync/reload, not on toggle.
- Cost: O(total features) -- runs once per data load.
- Produces: `Record<string, DepthDomain | null>` keyed by project ID.

**Stage B -- Merged domain for visible projects** (`depthDomain`):

- Dependency: `[activeProjectIds, colorMode, projectDepthDomains]`.
- `projectDepthDomains` is reference-stable unless `geoJsonData` changes.
- Cost: O(active projects) per toggle -- iterates project IDs, not features.
- Output type and semantics unchanged from before.

Downstream consumers (`DepthGauge`, `createDepthColorExpression` in focused map
layers) require no changes.

### Dashboard map composition

`Dashboard.tsx` connects `depthDomain` to `DashboardMapCanvas`, which passes it
to `ProjectMapLayers` and `DepthGauge`. When the merged domain shifts because a
project was toggled, React re-renders `Layer` components with updated `paint`
props. react-map-gl diffs the paint and pushes the new style expression to
maplibre-gl automatically.

## Performance analysis

| Operation                    | Before                                                      | After                                                             |
| ---------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| GeoJSON load (one-time)      | O(F) for `attachDepth`                                      | O(F) for `attachDepth` + O(F) for per-project domain (same order) |
| Project toggle in depth mode | O(F_active) via `computeDepthDomain` iterating all features | O(P_active) via `mergeDepthDomains` iterating project domains     |
| Mode switch to depth         | O(F_active)                                                 | Same -- `projectDepthDomains` is already cached                   |
| Memory                       | GeoJSON data only                                           | + one `{ min, max }` object per project (negligible)              |

Where F = total features, P = total projects.

For a dataset with 20 projects and 50,000 total features, toggling a project
drops from ~50,000 iterations to ~20 iterations.

## Test coverage

### Unit tests (`src/utils/depthColoring.test.ts`)

New `describe('mergeDepthDomains')` block with 5 cases:

1. Returns `null` for empty array.
2. Returns `null` when all entries are `null`.
3. Returns single domain when only one is non-null.
4. Merges multiple domains taking max of maxes.
5. Always returns `min: 0` regardless of input min values.

### Integration tests (`src/pages/Dashboard.test.tsx`)

Three new tests exercise the full reactive chain: toggle -> `activeProjectIds`
-> `useDepthProbe` -> `depthDomain` -> `DepthGauge` labels.

1. **"recalculates depth domain when a project is hidden in depth mode"** -- Two
   projects with depth 25 and 80. Gauge shows max 80. Toggle the deeper project
   off. Gauge updates to max 25.

2. **"recalculates depth domain when a project is shown in depth mode"** -- Same
   two projects, deeper one starts hidden. Gauge shows max 25. Toggle deeper
   project on. Gauge updates to max 80.

3. **"shows N/A depth domain when all projects are hidden in depth mode"** --
   Single project with depth 50. Toggle it off. Gauge shows N/A for both min and
   max.

Test helper `depthFeatureCollection(depthValue)` creates a FeatureCollection
with a pre-attached `_speleoDepth` property for deterministic domain values.

## Documentation updates

### `docs/map-depth-and-scale.md`

Expanded the "Project layer coloring" section to document the reactive
recomputation behavior, per-project caching, O(projects) merge on toggle, and
immediate UI updates.

### `docs/dashboard-map-overlays.md`

Added a bullet in the "Project visibility interaction" section documenting that
depth mode recalculates domain on toggle.

## Design decisions

1. **Why not compute domains inside `attachDepthToFeatureCollection`?** -- That
   function's responsibility is normalizing depth properties onto features.
   Coupling domain computation to it would violate single-responsibility and
   make structural sharing harder to reason about.

2. **Why `mergeDepthDomains` instead of modifying `computeDepthDomain`?** --
   `computeDepthDomain` operates on raw feature collections and remains useful
   for one-shot domain computation (e.g., in tests). The merge function operates
   on the pre-computed domain cache, which is a different abstraction level.

3. **Why is `min` always 0 in the merged domain?** -- This matches the existing
   0-limited clamping contract documented in `map-depth-and-scale.md`. The
   `DepthDomain` interface retains the `min` field for future flexibility (e.g.,
   if the clamping behavior changes).

4. **Why two-stage `useMemo` instead of a single memo with per-project caching
   inside?** -- Separating the stages makes the dependency graph explicit. Stage
   A only reacts to data changes. Stage B only reacts to visibility/mode
   changes. This prevents false recomputations and makes the performance
   contract clear to future contributors.
