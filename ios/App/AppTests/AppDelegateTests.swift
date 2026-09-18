import UIKit
import XCTest
@testable import SpeleoDB

@MainActor
final class AppDelegateTests: XCTestCase {
    func testPackagedAppRequiresIOS16_4() {
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "MinimumOSVersion") as? String, "16.4")
    }

    func testLaunchDisablesShakeToEdit() {
        let application = UIApplication.shared
        let originalValue = application.applicationSupportsShakeToEdit
        defer { application.applicationSupportsShakeToEdit = originalValue }

        application.applicationSupportsShakeToEdit = true

        let didLaunch = AppDelegate().application(
            application,
            didFinishLaunchingWithOptions: nil
        )

        XCTAssertTrue(didLaunch)
        XCTAssertFalse(application.applicationSupportsShakeToEdit)
    }
}
