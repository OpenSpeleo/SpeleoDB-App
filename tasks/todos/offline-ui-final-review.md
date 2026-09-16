# Review and commit offline-map UI refinements

- [x] Adversarial source review: code, geometry/camera compatibility, lifecycle,
      scrolling, persistent indicator and regression tests.
- [x] Primary review: migration/feature documentation, browser assertions and
      all staged/unstaged/untracked changes against `9600209`.
- [x] Record actionable findings, review the corrective plan, implement and
      verify corrections at their owning seams.
- [x] Run full coverage tests, browser tests, lint/typecheck/build and
      `prek run -a`; inspect hook changes and rerun relevant gates.
- [x] Inspect/stage explicit reviewed paths and establish a green commit gate.

## Ownership and authorization

The user explicitly invoked review-agent and requested a commit. The review
agent owns source corrections/tests and its own plan; the primary owns docs,
browser tests, integration and commit. No concurrent edits to shared files. The
previous 2,023 unit tests and 38 browser checks are a baseline, not a substitute
for adversarial cases and final verification.

## Findings and verification

One P2 finding: error messages were outside the scrolling region and could
consume the fixed header's available height, clipping row actions on short
screens. The reviewed correction moves the existing alert into `OfflineAreaList`
without changing persistence or error handling. The component regression failed
before the correction and passed afterward; all 178 focused tests passed.

Browser coverage also fails one real catalog write and checks that the long
error, retained areas, and delete actions remain reachable at 320 × 300. The
feature documentation explains why errors share the scroll region. No other
actionable findings were confirmed. The migration guide matches the existing
database/catalog versions and explicitly distinguishes backward compatibility
from unsupported downgrades and future formats.

Native code is unchanged; browser rendering and observer lifecycle are the
relevant seams. Native builds/tests and physical-device verification were not
run for these web UI/documentation changes; no device behavior is claimed.

Final verification:

- `npm run test:browser`: 38 passed in Chromium/WebKit, zero retries. Inspected
  WebKit screenshots for the short scrolling sheet and landscape camera layout.
- `npm run lint`: passed.
- `npm run build`: passed, including TypeScript validation.
- First `prek run -a`: all code, manifest, typecheck and build checks passed;
  Markdown formatting changed four reviewed documentation/task files. Inspected
  the formatting diff; a clean rerun is required below.
- `npm run test:ci`: 2,024 tests across 123 files passed. Coverage: statements
  90.47%, branches 82.97%, functions 92.71%, lines 92.60%.
- Second `prek run -a`: all applicable hooks passed, including Markdown, ESLint,
  lockfile validation, TypeScript and production build. No source edits were
  made after the full suites passed.
- Staged and unstaged `git diff --check`: passed. All 30 reviewed files staged
  explicitly; no unrelated or native changes.

This commit includes all reviewed App work requested by the user, including the
preceding UI refinements and migration documentation. No sibling repository is
in scope. Commit subject:
`Refine offline map area controls and document migrations`. Post-commit
verification: inspect `git show --check --oneline HEAD` and require empty
`git status --short`; report the resulting hash with the final response.
