package org.speleodb.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.CookieHandler;
import java.net.URI;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "GisGeometryHttp")
public final class GisGeometryHttpPlugin extends Plugin {
    private final ExecutorService executor = Executors.newFixedThreadPool(4);
    private final Map<String, GisGeometryHttpRequest> requests = new ConcurrentHashMap<>();

    @Override public void load() {
        // CapacitorCookies is registered before app plugins, before WebView startup.
        CookieHandler current = CookieHandler.getDefault();
        if (!(current instanceof GisGeometryCookieHandler)) CookieHandler.setDefault(new GisGeometryCookieHandler(current));
    }

    @PluginMethod public void get(PluginCall call) {
        final String id = call.getString("requestId");
        final GisGeometryHttpRequest request;
        try {
            if (id == null || id.isEmpty()) throw new IllegalArgumentException();
            JSObject supplied = call.getObject("headers", new JSObject());
            Map<String, String> headers = new HashMap<>();
            Iterator<String> keys = supplied.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                headers.put(key, supplied.getString(key));
            }
            request = new GisGeometryHttpRequest(new URI(call.getString("url")), headers, call.getInt("timeoutMs", 10000));
            if (requests.putIfAbsent(id, request) != null) throw new IllegalArgumentException();
        } catch (Exception error) {
            call.reject("Invalid GIS Geometry request", "E_GIS_REQUEST");
            return;
        }
        executor.execute(() -> {
            try {
                GisGeometryHttpRequest.Response response = request.execute();
                JSObject result = new JSObject();
                result.put("status", response.status);
                result.put("body", response.body);
                result.put("contentType", response.contentType);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("GIS Geometry request failed", "E_GIS_NETWORK");
            } finally {
                requests.remove(id, request);
            }
        });
    }

    @PluginMethod public void cancel(PluginCall call) {
        String id = call.getString("requestId");
        GisGeometryHttpRequest request = id == null ? null : requests.get(id);
        if (request != null) request.cancel();
        call.resolve();
    }

    @Override protected void handleOnDestroy() {
        for (GisGeometryHttpRequest request : requests.values()) request.cancel();
        executor.shutdownNow();
    }
}
