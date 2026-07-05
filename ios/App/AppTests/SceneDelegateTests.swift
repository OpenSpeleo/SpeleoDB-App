import XCTest
import UIKit
@testable import App

@MainActor
final class SceneDelegateTests: XCTestCase {
    func testIdleTimerIsDisabledOnlyWhileSceneIsActive() throws {
        let application = UIApplication.shared
        let originalValue = application.isIdleTimerDisabled
        defer { application.isIdleTimerDisabled = originalValue }

        let scene = try XCTUnwrap(application.connectedScenes.first)
        let sceneDelegate = SceneDelegate()

        sceneDelegate.sceneWillResignActive(scene)
        XCTAssertFalse(application.isIdleTimerDisabled)

        sceneDelegate.sceneDidBecomeActive(scene)
        XCTAssertTrue(application.isIdleTimerDisabled)

        sceneDelegate.sceneWillResignActive(scene)
        XCTAssertFalse(application.isIdleTimerDisabled)
    }
}
