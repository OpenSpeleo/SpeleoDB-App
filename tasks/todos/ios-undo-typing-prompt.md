# Prevent the iOS "Undo Typing" Prompt

## Goal

Prevent UIKit's shake-to-undo alert from interrupting SpeleoDB's iOS map and
other screens without changing text editing, map gestures, Android, or browser
behavior. Keep three-finger gesture suppression open until its real WebKit
responder seam and accessibility impact are proven.

## Root cause

- [x] Identify the screenshot as native UIKit editing UI rather than a React,
      Ionic, or MapLibre dialog.
- [x] Confirm that iOS enables `applicationSupportsShakeToEdit` by default and
      SpeleoDB does not override it.
- [x] Trace the Capacitor host and confirm that Web input undo state can remain
      available when the keyboard is not visible.
- [x] Confirm that the map gesture state machine neither registers nor invokes
      undo behavior.
- [x] Confirm that a focused DOM input's first responder is WebKit's private
      `WKContentView`, which still returns `.default` when public WebView and
      controller ancestors override `editingInteractionConfiguration`.
- [ ] Reproduce and identify the exact sequence behind the original no-keyboard
      screenshot; deferred to the dedicated follow-up task.

## Implementation gates

- [x] Disable shake-to-edit once at the production iOS application-launch seam.
- [x] Add an AppDelegate test that starts from the unsafe default and proves the
      production launch callback disables it.
- [x] Remove unproven public-ancestor editing-interaction overrides and the test
      that only asserted those implementation properties.
- [x] Document intent, native ownership, alternatives, compatibility, testing,
      and performance; add the document to the docs index.
- [x] Capture the corrected native-trigger evidence standard in a reusable task
      lesson and link it from the review.
- [x] Preserve all unrelated tracked and untracked user work.
- [ ] Prove a supported, accessibility-safe seam for disabling three-finger
      productivity-editing gestures on a physical iPhone before implementing it.

## Verification gates

- [x] Lint the Xcode project file.
- [x] Run the complete iOS App test target on a simulator.
- [x] Compile the iOS app for a generic device.
- [x] Run repository lint, type checking, production build, and the complete
      Vitest suite with coverage.
- [x] Run final diff, repository-hygiene, and applicability checks.
- [ ] Record physical-iPhone shake reproduction and post-fix evidence, or leave
      the gate open and identify the release limitation.
- [ ] Record three-finger swipe, pinch, tap, and double-tap behavior separately;
      simulator property tests cannot close that gate.

## Locked decisions

- The shake policy is app-wide on native iOS because WebView undo state can
  originate from any input and surface on any route.
- Use UIKit's documented `applicationSupportsShakeToEdit` application policy
  rather than intercepting JavaScript touch events or raw native motion events.
- Do not depend on private `WKContentView`, install a blanket competing touch
  recognizer, or claim three-finger suppression from public ancestor properties.
- A three-finger double tap is also reserved by iOS Accessibility Zoom when that
  system feature is enabled; editing-interaction configuration does not own it.
- Android and browser/PWA behavior are out of scope.
- The supplied screenshot remains untracked evidence and is not modified or
  committed. The unrelated archive was excluded from staging.

## Review

### Result

- Native iOS launch now disables UIKit shake-to-edit before Capacitor activates
  its WebView.
- Adversarial review rejected the initial three-finger implementation. With a
  focused DOM input, the active responder was `WKContentView(.default)` followed
  by `WKScrollView(.default)`, then the proposed `AppWebView(.none)` and bridge
  controller. Tests of only the public ancestors could not prove gesture
  suppression at the owning responder.
- The ineffective overrides and their configuration-only test were removed; no
  private WebKit API or speculative touch interceptor replaced them.
- Map and form JavaScript remain unchanged. Android and browser/PWA behavior are
  unchanged.
- `docs/ios-webview-editing.md` records the proven shake policy and unresolved
  three-finger boundary. The exact no-field screenshot trigger remains open in
  `investigate-ios-map-undo-trigger.md`.
- `tasks/lessons/native-ui-trigger-evidence.md` records why identifying a native
  alert is not sufficient evidence for its triggering gesture.

### Automated verification

- `plutil -lint ios/App/App.xcodeproj/project.pbxproj` — passed.
- `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'platform=iOS Simulator,id=1CF6D30D-531B-4951-8DE7-43AC10CDA7A8' -derivedDataPath /tmp/speleodb-review-primary-ios test`
  — passed all 16 App tests on iPhone 17 Pro / iOS 26.5.
- `xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath /tmp/speleodb-review-primary-ios-device-sequential CODE_SIGNING_ALLOWED=NO build`
  — passed the arm64 generic-device compile.
- An earlier attempt to run the simulator tests and generic-device build in
  parallel failed because both Xcode build phases rewrite the tracked app's
  shared `ios/App/App/public` directory. The same generic build passed when run
  sequentially; native Xcode invocations for this project must not overlap.
- `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run test:ci` —
  passed after adversarial review: 118 files and 1,936 tests, with 90.53%
  statement, 82.19% branch, 93.27% function, and 92.67% line coverage.
- `prek run -a` — every non-formatting hook passed. The all-repository Markdown
  hook exposed pre-existing Prettier drift in six unrelated tracked documents;
  those out-of-scope rewrites were reverted. The task-owned Markdown files pass
  the same Prettier hook when checked directly.
- `git diff --check` and final staged inspection — passed; only task-owned paths
  were committed, and the supplied screenshot remains untouched and untracked.

### Physical-device evidence and limitations

No physical-iPhone evidence has been recorded. Native tests prove the production
shake application property, but compilation and simulator tests cannot prove
motion-alert or three-finger gesture behavior on a physical device. Before
release, verify shake-to-undo with the system setting enabled. Research and test
three-finger productivity gestures and Accessibility Zoom separately before
shipping any additional suppression mechanism.

### Commit references

The focused commit is created after this review record; its hash is reported in
the final handoff.
