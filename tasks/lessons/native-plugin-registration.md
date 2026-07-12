# Prove first-party native plugin registration

Compiling a Capacitor plugin into an app target does not prove JavaScript can
resolve it. SpeleoDB's first-party plugins are outside the generated package
plugin list, and Capacitor package discovery can ignore type-only registration.

For every first-party native plugin:

1. register the Android class explicitly in `MainActivity`;
2. register an iOS plugin instance in `AppBridgeViewController`;
3. add a bridge integration test that loads the production view controller and
   resolves the exact JavaScript plugin name;
4. keep formatter/storage unit tests separate from this registration test,
   because compiling native logic and exposing it through the live bridge are
   different invariants.
