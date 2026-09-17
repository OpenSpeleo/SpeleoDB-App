package org.speleodb.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Raw-body GET preserves status before any JSON decoding, including error bodies. */
public final class GisGeometryHttpRequest {
    private static final ScheduledThreadPoolExecutor DEADLINES = createDeadlineExecutor();

    private static ScheduledThreadPoolExecutor createDeadlineExecutor() {
        ScheduledThreadPoolExecutor executor = new ScheduledThreadPoolExecutor(1, runnable -> {
            Thread thread = new Thread(runnable, "gis-http-deadlines");
            thread.setDaemon(true);
            return thread;
        });
        executor.setRemoveOnCancelPolicy(true);
        return executor;
    }

    public static final class Response {
        public final int status;
        public final String body;
        public final String contentType;
        Response(int status, String body, String contentType) {
            this.status = status;
            this.body = body;
            this.contentType = contentType == null ? "" : contentType;
        }
    }

    private final URI uri;
    private final Map<String, String> headers;
    private final int timeoutMs;
    private HttpURLConnection connection;
    private boolean cancelled;

    public GisGeometryHttpRequest(URI uri, Map<String, String> headers, int timeoutMs) {
        if (!GisGeometryCookieHandler.isGeometryRoute(uri)
            || !("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))
            || uri.getHost() == null || uri.getUserInfo() != null
            || uri.getQuery() != null || uri.getFragment() != null || timeoutMs <= 0
            || headers.keySet().stream().anyMatch(key -> "cookie".equalsIgnoreCase(key) || "cookie2".equalsIgnoreCase(key))) {
            throw new IllegalArgumentException("Invalid GIS Geometry request");
        }
        this.uri = uri;
        this.headers = headers;
        this.timeoutMs = timeoutMs;
    }

    public synchronized void cancel() {
        cancelled = true;
        if (connection != null) connection.disconnect();
    }

    public Response execute() throws IOException {
        final long deadlineNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
        HttpURLConnection active;
        synchronized (this) {
            if (cancelled) throw new IOException("Request cancelled");
            active = (HttpURLConnection) uri.toURL().openConnection();
            connection = active;
        }
        // Socket read timeouts reset on each byte. Native ownership is necessary
        // when a background WebView pauses the JavaScript deadline/cancel timer.
        ScheduledFuture<?> deadline = DEADLINES.schedule(this::cancel, timeoutMs, TimeUnit.MILLISECONDS);
        try {
            active.setRequestMethod("GET");
            active.setInstanceFollowRedirects(false);
            active.setConnectTimeout(timeoutMs);
            active.setReadTimeout(timeoutMs);
            active.setUseCaches(false);
            for (Map.Entry<String, String> header : headers.entrySet()) {
                active.setRequestProperty(header.getKey(), header.getValue());
            }
            int status = active.getResponseCode();
            // The caller needs only the status for errors; never decode their body.
            String body = "";
            if (status >= 200 && status < 300) {
                try (InputStream stream = active.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = stream.read(buffer)) != -1) {
                        checkActive(deadlineNanos);
                        bytes.write(buffer, 0, count);
                    }
                    body = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
                }
            }
            checkActive(deadlineNanos);
            return new Response(status, body, active.getContentType());
        } finally {
            deadline.cancel(false);
            active.disconnect();
            synchronized (this) { connection = null; }
        }
    }

    private synchronized void checkActive(long deadlineNanos) throws IOException {
        if (cancelled) throw new IOException("Request cancelled");
        if (System.nanoTime() - deadlineNanos >= 0) throw new IOException("Request timed out");
    }
}
