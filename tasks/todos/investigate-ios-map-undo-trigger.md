# Investigate the Original iOS Map Undo Trigger

## Status

The shake-to-edit guardrail is implemented. Continue on a physical iPhone before
claiming that three-finger editing gestures are disabled or that the original
no-keyboard trigger is fixed.

## Goal

Reproduce the original **Undo Typing** alert while the map has no visible text
field or keyboard, identify the exact input/responder sequence, and determine
whether the shake guardrail removes it or merely masks an additional WebKit
focus/undo-lifecycle defect.

## Evidence

- The supplied `IMG_6976.PNG` shows the native alert above the map with no
  visible keyboard or text field.
- Shake-to-undo was separately reproduced while a text field was active.
- The original no-field trigger has not been reproduced or proven to be shake, a
  three-finger gesture, or another responder transition.
- A focused DOM input uses private `WKContentView` as first responder. It
  returns `.default` even when public WebView and controller ancestors return
  `.none`, so those ancestor properties are not proof of three-finger
  suppression.

## Investigation gates

- [ ] Record device model, iOS version, app build, system Shake to Undo setting,
      accessibility settings, and whether an external keyboard is attached.
- [ ] Distinguish three-finger editing swipes/pinches from the system
      Accessibility Zoom three-finger double tap; do not treat them as one
      trigger or promise that an app can disable the system gesture.
- [ ] Build a reproduction matrix covering login, landmark, and GPS-track text
      entry; save/cancel/dismiss; map return timing; shake; three-finger tap,
      swipe, and pinch; app background/foreground; and screen rotation.
- [ ] Capture a screen recording and device console for the shortest reliable
      reproduction without logging field contents or coordinates.
- [ ] Inspect the active UIKit responder and WebView focus/undo state at each
      transition using a diagnostic build with allowlisted, non-sensitive logs.
- [ ] Identify a supported public seam, if one exists, that reaches WebKit's
      active editing responder. Do not subclass, swizzle, or reference the
      private `WKContentView` class.
- [ ] If evaluating a competing three-finger recognizer, prove cancellation
      behavior for partially started MapLibre gestures and preserve VoiceOver
      and Accessibility Zoom before proposing production code.
- [ ] Prove the root cause with a red-before/green-after test at the owning
      native or WebView seam; do not substitute a DOM-only characterization for
      native responder evidence.
- [ ] Decide whether any follow-up production change is necessary after the
      shake guardrail, then update the canonical iOS WebView editing
      documentation.

## Verification gates

- [ ] Confirm one- and two-finger MapLibre gestures remain unchanged.
- [ ] Confirm all WebView forms retain typing, selection, context-menu
      copy/paste, keyboard shortcuts, Cancel, and Save behavior.
- [ ] Record physical-device evidence; simulator-only evidence cannot close the
      native gesture/modal gate.

## Review

Pending investigation.
