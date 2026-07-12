package org.speleodb.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class PerformanceTimingLogFormatterTest {
    @Test
    public void formatsAllowlistedTimingFields() {
        assertEquals(
            "[project-sync] run=7 phase=total durationMs=12.3 status=done",
            PerformanceTimingLogFormatter.format("project-sync", 7, "total", 12.34, "done")
        );
    }

    @Test
    public void formatsSkippedDurationWithoutInventingAValue() {
        assertEquals(
            "[project-sync] run=3 phase=tile_prefetch durationMs=skipped status=applied",
            PerformanceTimingLogFormatter.format(
                "project-sync",
                3,
                "tile_prefetch",
                null,
                "applied"
            )
        );
    }

    @Test
    public void formatsGranularGeoJSONAndDashboardTimings() {
        assertEquals(
            "[project-geojson] run=4 phase=validation_work durationMs=25.7 status=applied",
            PerformanceTimingLogFormatter.format(
                "project-geojson",
                4,
                "validation_work",
                25.67,
                "applied"
            )
        );
        assertEquals(
            "[dashboard-map] run=4 phase=project_total_to_paint durationMs=31.2 status=applied",
            PerformanceTimingLogFormatter.format(
                "dashboard-map",
                4,
                "project_total_to_paint",
                31.24,
                "applied"
            )
        );
    }

    @Test
    public void rejectsUnknownOrInvalidFields() {
        assertNull(PerformanceTimingLogFormatter.format("secret", 1, "total", 1.0, "done"));
        assertNull(PerformanceTimingLogFormatter.format("project-sync", -1, "total", 1.0, "done"));
        assertNull(PerformanceTimingLogFormatter.format("project-sync", 1, "token", 1.0, "done"));
        assertNull(PerformanceTimingLogFormatter.format("project-sync", 1, "total", -1.0, "done"));
        assertNull(PerformanceTimingLogFormatter.format("project-sync", 1, "total", 1.0, "secret"));
    }
}
