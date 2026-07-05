# Capacitor Plugin Calls Do Not Imply the Main Thread

Capacitor invokes plugin methods on its bridge queue. An `@objc` plugin method
therefore cannot read `UIApplication`, `UIScene`, `UIWindowScene`, or `UIDevice`
state directly, even when the same code compiles without Swift concurrency
errors. The physical-device Main Thread Checker is the authoritative seam for
this class of violation.

- Marshal every UIKit read or mutation to the main queue explicitly.
- Keep start/stop operations idempotent so bridge, app-lifecycle, and JavaScript
  cancellation paths can converge without double-starting native sensors.
- Refresh orientation from a main-queue orientation notification rather than
  polling UIKit from high-frequency sensor callbacks.
- A successful native build proves type and linkage correctness; it does not
  prove Main Thread Checker cleanliness. Exercise the plugin action on a device
  with the checker enabled before closing that gate.
