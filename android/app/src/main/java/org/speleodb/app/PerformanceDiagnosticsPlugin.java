package org.speleodb.app;

import android.util.Log;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PerformanceDiagnostics")
public final class PerformanceDiagnosticsPlugin extends Plugin {
    private static final String ERROR_CODE = "E_PERFORMANCE_TIMING";
    private static final String LOG_TAG = "SpeleoDBPerformance";

    @PluginMethod
    public void logTiming(PluginCall call) {
        String scope = call.getString("scope");
        Integer runId = call.getInt("runId");
        String phase = call.getString("phase");
        Double durationMs = call.getDouble("durationMs");
        String status = call.getString("status");

        String message = runId == null
            ? null
            : PerformanceTimingLogFormatter.format(scope, runId, phase, durationMs, status);
        if (message == null) {
            call.reject("Invalid performance timing record", ERROR_CODE);
            return;
        }

        Log.i(LOG_TAG, message);
        call.resolve();
    }
}
