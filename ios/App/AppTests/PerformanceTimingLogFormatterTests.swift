import XCTest
@testable import App

final class PerformanceTimingLogFormatterTests: XCTestCase {
    func testFormatsAllowlistedTimingFields() {
        XCTAssertEqual(
            PerformanceTimingLogFormatter.format(
                scope: "project-sync",
                runId: 7,
                phase: "total",
                durationMs: 12.34,
                status: "done"
            ),
            "[project-sync] run=7 phase=total durationMs=12.3 status=done"
        )
    }

    func testFormatsSkippedDurationWithoutInventingAValue() {
        XCTAssertEqual(
            PerformanceTimingLogFormatter.format(
                scope: "project-sync",
                runId: 3,
                phase: "tile_prefetch",
                durationMs: nil,
                status: "applied"
            ),
            "[project-sync] run=3 phase=tile_prefetch durationMs=skipped status=applied"
        )
    }

    func testFormatsGranularGeoJSONAndDashboardTimings() {
        XCTAssertEqual(
            PerformanceTimingLogFormatter.format(
                scope: "project-geojson",
                runId: 4,
                phase: "validation_work",
                durationMs: 25.67,
                status: "applied"
            ),
            "[project-geojson] run=4 phase=validation_work durationMs=25.7 status=applied"
        )
        XCTAssertEqual(
            PerformanceTimingLogFormatter.format(
                scope: "dashboard-map",
                runId: 4,
                phase: "project_total_to_paint",
                durationMs: 31.24,
                status: "applied"
            ),
            "[dashboard-map] run=4 phase=project_total_to_paint durationMs=31.2 status=applied"
        )
    }

    func testRejectsUnknownOrInvalidFields() {
        XCTAssertNil(PerformanceTimingLogFormatter.format(
            scope: "secret", runId: 1, phase: "total", durationMs: 1, status: "done"
        ))
        XCTAssertNil(PerformanceTimingLogFormatter.format(
            scope: "project-sync", runId: -1, phase: "total", durationMs: 1, status: "done"
        ))
        XCTAssertNil(PerformanceTimingLogFormatter.format(
            scope: "project-sync", runId: 1, phase: "token", durationMs: 1, status: "done"
        ))
        XCTAssertNil(PerformanceTimingLogFormatter.format(
            scope: "project-sync", runId: 1, phase: "total", durationMs: -1, status: "done"
        ))
        XCTAssertNil(PerformanceTimingLogFormatter.format(
            scope: "project-sync", runId: 1, phase: "total", durationMs: 1, status: "secret"
        ))
    }
}
