import Security
import XCTest
@testable import App

final class KeychainCredentialStoreTests: XCTestCase {
    private var service = ""
    private var account = ""
    private var store: KeychainCredentialStore!

    override func setUpWithError() throws {
        service = "org.speleodb.app.tests.\(UUID().uuidString)"
        account = "authentication-token"
        store = KeychainCredentialStore(service: service, account: account)
        try store.clearToken()
    }

    override func tearDownWithError() throws {
        try store.clearToken()
        store = nil
    }

    func testEmptyStoreReturnsNilAndClearIsIdempotent() throws {
        XCTAssertNil(try store.readToken())

        try store.clearToken()
        try store.clearToken()

        XCTAssertNil(try store.readToken())
    }

    func testTokenRoundTripsAndCanBeReplaced() throws {
        try store.writeToken("first-token-é")
        XCTAssertEqual(try store.readToken(), "first-token-é")

        try store.writeToken("second-token")

        XCTAssertEqual(try store.readToken(), "second-token")
    }

    func testInvalidTokenDoesNotReplaceExistingCredential() throws {
        try store.writeToken("existing-token")

        XCTAssertThrowsError(try store.writeToken(" \n")) { error in
            XCTAssertEqual(error as? KeychainCredentialStoreError, .invalidToken)
        }
        XCTAssertThrowsError(
            try store.writeToken(
                String(repeating: "x", count: KeychainCredentialStore.maximumTokenBytes + 1)
            )
        ) { error in
            XCTAssertEqual(error as? KeychainCredentialStoreError, .invalidToken)
        }

        XCTAssertEqual(try store.readToken(), "existing-token")
    }

    func testMaximumUtf8TokenLengthIsAccepted() throws {
        let token = String(repeating: "x", count: KeychainCredentialStore.maximumTokenBytes)

        try store.writeToken(token)

        XCTAssertEqual(try store.readToken(), token)
    }

    func testMalformedKeychainDataFailsClosed() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: false,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: Data([0xff, 0xfe])
        ]
        XCTAssertEqual(SecItemAdd(query as CFDictionary, nil), errSecSuccess)

        XCTAssertThrowsError(try store.readToken()) { error in
            XCTAssertEqual(error as? KeychainCredentialStoreError, .malformedCredential)
        }
    }
}
