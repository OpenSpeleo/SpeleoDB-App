import Capacitor

@objc(AppBridgeViewController)
final class AppBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        // Type registration is ignored while Capacitor package discovery is enabled.
        bridge?.registerPluginInstance(CredentialStorePlugin())
        bridge?.registerPluginInstance(PerformanceDiagnosticsPlugin())
    }
}
