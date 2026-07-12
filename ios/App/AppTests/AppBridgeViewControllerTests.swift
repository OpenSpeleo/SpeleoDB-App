import XCTest
@testable import App

@MainActor
final class AppBridgeViewControllerTests: XCTestCase {
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
