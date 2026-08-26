# iOS WebView Editing and Shake-to-Undo Policy

## Feature intent

SpeleoDB is a field map whose native iOS app also contains WebView text inputs
for login, settings, landmarks, and GPS tracks. Text editing must work normally,
but UIKit's shake-to-edit feature must not interrupt map or navigation
interactions with an unrelated **Undo Typing** alert.

The policy applies to the complete native iOS app. Android and browser/PWA
behavior are unchanged.

## Root cause

The prompt is native UIKit editing UI, not a React, Ionic, or MapLibre dialog.
`UIApplication.applicationSupportsShakeToEdit` defaults to `true`; when enabled,
shaking can display an undo/redo alert. Apple's platform guidance identifies
shake as a system undo/redo input:

- [UIApplication.applicationSupportsShakeToEdit](https://developer.apple.com/documentation/uikit/uiapplication/applicationsupportsshaketoedit)
- [Apple Human Interface Guidelines: Undo and redo](https://developer.apple.com/design/human-interface-guidelines/undo-and-redo/)

Capacitor hosts SpeleoDB in one `WKWebView`. Web inputs can register a typing
undo action independently of whether the software keyboard remains visible. The
supplied no-keyboard screenshot proves that an undo action can surface over the
map, but its exact originating touch sequence has not yet been reproduced; that
deeper root-cause investigation is tracked separately.

The dashboard pointer state machine does not register or invoke undo. Map taps,
pans, pinches, depth probing, and long presses are therefore not the owning seam
for this prompt.

## Native ownership

`AppDelegate.application(_:didFinishLaunchingWithOptions:)` disables
`applicationSupportsShakeToEdit` before the Capacitor WebView becomes active.
This policy is app-wide because typing undo state can originate on any route and
native UI can surface above any route.

The policy disables UIKit's shake-triggered undo/redo interface. It does not
install a custom touch recognizer, change MapLibre gestures, or remove normal
WebView typing, selection, context-menu copy/paste, or keyboard shortcuts.

## Three-finger gesture boundary

Three-finger editing gestures are not yet proven disabled. Although UIKit
exposes `UIResponder.editingInteractionConfiguration`, a focused DOM input is
owned by WebKit's internal `WKContentView`, not the public `WKWebView` or bridge
controller. Simulator characterization found that internal first responder still
returns `.default`. Overriding the property only on public ancestors does not
prove that UIKit consults those ancestors and is therefore not accepted as a
completed guardrail.

Do not subclass, swizzle, or otherwise reference `WKContentView`; it is private
WebKit implementation. Do not intercept all three-finger touch sequences until
physical-device testing proves that a public solution cannot own the behavior
and accessibility plus MapLibre cancellation effects are understood.

Apple documents three-finger swipes and pinches as productivity-editing
gestures. A three-finger double tap belongs to the system Accessibility Zoom
feature when that feature is enabled; an app-level editing-interaction override
must not be represented as disabling that system gesture.

- [UIResponder.editingInteractionConfiguration](https://developer.apple.com/documentation/uikit/uiresponder/editinginteractionconfiguration)
- [Apple Support: Zoom in on the iPhone screen](https://support.apple.com/guide/iphone/zoom-in-iph3e2e367e/ios)

## Rejected alternatives

- JavaScript `preventDefault`, pointer cancellation, or map gesture changes
  cannot own a UIKit motion alert and risk breaking accessible text and map
  interactions.
- Overriding raw motion callbacks duplicates the application policy UIKit
  already exposes.
- Subclassing the public `WKWebView` or bridge controller does not change the
  internal DOM input responder's editing-interaction configuration.
- Installing a competing three-finger recognizer can cancel partially delivered
  MapLibre touches and interfere with accessibility gestures; it requires device
  evidence before it can be considered.
- Enabling and disabling shake behavior by route is incomplete because the undo
  action and the screen on which UIKit presents it need not be the same.
- Requiring every user to disable Shake to Undo in system Accessibility settings
  leaves SpeleoDB's field behavior dependent on device configuration.

## Verification and performance

The native AppDelegate test forces the unsafe shake value, invokes the
production launch callback, and asserts that the actual application property is
disabled. This test is intentionally native: a DOM test cannot prove a UIKit
application policy.

Before release, keep the device-level Shake to Undo setting enabled, edit a real
SpeleoDB text field, dismiss the input, return to the map, and deliberately
shake a physical iPhone. No undo alert should appear. Separately record what
three-finger swipes, pinches, taps, and double taps do before making any further
gesture change, then recheck map tap, pan, two-finger pinch, and long press plus
form editing, selection, context-menu copy/paste, Cancel, and Save.

The implementation writes one Boolean during application launch. It adds no
listener, sensor subscription, bridge call, render, storage, network, or
background cost.
