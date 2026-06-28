import Foundation
import Security

enum KeychainCredentialStoreError: Error, Equatable {
    case invalidToken
    case malformedCredential
    case unexpectedStatus(OSStatus)
}

final class KeychainCredentialStore {
    static let maximumTokenBytes = 16 * 1024

    private let service: String
    private let account: String

    init(
        service: String = "org.speleodb.app.credentials.v1",
        account: String = "authentication-token"
    ) {
        self.service = service
        self.account = account
    }

    func readToken() throws -> String? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else {
            throw KeychainCredentialStoreError.unexpectedStatus(status)
        }
        guard
            let data = result as? Data,
            let token = String(data: data, encoding: .utf8)
        else {
            throw KeychainCredentialStoreError.malformedCredential
        }
        try validate(token)
        return token
    }

    func writeToken(_ token: String) throws {
        try validate(token)
        let data = Data(token.utf8)
        let updateStatus = SecItemUpdate(
            baseQuery() as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        if updateStatus == errSecSuccess {
            return
        }
        guard updateStatus == errSecItemNotFound else {
            throw KeychainCredentialStoreError.unexpectedStatus(updateStatus)
        }

        var addQuery = baseQuery()
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        if addStatus == errSecDuplicateItem {
            let retryStatus = SecItemUpdate(
                baseQuery() as CFDictionary,
                [kSecValueData as String: data] as CFDictionary
            )
            guard retryStatus == errSecSuccess else {
                throw KeychainCredentialStoreError.unexpectedStatus(retryStatus)
            }
            return
        }
        guard addStatus == errSecSuccess else {
            throw KeychainCredentialStoreError.unexpectedStatus(addStatus)
        }
    }

    func clearToken() throws {
        let status = SecItemDelete(baseQuery() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainCredentialStoreError.unexpectedStatus(status)
        }
    }

    private func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: false
        ]
    }

    private func validate(_ token: String) throws {
        guard
            !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            token.utf8.count <= Self.maximumTokenBytes
        else {
            throw KeychainCredentialStoreError.invalidToken
        }
    }
}
