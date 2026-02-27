# AGENTS.md

Guidance for AI/code agents working in the SpeleoDB repository.

This file is intentionally opinionated and feature-focused so agents can make
correct changes without re-discovering architecture every session.

## Core Principles
- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Principal Engineer standards
- **Minimat Impact**: Changes should only touch what's necessary. Avoid introducing bugs
or changing unrelated parts of the code.
- **Readability & Maintainability**: Preserve product behavior while improving
maintainability.
- **Performance Conscious**: Be aware of the performance impact of your changes and try
to minimize the impact on performance, whether it's N+1 SQL queries or heavy compute.
- **Refactor as necessary**: Prefer centralized logic over duplicated conditionals or
per-call custom checks.
- **Tests are cheap**: Every behavior should be tested. Untested code is broken code.

## Task Management

1. **Plan First**: Write plan to `tasks/todos/` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to tasks/todo.md"
6. **Capture Lessons**: Update `tasks/lessons/` after corrections
7. **Documentation is Key**: Document each feature and design inside `docs/`.
What is the feature being implemented, the design space and intents and a
rapid summary of the approach taken with key APIs & concepts.

## Workflow Orchestration

### 1. Plan Node Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One tack per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons/` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fizing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## JavaScript Workspace Contract

The repository now uses a single Node workspace at the repo root.

- Canonical Node manifests are:
  - `package.json`
  - `package-lock.json`

## Testing Requirements

Everything must be fully tested end-to-end after each feature or bug fix.
That includes code linting.

## Documentation Expectations for Agents

When changing feature behavior or architecture, update docs under `docs/`
for the impacted topic:

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

See `docs/coding-rules.md`.
These are **hard rules** — violations must be fixed before merging.

## Working rules

1. Read relevant docs before proposing or implementing changes.
2. Keep code aligned with documented behavior.
3. If behavior changes, update docs in the same change.
4. If docs and code conflict, report it and align one with the other.
