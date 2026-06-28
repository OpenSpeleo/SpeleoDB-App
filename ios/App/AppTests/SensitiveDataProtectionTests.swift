import Foundation
import XCTest
@testable import App

final class SensitiveDataProtectionTests: XCTestCase {
    private var temporaryDirectory: URL!

    override func setUpWithError() throws {
        temporaryDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("SensitiveDataProtectionTests-(UUID().uuidString)")
        try FileManager.default.createDirectory(
            at: temporaryDirectory,
            withIntermediateDirectories: true
        )
    }

    override func tearDownWithError() throws {
        if let temporaryDirectory {
            try? FileManager.default.removeItem(at: temporaryDirectory)
        }
        temporaryDirectory = nil
    }

    func testMarksExistingDirectoriesExcludedFromBackup() throws {
        try SensitiveDataProtection.excludeFromBackup(urls: [temporaryDirectory])

        let values = try temporaryDirectory.resourceValues(forKeys: [.isExcludedFromBackupKey])
        XCTAssertEqual(values.isExcludedFromBackup, true)
    }

    func testIgnoresMissingDirectoriesAndDuplicateURLs() throws {
        let missing = temporaryDirectory.appendingPathComponent("missing")

        XCTAssertNoThrow(
            try SensitiveDataProtection.excludeFromBackup(
                urls: [missing, temporaryDirectory, temporaryDirectory]
            )
        )
        let values = try temporaryDirectory.resourceValues(forKeys: [.isExcludedFromBackupKey])
        XCTAssertEqual(values.isExcludedFromBackup, true)
    }
}
