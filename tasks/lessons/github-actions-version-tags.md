# Preserve GitHub Actions Version Tags

## Failure pattern

A dependency update intentionally changes official GitHub Actions references to
human-readable version tags, but an agent treats a stale SHA-pinning assertion
as authoritative and rewrites the workflow back to commit hashes.

## Preventive rule

- Never replace an existing GitHub Actions version tag with a commit SHA.
- Preserve the action version selected by the user or dependency updater.
- When a test or document rejects an intentional version tag, update that stale
  contract instead of changing the workflow to satisfy it.
- Do not alter pre-existing hash-pinned actions unless the user explicitly puts
  them in scope.
