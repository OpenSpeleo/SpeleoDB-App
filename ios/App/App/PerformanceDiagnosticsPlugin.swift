import Capacitor
import Foundation
import OSLog

@objc(PerformanceDiagnosticsPlugin)
final class PerformanceDiagnosticsPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "PerformanceDiagnosticsPlugin"
    let jsName = "PerformanceDiagnostics"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "logTiming", returnType: CAPPluginReturnPromise)
    ]

    private let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "org.speleodb.app",
        category: "SpeleoDBPerformance"
    )

    @objc func logTiming(_ call: CAPPluginCall) {
        guard let scope = call.getString("scope"),
              let runId = call.getInt("runId"),
              let phase = call.getString("phase"),
              let status = call.getString("status"),
              let message = PerformanceTimingLogFormatter.format(
                scope: scope,
                runId: runId,
                phase: phase,
                durationMs: call.getDouble("durationMs"),
                status: status
              ) else {
            call.reject("Invalid performance timing record", "E_PERFORMANCE_TIMING")
            return
        }

        logger.notice("\(message, privacy: .public)")
        call.resolve()
    }
}
