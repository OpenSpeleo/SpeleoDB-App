# Silence Project Bbox Test Output

## Plan

- [x] Filter only `[project-geojson:bbox]` records at Vitest's console-reporting
      seam.
- [x] Verify the controller suite still exercises bbox logging without printing
      the records.
- [x] Run lint, build, and the complete test suite with coverage.

## Verification gates

- Focused controller output contains no `[project-geojson:bbox]` records.
- Production `ProjectGeoJSONCoordinator` logging remains unchanged.
- All repository tests pass without unexpected console output.

## Review

Vitest's `onConsoleLog` hook now drops only records whose rendered text starts
with `[project-geojson:bbox]`. Production logging and the console guard remain
unchanged, so bbox diagnostics still appear on devices and quarantined bbox
warnings still require explicit test expectations.

Verification:

- `npm run test.unit -- --run src/controllers/SpeleoDBController.test.ts`
  - 1 file passed; 186 tests passed.
  - Captured command output contained no `[project-geojson:bbox]` marker.
- `npm run lint -- vite.config.ts`
  - Passed.
- `npm run build`
  - TypeScript and the Vite production build passed.
- `npm run test.unit -- --run --coverage --no-file-parallelism`
  - 103 files passed; 1,767 tests passed.
  - Coverage: 89.65% statements, 82.63% branches, 93.07% functions, 91.72%
    lines.

Native and physical-device verification are inapplicable because this changes
only Vitest's reporting hook; no application or native runtime code changed.

Commit references: none.
