# Offline-Map Planner Worker Stall

## Goal

Restore production offline-map planning after the v8 streaming rewrite without
changing the preserved staged index. The browser/WebView worker protocol must
start every requested plan and retain one-chunk-at-a-time acknowledgement.

## Invariants and evidence gates

- [x] Every planner request carries the worker protocol's `type: 'plan'`
      discriminant.
- [x] A production-branch protocol test proves the worker receives `plan`, the
      consumer receives its chunk, and the worker receives the matching `ack`.
- [x] Existing bounded-chunk and source-revision planner tests remain green.
- [x] Focused planner/engine/coordinator/Settings tests pass.
- [x] Lint, typecheck, build, and unstaged diff checks pass.
- [x] The staged index remains 66 paths and is not modified.

## Review

### Root cause and fix

`planOfflineMapInWorker` posted `{id,input}`. The production worker's request
guard requires a `type` discriminant and therefore ignored the request without
starting enumeration. Because no error or completion message followed, the
engine remained in `planning` and project sync continued to show `syncing`.
Fallback unit tests did not instantiate a worker and could not observe the
wire-protocol mismatch.

The caller now posts `{id,type:'plan',input}`. A direct production-branch test
installs a protocol worker, requires the `plan` request before returning a
chunk, verifies the consumer receives that chunk, requires the matching `ack`,
then returns `done` and verifies termination. The architecture documentation and
streaming-plan lesson now make this protocol evidence explicit.

### Verification

- Planner protocol suite: 1 file / 6 tests passed.
- Focused planner/engine/coordinator/Settings gate: 4 files / 89 tests passed.
- `npm run lint`, `npm run typecheck`, and `npm run build` passed.
- `git diff --check` passed. The preserved staged-index check still reports the
  pre-existing blank EOF line in `tasks/lessons/online-cache-hits.md`.
- Built output contains the minified equivalent of
  `postMessage({id:1,type:'plan',input})`.
- `make ci` passed 106 files / 1,820 tests. Coverage: 90.01% statements, 82.05%
  branches, 92.83% functions, and 92.00% lines.
- `npx cap sync` passed for Android and iOS; tracked native diff remained empty.

The protocol is proven in the production JavaScript branch and compiled bundle.
No physical Android/iOS device was attached for a WebView runtime observation;
that device check remains a release-evidence limitation, not an unverified
protocol implementation.

### Change hygiene

The staged index remains the preserved 66-path baseline. This correction is
unstaged, introduces this task review, and creates no commit.
