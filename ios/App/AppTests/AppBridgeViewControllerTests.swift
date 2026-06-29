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

    func testBackgroundExecutionIsRestrictedToLocationRecording() {
        XCTAssertEqual(
            Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String],
            ["location"]
        )
    }
}
