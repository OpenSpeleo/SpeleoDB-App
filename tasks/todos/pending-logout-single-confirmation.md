# Pending-operation logout confirmation

## Objective

Remove redundant destructive messaging from voluntary Settings sign-out. A user
with pending offline operations must see one irreversible-loss confirmation; the
generic local-data confirmation is reserved for users with no pending
operations.

## TDD plan

- [x] Add a regression test proving the pending-operation path does not render
      the generic “Clear local data and sign out?” confirmation.
- [x] Run the focused test and record the expected failure.
- [x] Render mutually exclusive pending-loss and generic confirmation content.
- [x] Preserve acknowledgement, exact counts, retry, busy-state, and direct
      logout behavior.
- [x] Update Settings documentation.
- [x] Run the focused Settings suite, lint, typecheck, and build.
- [x] Inspect the task-only diff and document results.

## Review

The pending-operation path now replaces the generic local-data confirmation
rather than appearing beneath it. After checking the irreversible-loss
acknowledgement, **Delete Offline Operations & Sign Out** calls the existing
logout operation directly. The zero-pending path retains the original generic
confirmation and button copy.

TDD evidence:

- Red:
  `npm run test.unit -- --run src/pages/Settings.test.tsx -t "requires explicit acknowledgement before losing one pending offline operation"`
  failed because “Clear local data and sign out?” was still mounted.
- Green: the same command passed (1 test; 65 skipped).
- `npm run test.unit -- --run src/pages/Settings.test.tsx` passed all 66 tests.
- `npm run lint` passed.
- `npm run typecheck` passed.
- `npm run build` passed (610 modules transformed).

No native or physical-device verification is required for this conditional
web-modal rendering change. No commit was created in this side conversation.
