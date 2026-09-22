# AGENTS.md

Guidance for AI/code agents working in the SpeleoDB repository.

This file is intentionally opinionated and feature-focused so agents can make
correct changes without re-discovering architecture every session.

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal
  code.
- **No Laziness**: Find root causes. No temporary fixes. Principal Engineer
  standards.
- **Minimal Impact**: Changes should only touch what is necessary. Avoid
  introducing bugs or changing unrelated parts of the code.
- **Readability & Maintainability**: Preserve product behavior while improving
  maintainability.
- **Performance Conscious**: Be aware of the performance impact of your changes
  and try to minimize the impact on performance, whether it's N+1 SQL queries or
  heavy compute.
- **Refactor as necessary**: Prefer centralized logic over duplicated
  conditionals or per-call custom checks.
- **Tests are evidence**: Every behavior change needs a test at the production
  seam that owns the invariant. A test that only mirrors implementation is not
  evidence.

## Temporary agent files

Keep agent plans, task lists, TODO tracking, progress notes, review notes, and
scratch lessons outside the repository tree, including all submodules. Use a
unique task directory under `/tmp/` (for example, create one with
`mktemp -d /tmp/speleodb-task.XXXXXX`) or another OS temporary directory whose
resolved path is outside every checkout.

Never create or update these working files inside the checkout, even in ignored
directories such as `tasks/`, `todos/`, or `plans/`. Never stage or commit them.
Existing tracked task and lesson files are historical references; do not append
new work to them. Keep durable product and architecture documentation in
`docs/`, without embedding task checklists or linking to temporary files. Before
an authorized commit, inspect the staged filenames and exclude all agent working
files.

## Task Management

1. **Plan First**: Write non-trivial task plans to `plan.md` in the external
   temporary task directory with checkable items and explicit verification
   gates.
2. **Verify Plan**: Check in before starting implementation.
3. **Track Progress**: Mark items complete as they are proven, not merely
   edited.
4. **Explain Changes**: Provide a high-level summary at each implementation
   step.
5. **Document Results**: Add a review section to the task plan with commands,
   results, limitations, and commit references.
6. **Capture Lessons**: Update `lessons.md` in the external temporary task
   directory only when a correction exposes a reusable failure pattern. Do not
   create lesson noise for one-off preferences.
7. **Documentation is Key**: Document each feature and design inside `docs/`.
   What is the feature being implemented, the design space and intents and a
   rapid summary of the approach taken with key APIs & concepts.

## Workflow Orchestration

### 1. Plan Node Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Delegation Strategy

- Delegate only concrete, independently verifiable work with non-overlapping
  ownership.
- Do not delegate merely to reduce context or "throw more compute" at a problem.
- Keep one objective per delegate and define expected evidence before work
  starts.
- Avoid concurrent edits to shared files. The primary agent owns integration,
  repository-wide verification, and the final correctness claim.
- Follow the active execution environment's authorization rules; repository
  guidance never grants permission to create agents or perform external side
  effects.

### 3. Self-Improvement Loop

- After a correction, determine whether it reveals a durable engineering
  pattern.
- For durable patterns, write a concise preventive rule in the external
  temporary task directory's `lessons.md` and reference it only from the
  temporary task review. Keep repository documentation independent of temporary
  files.
- Do not encode subjective, temporary, or task-specific preferences as permanent
  rules.
- Review relevant lessons at session start.

### 4. Verification Before Done

- Never mark a task complete without proving it works
- Diff behavior between master branch and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run lint, type checking/build, focused tests, and the complete automated
  suite.
- For persistence, concurrency, cancellation, native lifecycle, WebView
  rendering, or background behavior, test the authoritative seam and record
  device evidence when compilation cannot prove runtime behavior.
- A green build is not a substitute for tests. Coverage is not a substitute for
  assertions at the owning seam. Manual evidence is not a substitute for
  automatable regression coverage.

### 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant
  solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

### 7. Change Hygiene

- Keep each commit focused on one high-level objective and independently green.
- Inspect both unstaged and staged diffs. Stage explicit paths so unrelated user
  work is never captured accidentally.
- Do not run blanket dependency upgrades or dependency swaps without a diagnosed
  need, compatibility review, lockfile inspection, and focused verification.
