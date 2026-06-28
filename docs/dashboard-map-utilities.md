# Dashboard Map Utilities

## Intent

`Dashboard.tsx` remains the React and MapLibre composition root, but it must not
also own every deterministic map policy. `dashboardMapUtils.ts` isolates the
policy that can be evaluated without mounting the page. This is the first
bounded step in decomposing Dashboard; it does not change map behavior or the
public UI contract.

## Ownership boundary

The utility module owns:

- station color normalization and project-linked overlay filtering;
- ordered marker-detail selection and touch hit-box construction;
- overlay icon sources, registration, fetch/Image/MapLibre fallback, and
  one-warning-per-icon diagnostics;
- project and GPS-track bounds, including antimeridian-aware project bounds;
- touch thresholds, long-press blocking layer IDs, and north-up orientation.

Dashboard still owns page state and modal composition. Focused components under
`src/pages/dashboard/` own MapLibre layer composition, and
`useDashboardMapInteractions` owns pointer state, timers, and marker selection;
see `docs/dashboard-map-layers.md` and `docs/dashboard-map-interactions.md`.
Service and cache ownership remains outside these presentation modules.

## Invariants

- Non-project overlays preserve their original `FeatureCollection` identity.
- Project-linked overlays render only for projects that are effectively visible.
- Map icons are registered once. Failed fetch decoding falls back to MapLibre's
  loader and emits at most one redacted warning per icon ID.
- Project bounds use the shortest longitude interval and clamp latitude to the
  Web Mercator limit. GPS bounds ignore non-finite points.
- Orientation locking is safe for partially initialized MapLibre controls.

## Verification and performance

`dashboardMapUtils.test.ts` executes every statement, branch, and function. The
existing `Dashboard.test.tsx` suite remains the characterization and integration
boundary for rendering and event behavior. The extraction adds no polling,
listeners, storage work, or render-time network requests. Overlay filtering and
bounds remain linear in their input sizes.
