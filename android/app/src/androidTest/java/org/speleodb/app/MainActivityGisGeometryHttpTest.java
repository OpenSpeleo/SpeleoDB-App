package org.speleodb.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.webkit.CookieManager;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.PluginHandle;
import java.net.CookieHandler;
import java.net.URI;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Verifies the shipped Activity installs policy around Capacitor's real WebView cookie jar. */
@RunWith(AndroidJUnit4.class)
public final class MainActivityGisGeometryHttpTest {
    private static final String ORIGIN = "https://gis-cookie-test.invalid";

    @Test public void registeredPluginOmitsGeometryCookiesWithoutClearingOtherRoutes() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            CountDownLatch seeded = new CountDownLatch(1);
            scenario.onActivity(activity -> {
                PluginHandle plugin = activity.getBridge().getPlugin("GisGeometryHttp");
                assertNotNull("Activity must register the GIS native transport", plugin);
                assertTrue(plugin.getInstance() instanceof GisGeometryHttpPlugin);
                assertTrue(CookieHandler.getDefault() instanceof GisGeometryCookieHandler);
                CookieManager.getInstance().setCookie(ORIGIN, "sessionid=instrumented-session; Path=/; Secure", accepted -> {
                    assertTrue(accepted);
                    seeded.countDown();
                });
            });
            assertTrue("WebView cookie write must complete", seeded.await(5, TimeUnit.SECONDS));
            try {
                CookieHandler handler = CookieHandler.getDefault();
                URI geometry = URI.create(ORIGIN + "/api/v2/gis-geometries/");
                URI detail = URI.create(ORIGIN + "/api/v2/gis-geometries/12345678-1234-4234-8234-123456789abc/");
                URI projects = URI.create(ORIGIN + "/api/v2/projects/");
                assertTrue(handler.get(geometry, Collections.emptyMap()).isEmpty());
                assertTrue(handler.get(detail, Collections.emptyMap()).isEmpty());
                Map<String, List<String>> other = handler.get(projects, Collections.emptyMap());
                assertTrue(other.values().stream().flatMap(List::stream).anyMatch(value -> value.contains("sessionid=instrumented-session")));
                handler.put(geometry, Collections.singletonMap("Set-Cookie", Collections.singletonList("geometry_secret=discard; Path=/; Secure")));
                String retained = CookieManager.getInstance().getCookie(ORIGIN);
                assertNotNull(retained);
                assertTrue(retained.contains("sessionid=instrumented-session"));
                assertFalse(retained.contains("geometry_secret"));
            } finally {
                CountDownLatch cleaned = new CountDownLatch(1);
                scenario.onActivity(activity -> CookieManager.getInstance().setCookie(ORIGIN, "sessionid=; Max-Age=0; Path=/; Secure", accepted -> cleaned.countDown()));
                assertTrue("Test cookie cleanup must complete", cleaned.await(5, TimeUnit.SECONDS));
            }
        }
    }
}
