package org.speleodb.app;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

final class PerformanceTimingLogFormatter {
    private static final Set<String> SCOPES = immutableSet(
        "project-sync",
        "project-geojson",
        "dashboard-map",
        "offline-map"
    );
    private static final Set<String> PHASES = immutableSet(
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
    );
    private static final Set<String> STATUSES = immutableSet(
        "applied",
        "skipped",
        "aborted",
        "failed",
        "done",
        "error"
    );

    private PerformanceTimingLogFormatter() {}

    static String format(
        String scope,
        int runId,
        String phase,
        Double durationMs,
        String status
    ) {
        if (!SCOPES.contains(scope)
            || runId < 0
            || !PHASES.contains(phase)
            || !STATUSES.contains(status)
            || (durationMs != null && (!Double.isFinite(durationMs) || durationMs < 0))) {
            return null;
        }

        String duration = durationMs == null
            ? "skipped"
            : String.format(Locale.US, "%.1f", durationMs);
        return String.format(
            Locale.US,
            "[%s] run=%d phase=%s durationMs=%s status=%s",
            scope,
            runId,
            phase,
            duration,
            status
        );
    }

    private static Set<String> immutableSet(String... values) {
        return Collections.unmodifiableSet(new HashSet<>(Arrays.asList(values)));
    }
}
