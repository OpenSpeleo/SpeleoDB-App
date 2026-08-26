# Remove unused manual mobile workflow

## Plan

- [x] Inventory every workflow, UI-automation, secret, script, documentation,
      quality-contract, and historical audit reference owned by the subsystem.
- [x] Preserve the user-owned deletion of the manual workflow and its dedicated
      quality test.
- [x] Delete the orphaned UI flows, runner/installer/environment scripts, iOS
      selector, and dedicated device document.
- [x] Remove documentation, quality-inventory, and historical task references
      that describe or require the deleted subsystem.
- [x] Prove no deleted subsystem names, configuration, or paths remain and run
      quality inventory, lint, typecheck, build, `make test`, and diff checks.
- [x] Record exact results, limitations, and commit status below.

## Verification gates

- Repository-wide reference scan returns no deleted subsystem or path matches.
- `npm run quality:inventory`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `make test`
- `git diff --check` and explicit staged/unstaged inspection.

## Review

### Removed surface

- Preserved the user's deletion of the manual workflow and its four-test
  repository contract.
- Deleted four UI-automation flows and their empty directory, the CLI installer,
  credential/environment guard, cross-platform runner, and dedicated iOS
  simulator selector.
- Deleted the dedicated device/automation evidence document and removed its CI,
  documentation-index, release-ceremony, quality-classification, and historical
  audit references.
- No regular CI workflow, production source, native source, or ordinary test
  harness depended on the deleted subsystem.

### Verification

- Repository-wide case-insensitive scans for every deleted feature name, secret
  namespace, directory, script, selector, document, and audit identifier — no
  matches.
- `npm run quality:inventory` — pass: all 604 tracked files classified.
- `npm run lint` — pass.
- `npm run typecheck` — pass.
- `npm run build` — pass: 619 modules transformed.
- `make test` — pass: 118/118 files, 1,935/1,935 tests.
- `API_TEST_ENABLED=false npm run test:ci` — pass: 116 files passed, 2 skipped;
  1,922 tests passed, 13 skipped. Coverage: 90.39% statements, 82.02% branches,
  92.95% functions, and 92.54% lines.
- `git diff --check` and staged/unstaged scope inspection — pass.

### Limitations and status

- Native compilation is inapplicable because this cleanup removes only dormant
  repository automation and documentation; no application or native source was
  changed by this cleanup.
- No commit was requested or created.
