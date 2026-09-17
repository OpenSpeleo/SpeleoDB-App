import XCTest
@testable import SpeleoDB

@MainActor
final class AppBridgeViewControllerTests: XCTestCase {
    func testGisGeometryHttpPluginIsRegisteredWithLoadedBridge() {
        let viewController = AppBridgeViewController()
        viewController.loadViewIfNeeded()
        XCTAssertTrue(viewController.bridge?.plugin(withName: "GisGeometryHttp") is GisGeometryHttpPlugin)
    }

    func testCredentialStorePluginIsRegisteredWithLoadedBridge() {
        let viewController = AppBridgeViewController()

        viewController.loadViewIfNeeded()

        XCTAssertTrue(
            viewController.bridge?.plugin(withName: "CredentialStore")
                is CredentialStorePlugin
        )
    }

    func testPerformanceDiagnosticsPluginIsRegisteredWithLoadedBridge() {
        let viewController = AppBridgeViewController()

        viewController.loadViewIfNeeded()

        XCTAssertTrue(
            viewController.bridge?.plugin(withName: "PerformanceDiagnostics")
                is PerformanceDiagnosticsPlugin
        )
    }

    func testBackgroundExecutionIsRestrictedToLocationRecording() {
        XCTAssertEqual(
            Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String],
            ["location"]
        )
    }
}
