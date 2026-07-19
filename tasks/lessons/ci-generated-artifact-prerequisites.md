# CI tests must own generated prerequisites

## Failure pattern

A blocking test reads an ignored generated file that happens to exist in a
developer checkout, but a clean CI checkout runs that test before the command
that creates the file. Local success then depends on stale workspace state.

## Preventive rule

- A test job may read only tracked inputs, installed dependency output, or
  artifacts generated earlier in that same job.
- Keep ignored native output checks in the native sync/build job that owns
  generation and can inspect the resulting warnings or drift.
- If a fast unit gate needs to enforce the policy, assert the committed source,
  compatibility transformation, or attribution ledger instead of an absent
  downstream artifact.
- Reproduce suspected cases with the generated output absent before claiming a
  clean-checkout fix.
