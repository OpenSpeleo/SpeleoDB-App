import Capacitor
import Foundation

@objc(GisGeometryHttpPlugin)
final class GisGeometryHttpPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "GisGeometryHttpPlugin"
    let jsName = "GisGeometryHttp"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]
    private let client = GisGeometryHttpClient()

    @objc func get(_ call: CAPPluginCall) {
        guard let id = call.getString("requestId"), let url = call.getString("url"),
              let headers = call.getObject("headers") as? [String: String],
              let timeout = call.getDouble("timeoutMs") else {
            call.reject("Invalid GIS Geometry request", "E_GIS_REQUEST"); return
        }
        do {
            try client.get(id: id, url: url, headers: headers, timeoutMs: timeout) { result in
                switch result {
                case .success(let response):
                    call.resolve(["status": response.status, "body": response.body,
                                  "contentType": response.contentType])
                case .failure:
                    call.reject("GIS Geometry request failed", "E_GIS_NETWORK")
                }
            }
        } catch {
            call.reject("Invalid GIS Geometry request", "E_GIS_REQUEST")
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        if let id = call.getString("requestId") { client.cancel(id: id) }
        call.resolve()
    }

    deinit { client.cancelAll() }
}