- **GitHub Actions version tags (hard rule):** never replace a human-readable
  action version tag (for example, `actions/checkout@v7.0.1`) with a commit SHA.
  Preserve the tag selected by the user or dependency updater. If a test or
  document requires converting that tag to a hash, the contract is stale and
  must be updated instead. Leave pre-existing hash-pinned actions unchanged
  unless the user explicitly asks to change them. See
  `tasks/lessons/github-actions-version-tags.md`.
- Treat Capacitor-generated native files as reviewable output. After `cap sync`,
  inspect every tracked native diff and keep only changes owned by the task.
- Do not hide flaky tests with retries, sleeps, skipped tests, or relaxed
  assertions.

## JavaScript Workspace Contract

The repository now uses a single Node workspace at the repo root.

- Canonical Node manifests are:
  - `package.json`
  - `package-lock.json`

## Testing Requirements

Every feature or bug fix must pass the verification layers applicable to its
risk:

1. lint and TypeScript/build validation;
2. focused unit or component tests for local behavior;
3. authoritative integration tests for storage, network, concurrency, and
   lifecycle seams;
4. full repository tests with coverage;
5. native unit/instrumentation/UI tests for Android or iOS behavior;
6. physical-device verification for behavior that simulators and builds cannot
   prove.

Document why an inapplicable layer is unnecessary. Do not claim "fully tested"
without listing the exact commands and device evidence. Tests must be
deterministic in blocking CI: no `.skip`, `.only`, retry-dependent success,
unexpected console output, or leaked timers/listeners.

## Documentation Expectations for Agents

When changing feature behavior or architecture, update docs under `docs/` for
the impacted topic:

- feature intent
- engineering scope and ownership boundaries
- testing and verification strategy
- performance implications

Do not only document "what changed"; include "why this architecture exists".

## Practical Do/Do-Not

### Do:

- Prefer shared utilities/modules over code duplication.
- Add focused tests when changing anything of significance.
- Be performance conscious.
- Systematically document all features & architectural decisions.
- Ensure the code is compatible on both iOS and Android.

### Do not:

- Duplicate code or logic
- Introduce "quick patches" that hinder long term maintainability.
- Add expensive computations.

### Coding rules

See `docs/coding-rules.md`. These are **hard rules** — violations must be fixed
before merging.

**Buttons (hard rule):** every `.app-btn` MUST carry a solid color variant
(`app-btn--primary | secondary | danger | info | success`, defined unlayered in
`src/index.css`). NEVER use an opacity-modified background utility
(`bg-<color>/<NN>`, e.g. `bg-slate-800/70`) as a button fill — it renders as
invisible "bare text" on Android WebViews. A button with no visible background
is a bug. Self-check: `app-btn[^"]*bg-` must return zero matches in
`src/**/*.tsx`. See `.cursor/rules/ui-buttons.mdc` and
`tasks/lessons/button-backgrounds.md`.

**MapLibre sources (hard rule):** every `react-map-gl` `<Layer>` MUST be a
direct child of its owning `<Source>`. A wrapper must explicitly forward the
injected `source` prop and be covered by a source-injection contract test. See
`docs/coding-rules.md` and `tasks/lessons/maplibre-source-children.md`.

## Working rules

1. Read relevant docs before proposing or implementing changes.
2. Keep code aligned with documented behavior.
3. If behavior changes, update docs in the same change.
4. If docs and code conflict, report it and align one with the other.

# Changelog Maintenance

Before completing any product change, agents must assess whether it represents a
meaningful customer-facing feature, fix, performance improvement, or other
notable outcome. When it does, ensure the appropriate section under
`CHANGELOG.md` `Unreleased` cites the final implementation commit. If the
implementation is not committed yet, make the changelog update immediately after
that commit and before merge or release.

The changelog is public marketing material and must:

- Include only the most meaningful customer-facing changes.
- Use high-level language with the absolute minimum technical detail.
- End every entry with the short commit ID that best represents the final
  change.
- Group entries under conventional headings such as `Features`, ` UI/UX`,
  `Fixes`, and `Performance`.
- Replace an earlier entry when the same change evolves again before release, so
  only its final outcome and newest relevant commit ID remain.
- Omit routine refactors, dependency updates, CI changes, tests, documentation,
  and implementation details unless they materially change the customer
  experience.
- The commit should be named `[Changelog Update]`
- Only update `CHANGELOG.md` if the change is visible to the customer,
  everything else should be internal and not documented.

When creating a version tag, move the applicable `Unreleased` entries into a new
version section named `vYYYY.MM.DD`, then leave an empty `Unreleased` section at
the top for future work.
