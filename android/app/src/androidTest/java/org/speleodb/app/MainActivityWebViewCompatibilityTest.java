package org.speleodb.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.Bridge;
import com.getcapacitor.WebViewListener;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Run on both an old and a supported WebView: exercises Capacitor's real startup gate. */
@RunWith(AndroidJUnit4.class)
public final class MainActivityWebViewCompatibilityTest {
    @Test public void startupLoadsOnlyThePageSupportedByTheInstalledEngine() throws Exception {
        CountDownLatch loaded = new CountDownLatch(1);
        AtomicReference<JSONObject> snapshot = new AtomicReference<>();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        AtomicBoolean supported = new AtomicBoolean();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                Bridge bridge = activity.getBridge();
                assertEquals(111, bridge.getConfig().getMinWebViewVersion());
                assertEquals("webview-update.html", bridge.getConfig().getErrorPath());
                supported.set(bridge.isMinimumWebViewInstalled());
                WebViewListener listener = new WebViewListener() {
                    @Override public void onPageLoaded(WebView webView) {
                        webView.evaluateJavascript(
                            "JSON.stringify({ready:document.readyState,url:location.href,path:location.pathname,"
                                + "scripts:document.querySelectorAll('script[src]').length,"
                                + "heading:document.querySelector('h1')?.textContent})",
                            value -> {
                                try {
                                    JSONObject result = new JSONObject((String) new JSONTokener(value).nextValue());
                                    if (!"complete".equals(result.getString("ready"))) return;
                                    if ("about:blank".equals(result.getString("url"))) return;
                                    snapshot.set(result);
                                } catch (Exception error) {
                                    failure.set(error);
                                }
                                loaded.countDown();
                            }
                        );
                    }
                };
                bridge.addWebViewListener(listener);
                // Covers a page that finished before the listener was registered.
                listener.onPageLoaded(bridge.getWebView());
            });
            assertTrue("The packaged startup page must finish loading", loaded.await(15, TimeUnit.SECONDS));
            if (failure.get() != null) throw new AssertionError(failure.get());
            JSONObject result = snapshot.get();
            if (supported.get()) {
                assertFalse("/webview-update.html".equals(result.getString("path")));
                assertTrue("Supported engines must load the real app", result.getInt("scripts") > 0);
            } else {
                assertEquals("/webview-update.html", result.getString("path"));
                assertEquals("Unsupported engines must not load the app bundle", 0, result.getInt("scripts"));
                assertEquals("A browser update is needed", result.getString("heading"));
            }
        }
    }
}
