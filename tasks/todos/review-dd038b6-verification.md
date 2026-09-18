# Review and verify dd038b6 through 39b2751 (inclusive)

## Plan

User invoked the review-agent skill and authorized corrective implementation,
full tests, `prek run -a`, and commits. The reviewer owns grounded findings,
corrections, and focused regression tests; the primary owns integration and
repository-wide verification. Review baseline: `dd038b6^`; review head:
`39b2751`.

- [x] Review every changed production, native, test, and documentation boundary.
- [x] Evaluate and complete the reviewer's corrective plan with focused
      evidence.
- [x] Run full coverage, browser tests, applicable Android/iOS checks, and
      inventory.
- [x] Finish with `npx prek run -a`; inspect all resulting changes.
- [x] Record actionable findings, fixes, limitations, and commit references.
- [ ] Commit all task-owned changes and any required public changelog update.

## Verification ownership

Finish all commands that write web assets before running browser preview tests.
Check actual native test counts as well as command exit codes. Keep credentials
out of logs and the repository. Preserve iOS 16.4 as the app install floor and
Android WebView 111 as its supported engine floor unless concrete evidence
requires a stricter floor. Do not infer coverage of physical devices or an iOS
16.4 runtime from newer simulator tests.

## Review

The adversarial reviewer reproduced and fixed two P2 defects; the primary
reviewed the corrective plan and the final diff. Only two production lines
change: accept SDK-rewritten bundled frame URLs, and guard stack access for
arbitrary React thrown values. Details and red/green evidence are in
[the corrective review](review-dd038b6-corrections.md).

Focused verification passed five files / 252 tests. Lint and TypeScript passed.
Full integration results are recorded below after completion.

### Commands

```sh
npm run test:ci
npm run lint
npm run typecheck
npm run quality:inventory
# In android/, with Android Studio's bundled JDK:
./gradlew :app:assembleDebug :app:assembleRelease :app:testDebugUnitTest --rerun \
  :app:lintDebug :app:connectedDebugAndroidTest
xcodebuild -project ios/App/App.xcodeproj -scheme SpeleoDB \
  -configuration Debug \
  -destination 'platform=iOS Simulator,id=BA0876D4-75BB-478F-8A7B-418E080EC33E' \
  -derivedDataPath /tmp/speleodb-ios16-verification \
  -collect-test-diagnostics never test
xcodebuild -project ios/App/App.xcodeproj -scheme SpeleoDB \
  -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath /tmp/speleodb-ios16-release CODE_SIGNING_ALLOWED=NO build
npm run test:browser
npx prek run -a
```

Logs live under `/tmp/speleodb-review-dd038b6/`. Native web-asset writers finish
before browser tests. The final all-files hook run follows browser completion.
No automated retries are configured, and no regression cases are skipped.

### Results and limitations

- Full coverage: 136 files / 2,282 tests passed. Statements 91.13%, branches
  83.79%, functions 93.17%, lines 93.27%. Browser suite: 92 passed across
  Chromium and WebKit, with retries disabled.
- Native iOS: 28 signed simulator tests passed on iPhone 18 Pro / iOS 27.0.
  Debug simulator and unsigned Release device builds passed. Both packaged
  minimum OS fields remained 16.4. No iOS 16.4 runtime or physical-device
  evidence is available.
- Android Debug/Release builds, lint, and 22 unit tests passed. Android 11 /
  WebView 91.0.4472.114 passed all three device tests. The supported emulator
  had updated to WebView 151.0.7922.199 since the previous WebView 134 run.
- Initial Android 16 run passed two tests, then stalled before the final page
  assertion. Its renderer did not answer CDP and system logs showed extensive
  stalls plus more than 1 GB guest swap use. Preserved logs, screenshot, memory
  report, and XML under the evidence directory. Java trace extraction required
  unavailable root privileges. Cold-started the emulator with 4 GB RAM and reran
  the unchanged device suite; no automated retries or timeout/assertion changes
  were added. The interrupted run's XML records a failed final test despite
  Gradle exiting zero; it is not counted as a passing run. The report-checking
  lesson was added to `tasks/lessons/authoritative-seam-tests.md`.
- Physical devices and Huawei's independently numbered provider remain outside
  the verified matrix. No guessed Huawei minimum or dependency upgrade was made.
- Final supported-device run: three tests passed, no failures/errors/skips, in
  37 seconds; verified the XML as well as Gradle output. The corrected emulator
  had about 2 GB available guest memory. Both Android providers now have a
  completed passing run, six device tests total.
- Customer-facing assessment: preserving the recovery screen for unexpected
  thrown values merits a concise Fixes changelog entry. SDK diagnostics and test
  details stay internal.
- `npx prek run -a` passed every applicable hook after Markdown formatting.
  Inventory passed, including the review plans. No unrelated hook edits remain.
