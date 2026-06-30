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
- [ ] Commit the independently green rendering correction.
- [ ] Reintroduce transient validation deadlines without lazy/inline workers.
- [ ] Prove historical 500 ms timeout recovery and content-failure quarantine.
- [ ] Commit the independently green deadline correction.
- [ ] Verify rewritten ancestry and leave the worktree clean without pushing.

## Required gates per commit

- `make pre-commit`
- `make ci`
- `make sync` with no unexplained native drift
- Android lint, first-party unit tests, release APK, and release AAB
- iOS XCTest and unsigned simulator Release build
- explicit staged paths, staged diff review, and `git diff --cached --check`

## Review

### MapLibre source propagation

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
