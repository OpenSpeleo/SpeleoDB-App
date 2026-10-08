# Verification strategy and evidence boundaries

## Intent and ownership

Verification protects session secrecy, offline data, map availability, and field
recording at the seams that own those outcomes. The controller façade preserves
public behavior while focused coordinators, services, hooks, and native hosts
own transitions. Their boundaries are documented in the topic index; broad suite
counts do not prove any particular failure mode.

`quality/file-classification.json` maps tracked files to owners and applicable
verification. `bun run quality:inventory` checks classification completeness;
its labels name required evidence categories, not proof those tests exist or
ran. Every behavior change needs a failing-before/passing-after regression at
its production seam. See
[implementation guidelines](implementation-guidelines.md).

## Current automated gates

[CI](ci.md) owns lint, type checking, coverage floors, production bundle checks,
Chromium/WebKit layout tests, and native compile-smoke boundaries. Native tests
exercise first-party credential storage, bridge registration, transport, and app
lifecycle/configuration. Topic documents describe their authoritative cases.
[The release ceremony](release-ceremony.md) owns trusted signing and artifact
identity; the root GPS release protocol owns the recording device matrix.

The following broader hardening goals are not established as completed gates:

- A cross-platform installed-app Appium/WebdriverIO end-to-end matrix. Browser
  tests exercise production web assets but do not substitute for this.
- Repository-wide property/mutation testing and a report accounting for
  surviving mutants in critical state machines.
- 100% runtime coverage per file. Current CI uses explicit global and critical-
  file floors; use behavior-owning tests to raise them without exclusions or
  threshold reductions that conceal gaps.
- Repository-wide automated cycle/clone detection and module/function complexity
  enforcement. Review targets are focused modules around 600 lines or less and
  functions around 80 lines or less; size alone is not a correctness measure.
- A complete deterministic chaos and physical-device performance matrix covering
  all supported platforms. Existing race/fault tests establish their named
  scenarios only.

These are evidence limitations and engineering goals, not a claim that a tool
listed in the classification manifest is installed or that all historical audit
findings remain open. The earlier iOS 15 test target is obsolete: the app now
requires iOS 16.4 or later. Device matrices follow current supported OS and
WebView floors and include oldest-supported and current runtimes, plus iPad.

## Acceptance and fault evidence

Credential exposure, destructive data loss, invalid release identity, and
security-boundary bypass block release. Crashes, duplicate mutations, incorrect
durable results, and lifecycle failures require concrete reproduction and
repair. Performance, accessibility, and maintainability claims require
appropriate measurements and rendered/runtime evidence.

For each finding, preserve the trigger, violated invariant, owning production
boundary, root cause, correction, regression, exact commands/results, and device
limitations. Keep task-specific records outside checkouts. Durable documentation
contains the resulting contract, rationale, and verification method. Do not
infer physical-device success from compilation, a mocked bridge, or a simulator.

Use deterministic deferred faults for cancellation, persistence, retry, and
lifecycle races. Do not accept retries, sleeps, skipped/focused tests,
unexpected console output, or leaked work as a way to obtain a green result.
Dependency, release, native asset, and performance changes need their own
applicable evidence; [performance diagnostics](performance-diagnostics.md)
defines timing claims.

## Physical release matrix

On supported Android and minimum/current iOS devices, verify logout during held
mutation/replay, force-quit and reopen, secure-store upgrades, offline
replacement and restart under storage pressure, locked/background GPS,
notification denial, and Android battery restrictions. Heading verification
covers cardinal directions, 359°↔0° movement, portrait and both landscapes,
toggle/pause/resume, route and app suspension, and unavailable sensors. Record
model, OS/WebView version, build hash, commands, raw timings, and sanitized
screenshot/log disposition. Trusted signing, install/upgrade, store validation,
symbols, artifact hashes, and independent approval remain separate release
evidence.
