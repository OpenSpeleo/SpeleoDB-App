# Node Web Storage Flags in Vitest CI

## Lesson

Do not hard-code experimental Node flags in test wrappers without probing
support from the active Node binary first.

## Pattern

`scripts/run-vitest.sh` runs in local shells and GitHub-hosted Node versions. A
flag accepted by one Node release can be rejected by another, as happened with
`node --no-webstorage` on the GitHub Node 22 runner.

## Rule

When a wrapper needs optional Node runtime flags:

- sanitize injected `NODE_OPTIONS` first;
- probe candidate flags with `node <flag> -e ""`;
- pass only the first supported flag;
- fall back to no optional flag when none are supported.
