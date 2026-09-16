# Responsive successive offline-area deletion

User reports all icons stay disabled for roughly one second after deleting an
area. Catalog deletion publishes first; the UI's global busy flag and delete
confirmation remain set until tile-membership cleanup and cache-stat refresh
finish.

- [x] Reproduce a committed deletion with cleanup held pending and prove that
      remaining controls incorrectly stay disabled.
- [x] Tie UI blocking to pending operations whose areas still exist in the
      authoritative catalog; isolate completion/confirmation state by area ID.
- [x] Verify successive deletions and out-of-order completion, write failures,
      and real service catalog/pin behavior while cleanup is delayed.
- [x] Run focused tests, lint/typecheck/build, full coverage and browser checks.
- [x] Document the completion boundary, results and physical-device limits.

No optimistic removal or timer-based unlocking. Tile cleanup must still finish,
retain shared pins, and reject obsolete downloads. Preserve current staged work.

## Review

The delay was caused by the manager awaiting `deleteDownloadArea` to settle
before clearing one global busy flag and the confirmation ID. The service had
already durably removed the area and published its disappearance; the remaining
awaits released tile memberships, recomputed coverage and refreshed cache stats.

The UI now tracks pending area IDs and derives busy/confirmation state against
areas still present in the published catalog. This unlocks all remaining
controls in the same render that removes the deleted row. Completion clears only
its own pending ID and confirmation, preserving a second deletion already
underway. The service, persistence contract and cleanup algorithm are unchanged.

Evidence:

- Before fix, both controlled-delay component regressions failed with the next
  delete button disabled after catalog removal.
- Focused panel/service suite: 41 passed. Includes older completion during the
  next confirmation and next save, plus failed catalog deletion handling.
- The real service/IndexedDB/engine integration holds tile cleanup pending,
  commits two deletions, then releases cleanup and checks remaining shared pins,
  cached bytes, and full unpinning when the last owner is removed.
- `npm run lint`, `npm run typecheck`, `npm run build`: passed.
- `npm run test:ci`: 1,997 tests across 122 files passed. Coverage: statements
  90.74%, branches 82.80%, functions 93.00%, lines 92.90%.
- `npm run test:browser`: all 34 Chromium/WebKit checks passed without retries.
  The successive-delete browser check inspects enabled state immediately after
  row removal, avoiding click auto-wait masking a disabled-controls gap.
- Final service regression run, including last-owner unpinning: 21 passed.
- Both staged/unstaged `git diff --check`: passed.

No native code changed; native builds/unit tests are not applicable to this
React control-state correction. Browser checks exercise the shipped UI; the
held-cleanup tests prove the completion boundary without timing assumptions.
Physical-device timing has not been measured. Existing staging is preserved; no
commit created.

Reusable lesson: [async UI completion](../lessons/async-ui-completion.md).
