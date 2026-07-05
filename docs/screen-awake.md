# Foreground Screen-Awake Policy

## Feature intent

SpeleoDB is used as a field map and navigation aid. While its native app is in
the foreground, the display must not dim or auto-lock because the user may need
to read the map for longer than the device's normal idle timeout without
touching it.

The policy applies to every screen in the native Android and iOS apps, including
login, startup, offline, and authenticated routes. It is not tied to GPS
recording, authentication, or any React component.

## Native ownership and lifecycle

The behavior is owned by the native app shells so it is active before the web
app finishes loading and cannot be lost during a React route or state change.

| Platform | Owning seam           | Active behavior                                                               | Foreground exit                                                                                                        |
| -------- | --------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Android  | `MainActivity` window | Adds `FLAG_KEEP_SCREEN_ON` after activity creation                            | Android applies the flag only while the activity is visible, so normal device timeout behavior resumes outside the app |
| iOS      | `SceneDelegate`       | Sets `UIApplication.shared.isIdleTimerDisabled` when the scene becomes active | Clears the property when the scene resigns active                                                                      |

The iOS project uses the UIScene lifecycle, so the policy belongs in
`sceneDidBecomeActive` and `sceneWillResignActive`, not the legacy application
delegate callbacks.

## Design boundaries

- No Capacitor plugin or JavaScript bridge is needed. Both platforms expose the
  required behavior at the native lifecycle boundary already owned by the app.
- The browser Screen Wake Lock API is not used. Browser/PWA behavior is out of
  scope, and a WebView-level request would add asynchronous state and lifecycle
  recovery for behavior the native window already provides directly.
- The app does not acquire a CPU or partial wake lock, wake a device whose
  screen is already off, add a background mode/service, or keep executing
  because of this feature.
- No permission, manifest declaration, persistent preference, or user setting is
  introduced.
- Intentional hardware-button locking and mandatory operating-system safety,
  thermal, or power behavior remain authoritative.

## Power and display impact

Keeping the display illuminated uses more battery and can increase OLED image
retention risk during long, static sessions. The implementation adds no polling
or repeated bridge calls, so its CPU cost is negligible; the display itself is
the material power cost. Normal system dimming and auto-lock resume as soon as
SpeleoDB is no longer foreground-active.

## Verification strategy

Android instrumentation launches the production `MainActivity` and checks the
actual window flag. iOS native tests invoke the production scene lifecycle
callbacks and check the actual application idle-timer property across
inactive-active-inactive transitions.

Compilation and native tests prove the policy is wired to the owning lifecycle
seams, but they cannot prove physical display timing. Before release, verify on
physical Android and iOS devices with short automatic-lock intervals that the
foreground app remains awake, backgrounding restores the system timeout,
returning reapplies the policy, and the hardware lock button continues to work.
