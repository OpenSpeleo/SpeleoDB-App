# Project Colors

Projects render with a model-stored hex color delivered by the
`/api/v2/projects/geojson/` endpoint as `project.color`. The mobile app does not
maintain a JS-side palette; this document defines the contract so the mobile and
web map viewers always render the same project the same way.

## Source of truth

- The Django backend assigns each project a default color at creation time from
  a 20-color perceptually-distinct palette (see
  `speleodb.common.enums.ColorPalette`).
- The DRF `ProjectSerializer` exposes the field as a 7-character hex string
  (`#rrggbb`, lowercase). Example payload:

  ```json
  {
    "id": "fd8138af-1306-4e54-94da-860d30a4b7b5",
    "country": "US",
    "color": "#8da0cb",
    "name": "Allen Mill Pond",
    ...
  }
  ```

## Type contract

`Project.color: string` is required on `src/types/project.ts`. The TypeScript
type matches the API contract going forward. Cached payloads from before the
backend `color` rollout may still be missing the field; the runtime hex
validator in `src/utils/projectColors.ts` covers that gap.

## Resolution

`createProjectColorState(projects)` (`src/utils/projectColors.ts`) builds an
`id -> hex` map straight from `project.color`. The mapping is stable across
renders because the panel sort is a pure function of `projects`.

```typescript
function isValidHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}
```

Any value failing `isValidHex` (missing field, malformed payload, CDN cache
poisoning) resolves to `COLORS.FALLBACK` (`#94a3b8`, neutral slate gray). The
fallback is never cached at the call site, so a subsequent valid value silently
upgrades.

## Consumers

- `ProjectPanel`: the per-row color dot (filled when effectively visible, hollow
  border when masked off by either the individual toggle or the country gate).
- `Dashboard`: `<Layer>` `paint['line-color']` and `paint['fill-color']` in
  project color mode. In depth color mode the same color feeds
  `createDepthColorExpression` as the no-depth fallback so projects without
  depth data still render in their model color.

## Why no JS palette?

Two clients (web and mobile) sharing model-stored colors guarantees that a
project always renders the same way regardless of viewport width, sort order, or
filter state. This is essential when caves are discussed across screen-shares of
both apps.

## Resilience

If the backend rolls back the `color` field, every project falls back to the
neutral gray and the app remains functional but loses color distinction between
projects until the field returns. A single successful sync repopulates
`ProjectCacheService` with fresh, color-bearing payloads and dots return to
normal on the next render.

## Tests

- `src/utils/projectColors.test.ts` — model-driven mapping, hex validation,
  fallback path, case-insensitive name sort, lookup for unknown ids.
- `src/components/ProjectPanel.test.tsx` — dot color reflects
  `projectColorsById`; muted style under country gate OFF uses the colored
  border without a fill.
- `src/pages/Dashboard.test.tsx` — layer color matches the panel dot for the
  same project.
