package org.speleodb.app;

import java.io.IOException;
import java.net.CookieHandler;
import java.net.URI;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** Permanent route policy; never swaps or clears another request's cookie jar. */
public final class GisGeometryCookieHandler extends CookieHandler {
    private static final Pattern ROUTE = Pattern.compile(
        "/api/v2/gis-geometries/(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/)?",
        Pattern.CASE_INSENSITIVE
    );
    private final CookieHandler delegate;

    public GisGeometryCookieHandler(CookieHandler delegate) { this.delegate = delegate; }

    public static boolean isGeometryRoute(URI uri) {
        return uri != null && ROUTE.matcher(uri.getPath()).matches();
    }

    @Override
    public Map<String, List<String>> get(URI uri, Map<String, List<String>> headers) throws IOException {
        return isGeometryRoute(uri) || delegate == null ? Collections.emptyMap() : delegate.get(uri, headers);
    }

    @Override
    public void put(URI uri, Map<String, List<String>> headers) throws IOException {
        if (!isGeometryRoute(uri) && delegate != null) delegate.put(uri, headers);
    }
}
