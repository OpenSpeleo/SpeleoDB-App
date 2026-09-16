# Stable offline tile coverage and layer scheduling

## Diagnosis and plan

Layer preferences currently increment every automatic area's geometry revision.
The serial area queue then cancels/restarts work and republishes a different
area's denominator as global progress. Overlap shares payloads, but still incurs
repeated planning/auditing/membership work.

- [x] Separate geometry identity from layer requirements. Build canonical unions
      of area rectangles; deduplicate coordinates once in the existing bounded
      worker. Reuse immutable persisted plans across layers and restarts.
- [x] Schedule one job per required layer/coverage union, retaining unrelated
      running/completed work on toggles. Keep catalog validation transactional
      so deleted/changed intent cannot be resurrected by late network
      completions.
- [x] Publish stable aggregate/per-layer progress through the dedicated progress
      subscription, and retain old usable coverage during replacements.
- [x] Add deterministic production-seam tests for overlapping areas, plan reuse,
      rapid toggles during downloads/source reads, deletion, recovery and
      failures.
- [x] Update architecture/settings documentation and the reusable lesson.
- [x] Verify focused tests, lint, typecheck, build, full coverage and browser
      suite.

## Scope decisions

Keep the existing six-worker transport, retries, storage consent, plan limits,
IndexedDB payloads and atomic membership writes. The shared union activates only
when all enabled replacement layers are ready; failed replacements preserve all
previous active layers. The user confirmed that Settings switches apply equally
to every area, including manual selections. Satellite remains forced.

Review identified that moving the old packed-set planner limit to the union
would introduce a stricter aggregate limit. The rectangle worker now streams a
vertical strip union with memory proportional to area count plus one chunk. The
existing per-area limit is unchanged; multiple valid areas can exceed 1M tiles
together. The production worker protocol, backpressure and final denominator
remain intact.

## Verification gates / review

Completed without staging or committing; existing staged and unstaged user work
is preserved. No commit reference was created.

- `npm run lint` — passed, exit 0.
- `npm run typecheck` — passed, exit 0.
- `npm run build` — passed, exit 0; startup entry 442.70 kB, within the 450 kB
  budget.
- `npm run test.unit -- --run src/services/DownloadAreaService.test.ts` — 27
  passed against the real engine and fake IndexedDB, including held transport
  and recovery.
- `npm run test.unit -- --run src/services/OfflineMapPlanner.test.ts src/services/tilePrefetchPlanner.test.ts`
  — 33 passed; proves the streamed union matches existing geometry, including
  dateline boundaries, and handles 1,048,573 unique tiles from valid areas in
  chunks of at most 2,048.
- Coordinator/Settings focused tests prove switches preserve in-flight source
  collection, failed preference saves cannot contaminate later switches, and
  reverse-order React save completions retain both settings.
- `npm run test:ci` — 2,008 tests across 122 files passed. Coverage: statements
  90.35%, branches 82.68%, functions 92.55%, lines 92.50%.
- `npm run test:browser` — 36 tests passed, Chromium + WebKit, zero retries. The
  new real-worker check asserts one planner start, the same persisted plan,
  unchanged satellite generation/progress, and unchanged manual geometry after
  layer switches. Existing editing, repeated deletion, offline restart and
  touch-layout checks also pass.
- `git diff --check` and `git diff --cached --check` — passed.

Final command logs:
`/tmp/offline-union-{lint,typecheck,build,coverage,browser}.log`.

Native sources, plugin APIs and Capacitor configuration are unchanged. Native
build/unit suites are not applicable to this shared TypeScript-only change and
were not rerun. Actual worker and IndexedDB behavior was exercised in both
browser engines, but physical Android/iOS WebView checks (backgrounding, process
death, storage pressure and airplane-mode rendering) were not performed; no
device runtime guarantee is claimed.

Reusable prevention rule:
[separate geometry identity from download policy](../lessons/offline-geometry-identity.md).
Architecture and performance notes:
[offline download areas](../../docs/offline-download-areas.md).
