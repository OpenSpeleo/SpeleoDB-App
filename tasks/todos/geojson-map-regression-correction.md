# GeoJSON Map Regression Correction

## Intent

Restore project and subsurface-icon rendering without reverting the dashboard
layer extraction. Preserve the independent cache-publication and map-readiness
fixes in `2bb3c7a`, remove the speculative worker packaging from `2bc11ad`, and
retain only the validated deadline and legacy-timeout recovery policy.

## Implementation checklist

- [x] Prove the `react-map-gl` source-injection regression at the layer seam.
- [x] Restore direct `Layer` children for project and subsurface sources.
- [x] Audit every application `Source` for indirect children.
- [x] Document the MapLibre source-child contract and durable lesson.
- [x] Commit the independently green rendering correction (`857d601`).
- [x] Reintroduce transient validation deadlines without lazy/inline workers.
- [x] Prove historical 500 ms timeout recovery and content-failure quarantine.
- [x] Commit-ready independently green deadline correction
      (`[Fix] Treat GeoJSON validation deadlines as transient`; hash recorded at
      handoff).
- [x] Verify rewritten ancestry and leave the worktree clean without pushing.

## Required gates per commit

- `make pre-commit`
- `make ci`
- `make sync` with no unexplained native drift
- Android lint, first-party unit tests, release APK, and release AAB
- iOS XCTest and unsigned simulator Release build
- explicit staged paths, staged diff review, and `git diff --cached --check`

## Review

### MapLibre source propagation

- Commit: `857d60158e47fff84561dd9e06aabca33e2b3a79`
  (`[Fix] Restore MapLibre source propagation`).
- Red/green: the contract-accurate source mock produced 2 failures and 4 passes
  before the correction, then 6/6 passes afterward. The combined Dashboard
  suites pass 113/113.
- Full web gate: Node 22 CI passes 1,765/1,765 tests across 103 files with
  89.64% statements, 82.54% branches, 93.06% functions, and 91.70% lines.
- Native gate: Capacitor sync has no tracked drift; Android lint, 9 first-party
  tests, release APK, and release AAB pass; 9/9 signed iOS tests pass on iPhone
  17 Pro/iOS 26.5 and the unsigned simulator Release build succeeds.
- Limitation: no connected physical device contains the user's real project
  payload, so device confirmation remains pending.

### Transient validation deadlines

- Red/green: the policy tests produced 7 expected failures with 247 passing
  tests before the correction, covering deadline classification, the durable
  cache boundary, same-commit historical recovery, and warning copy. The same
  four focused files then pass 254/254 tests. Existing oversized and malformed
  content tests stayed green and remain durably quarantined.
- Correction: the existing statically imported analyzer and Vite `?worker&url`
  artifact remain unchanged. The off-thread deadline is 10 seconds and reports
  session-only `validation_unavailable`; analysis and cache types exclude new
  timeout quarantine writes, and the cache runtime rejects them. Historical
  schema-v2 `bbox_timeout` records at the old 500 ms boundary remain parseable
  and retry the exact commit online. Successful validation atomically replaces
  the old marker with active map data.
- Full web gate: the inventory covers all 515 tracked files; Node 22 CI passes
  1,767/1,767 tests across 103 files with 89.65% statements, 82.63% branches,
  93.07% functions, and 91.72% lines. The production build retains the normal
  8.28 KiB `projectGeoJSONBounds.worker` asset; no lazy analyzer, inline-worker
  packaging, or generated-code bundle guard was introduced.
- Native gate: Capacitor synchronization produced no tracked native drift.
  Android lint, first-party unit tests, release APK assembly, and release AAB
  bundling pass. Signed iOS XCTest passes 9/9 cases on iPhone 17 Pro/iOS 26.5,
  and the unsigned generic-simulator Release build succeeds.
- Limitation: no physical device with the user's real project payload was
  available, so on-device rendering confirmation remains explicitly pending. The
  configured contract tenant does not substitute for that payload.
