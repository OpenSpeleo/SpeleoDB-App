# iOS Keychain Tests Require a Signed Host

iOS Simulator compilation can use `CODE_SIGNING_ALLOWED=NO`, but Keychain
XCTests cannot. With signing disabled, otherwise valid `SecItem` reads, writes,
and deletes fail even when unrelated native tests pass.

- Run Keychain tests with normal simulator code signing enabled.
- Reserve `CODE_SIGNING_ALLOWED=NO` for compile-only Debug or Release builds.
- If every Keychain test fails together, verify the test host's signing before
  changing credential-store code or entitlements.
