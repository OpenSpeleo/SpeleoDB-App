import Capacitor
import Foundation

@objc(CredentialStorePlugin)
final class CredentialStorePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "CredentialStorePlugin"
    let jsName = "CredentialStore"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "readToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearToken", returnType: CAPPluginReturnPromise)
    ]

    private let credentialStore = KeychainCredentialStore()

    @objc func readToken(_ call: CAPPluginCall) {
        do {
            call.resolve(["token": try credentialStore.readToken() ?? NSNull()])
        } catch {
            rejectUnavailable(call)
        }
    }

    @objc func writeToken(_ call: CAPPluginCall) {
        guard let token = call.getString("token") else {
            call.reject("A valid authentication token is required", "E_CREDENTIAL_STORE")
            return
        }
        do {
            try credentialStore.writeToken(token)
            call.resolve()
        } catch {
            rejectUnavailable(call)
        }
    }

    @objc func clearToken(_ call: CAPPluginCall) {
        do {
            try credentialStore.clearToken()
            call.resolve()
        } catch {
            rejectUnavailable(call)
        }
    }

    private func rejectUnavailable(_ call: CAPPluginCall) {
        call.reject("Secure credential storage is unavailable", "E_CREDENTIAL_STORE")
    }
}
