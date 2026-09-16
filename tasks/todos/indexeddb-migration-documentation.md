# Document IndexedDB schema evolution

- [x] Verify database/catalog versions, upgrade handling, resumable conversion,
      parser behavior and existing tests against production code.
- [x] Write a migration guide separating current behavior from future migration
      requirements, including downgrade limitations and Django comparison.
- [x] Link the guide from the documentation index, tile architecture and area
      catalog documentation; validate formatting, links and diff hygiene.

## Review

Documentation only. Existing offline-area menu changes are preserved. No
runtime, schema, dependency or native changes are required; existing test
descriptions are linked as evidence without claiming a new test execution.

- Added `docs/indexeddb-migrations.md` and links from the index, tile
  architecture and area catalog documentation.
- Checked implementation claims against the database upgrade handler, resumable
  v7 converter, engine migration gate, catalog reader and validator.
- Prettier `--write --prose-wrap=always`: five documentation/plan files
  formatted.
- Local-link validation: 15 relative targets across those five files exist.
- `git diff --check`: passed.
- Runtime suites, build and native/device tests were not repeated for this
  documentation-only task. Future migration verification gates are documented
  explicitly rather than presented as existing test coverage.
- No commit created; these additions remain alongside the existing menu changes.
