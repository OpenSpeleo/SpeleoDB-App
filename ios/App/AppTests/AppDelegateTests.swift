import UIKit
import XCTest
@testable import App

@MainActor
final class AppDelegateTests: XCTestCase {
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
