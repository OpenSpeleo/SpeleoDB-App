package org.speleodb.app;

import android.Manifest;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * RecordingNotificationPermission -- a tiny, Android-only Capacitor plugin whose
 * sole job is to request the POST_NOTIFICATIONS runtime permission (Android 13+,
 * API 33) so the background-geolocation foreground service can show its
 * persistent "recording" notification.
 *
 * This lives in the Android project only -- it is intentionally NOT an npm
 * Capacitor plugin -- so iOS never compiles or references it (iOS has no
 * notification-permission gate for the location background mode). The JS guard
 * ({@code RecordingNotificationPermissionGuard}) short-circuits to "granted" on
 * any non-Android platform, so this plugin is invoked only on Android.
 *
 * See docs/app-permissions.md and docs/gps-tracks.md.
 */
@CapacitorPlugin(
    name = "RecordingNotificationPermission",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class RecordingNotificationPermissionPlugin extends Plugin {

    /**
     * Request POST_NOTIFICATIONS. Resolves {@code { display: "granted" | "denied" }}
     * to mirror the previous @capacitor/local-notifications shape the JS guard
     * expects. Below Android 13 the permission does not exist and notifications are
     * allowed by default, so we resolve "granted" without prompting.
     */
    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            resolveDisplay(call, true);
            return;
        }
        if (getPermissionState("notifications") == PermissionState.GRANTED) {
            resolveDisplay(call, true);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsPermsCallback");
    }

    @PermissionCallback
    private void notificationsPermsCallback(PluginCall call) {
        resolveDisplay(call, getPermissionState("notifications") == PermissionState.GRANTED);
    }

    private void resolveDisplay(PluginCall call, boolean granted) {
        JSObject result = new JSObject();
        result.put("display", granted ? "granted" : "denied");
        call.resolve(result);
    }
}
