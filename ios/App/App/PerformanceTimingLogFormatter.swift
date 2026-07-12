import Foundation

enum PerformanceTimingLogFormatter {
    private static let scopes: Set<String> = [
        "project-sync", "project-geojson", "dashboard-map", "offline-map"
    ]
    private static let phases: Set<String> = [
        "cache_load",
        "project_refresh",
        "geojson_sync",
        "overlay_sync",
        "gps_sync",
        "tile_prefetch",
        "total",
        "coverage_source_collection",
        "plan_schedule",
        "cache_read_work",
        "download_work",
        "normalization_work",
        "validation_work",
        "cache_write_work",
        "project_cache_read_work",
        "project_normalization_work",
        "project_total_to_paint"
    ]
    private static let statuses: Set<String> = [
        "applied",
        "skipped",
        "aborted",
        "failed",
        "done",
        "error"
    ]

    static func format(
        scope: String,
        runId: Int,
        phase: String,
        durationMs: Double?,
        status: String
    ) -> String? {
        guard scopes.contains(scope),
              runId >= 0,
              phases.contains(phase),
              statuses.contains(status),
              durationMs.map({ $0.isFinite && $0 >= 0 }) ?? true else {
            return nil
        }

        let duration = durationMs.map {
            String(format: "%.1f", locale: Locale(identifier: "en_US_POSIX"), $0)
        } ?? "skipped"
        return "[\(scope)] run=\(runId) phase=\(phase) durationMs=\(duration) status=\(status)"
    }
}
