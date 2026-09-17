package org.speleodb.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.CookieHandler;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.HttpCookie;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/** Real HTTP and cookie handling, without Android or transport mocks. */
public final class GisGeometryHttpRequestTest {
    private static final String COLLECTION = "/api/v2/gis-geometries/";
    private CookieHandler originalCookies;
    private CookieManager cookies;
    private ExecutorService client;

    @Before public void setUp() {
        originalCookies = CookieHandler.getDefault();
        cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        CookieHandler.setDefault(new GisGeometryCookieHandler(cookies));
        client = Executors.newSingleThreadExecutor();
    }

    @After public void tearDown() throws Exception {
        client.shutdownNow();
        assertTrue("Request worker must stop", client.awaitTermination(5, TimeUnit.SECONDS));
        CookieHandler.setDefault(originalCookies);
    }

    @Test public void geometryUsesTokenAndJsonWithoutSendingOrAcceptingSessionCookies() throws Exception {
        try (Loopback server = new Loopback((request, socket) -> respond(socket, 200, "application/json", "[]", "Set-Cookie: geometry_secret=discard; Path=/\r\n"))) {
            seed(server.uri(COLLECTION));
            GisGeometryHttpRequest.Response result = request(server.uri(COLLECTION)).execute();
            assertEquals(200, result.status);
            assertEquals("[]", result.body);
            assertEquals("application/json", result.contentType);
            Captured sent = server.requests.get(0);
            assertEquals("GET " + COLLECTION + " HTTP/1.1", sent.requestLine);
            assertEquals("Token test-token", sent.headers.get("authorization"));
            assertEquals("application/json", sent.headers.get("accept"));
            assertNull(sent.headers.get("cookie"));
            assertNull(sent.headers.get("cookie2"));
            assertEquals(1, cookies.getCookieStore().getCookies().size());
            assertEquals("sessionid", cookies.getCookieStore().getCookies().get(0).getName());
            assertEquals("existing-session", cookies.getCookieStore().getCookies().get(0).getValue());
        }
    }

    @Test public void unrelatedRequestsKeepTheirCookiesWhileGeometryIsInFlight() throws Exception {
        CountDownLatch geometryStarted = new CountDownLatch(1);
        CountDownLatch releaseGeometry = new CountDownLatch(1);
        try (Loopback server = new Loopback((sent, socket) -> {
            if (sent.requestLine.contains(COLLECTION)) {
                geometryStarted.countDown();
                assertTrue(releaseGeometry.await(5, TimeUnit.SECONDS));
                respond(socket, 200, "application/json", "[]", "Set-Cookie: geometry_secret=discard; Path=/\r\n");
            } else {
                respond(socket, 200, "application/json", "[]", "Set-Cookie: unrelated=retained; Path=/\r\n");
            }
        })) {
            seed(server.uri(COLLECTION));
            Future<GisGeometryHttpRequest.Response> geometry = client.submit(() -> request(server.uri(COLLECTION)).execute());
            try {
                assertTrue(geometryStarted.await(5, TimeUnit.SECONDS));
                HttpURLConnection unrelated = (HttpURLConnection) server.uri("/api/v2/projects/").toURL().openConnection();
                unrelated.setConnectTimeout(5000);
                unrelated.setReadTimeout(5000);
                try {
                    assertEquals(200, unrelated.getResponseCode());
                    unrelated.getInputStream().close();
                } finally { unrelated.disconnect(); }
                Captured project = server.requests.stream().filter(value -> value.requestLine.contains("/projects/")).findFirst().orElseThrow(AssertionError::new);
                assertNotNull(project.headers.get("cookie"));
                assertTrue(project.headers.get("cookie").contains("sessionid=existing-session"));
                assertTrue(cookies.getCookieStore().getCookies().stream().anyMatch(cookie -> cookie.getName().equals("unrelated")));
                assertFalse(cookies.getCookieStore().getCookies().stream().anyMatch(cookie -> cookie.getName().equals("geometry_secret")));
            } finally { releaseGeometry.countDown(); }
            assertEquals(200, geometry.get(5, TimeUnit.SECONDS).status);
            assertFalse(cookies.getCookieStore().getCookies().stream().anyMatch(cookie -> cookie.getName().equals("geometry_secret")));
        }
    }

    @Test public void forbiddenAndNotFoundHtmlReturnStatusWithoutParsingOrReflectingBody() throws Exception {
        for (int status : new int[] { 403, 404 }) {
            try (Loopback server = new Loopback((sent, socket) -> respond(socket, status, "text/html; charset=utf-8", "<html>private error details</html>", ""))) {
                GisGeometryHttpRequest.Response result = request(server.uri(COLLECTION)).execute();
                assertEquals(status, result.status);
                assertEquals("", result.body);
                assertEquals("text/html; charset=utf-8", result.contentType);
            }
        }
    }

    @Test public void redirectIsReturnedWithoutReplayingCredentialsAtItsTarget() throws Exception {
        try (Loopback server = new Loopback((sent, socket) -> {
            if (sent.requestLine.contains(COLLECTION)) respond(socket, 302, "text/html", "", "Location: /redirect-target\r\n");
            else respond(socket, 200, "application/json", "[]", "");
        })) {
            GisGeometryHttpRequest.Response result = request(server.uri(COLLECTION)).execute();
            assertEquals(302, result.status);
            assertEquals("", result.body);
            assertEquals(1, server.requests.size());
        }
    }

    @Test public void cancelBeforeExecuteDoesNotOpenAConnection() throws Exception {
        try (Loopback server = new Loopback((sent, socket) -> respond(socket, 200, "application/json", "[]", ""))) {
            GisGeometryHttpRequest request = request(server.uri(COLLECTION));
            request.cancel();
            assertThrows(IOException.class, request::execute);
            assertTrue(server.requests.isEmpty());
        }
    }

    @Test public void cancellationClosesAnInFlightConnectionWithoutPublishingTheResponse() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try (Loopback server = new Loopback((sent, socket) -> {
            started.countDown();
            assertTrue(release.await(5, TimeUnit.SECONDS));
            try { respond(socket, 200, "application/json", "[]", ""); }
            catch (IOException expectedDisconnect) { /* The client cancelled this response. */ }
        })) {
            GisGeometryHttpRequest request = request(server.uri(COLLECTION));
            Future<GisGeometryHttpRequest.Response> result = client.submit(request::execute);
            try {
                assertTrue(started.await(5, TimeUnit.SECONDS));
                request.cancel();
                ExecutionException failure = assertThrows(ExecutionException.class, () -> result.get(5, TimeUnit.SECONDS));
                assertTrue(failure.getCause() instanceof IOException);
            } finally { release.countDown(); }
        }
    }

    @Test public void rejectsRoutesAndCredentialsOutsideTheReadOnlyContract() throws Exception {
        URI origin = new URI("https://example.test");
        for (String path : new String[] { "/api/v2/gis-geometries", COLLECTION + "not-a-uuid/", COLLECTION + "?page=2", COLLECTION + "#fragment", "/api/v2/gis-layers/" }) {
            assertThrows(IllegalArgumentException.class, () -> request(origin.resolve(path)));
        }
        assertThrows(IllegalArgumentException.class, () -> request(new URI("https://user:password@example.test" + COLLECTION)));
        assertThrows(IllegalArgumentException.class, () -> new GisGeometryHttpRequest(origin.resolve(COLLECTION), Collections.singletonMap("cOoKiE", "sessionid=injected"), 1000));
        assertThrows(IllegalArgumentException.class, () -> new GisGeometryHttpRequest(origin.resolve(COLLECTION), Collections.singletonMap("CoOkIe2", "sessionid=injected"), 1000));
        assertThrows(IllegalArgumentException.class, () -> new GisGeometryHttpRequest(origin.resolve(COLLECTION), Collections.emptyMap(), 0));
    }

    private GisGeometryHttpRequest request(URI uri) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Authorization", "Token test-token");
        headers.put("Accept", "application/json");
        return new GisGeometryHttpRequest(uri, headers, 5000);
    }

    private void seed(URI uri) {
        HttpCookie session = new HttpCookie("sessionid", "existing-session");
        session.setVersion(0);
        session.setPath("/");
        cookies.getCookieStore().add(uri, session);
    }

    private static void respond(Socket socket, int status, String contentType, String body, String headers) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String response = "HTTP/1.1 " + status + " Test\r\nContent-Type: " + contentType + "\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\n" + headers + "\r\n";
        socket.getOutputStream().write(response.getBytes(StandardCharsets.US_ASCII));
        socket.getOutputStream().write(bytes);
        socket.getOutputStream().flush();
    }

    private interface Reply { void send(Captured request, Socket socket) throws Exception; }
    private static final class Captured {
        final String requestLine;
        final Map<String, String> headers;
        Captured(String requestLine, Map<String, String> headers) { this.requestLine = requestLine; this.headers = headers; }
    }
    private static final class Loopback implements AutoCloseable {
        final List<Captured> requests = new CopyOnWriteArrayList<>();
        private final List<Future<?>> replies = new ArrayList<>();
        private final ServerSocket server = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
        private final ExecutorService workers = Executors.newFixedThreadPool(3);
        private final Future<?> accept;
        private volatile boolean closed;

        Loopback(Reply reply) throws IOException {
            accept = workers.submit(() -> {
                while (!closed) {
                    try {
                        Socket socket = server.accept();
                        synchronized (replies) {
                            replies.add(workers.submit(() -> {
                                try (Socket active = socket) {
                                    active.setSoTimeout(5000);
                                    BufferedReader input = new BufferedReader(new InputStreamReader(active.getInputStream(), StandardCharsets.US_ASCII));
                                    String requestLine = input.readLine();
                                    Map<String, String> headers = new HashMap<>();
                                    String line;
                                    while ((line = input.readLine()) != null && !line.isEmpty()) {
                                        int colon = line.indexOf(':');
                                        headers.put(line.substring(0, colon).toLowerCase(Locale.ROOT), line.substring(colon + 1).trim());
                                    }
                                    Captured request = new Captured(requestLine, headers);
                                    requests.add(request);
                                    reply.send(request, active);
                                } catch (Exception error) { throw new RuntimeException(error); }
                            }));
                        }
                    } catch (IOException error) {
                        if (!closed) throw new RuntimeException(error);
                    }
                }
            });
        }

        URI uri(String path) { return URI.create("http://127.0.0.1:" + server.getLocalPort() + path); }

        @Override public void close() throws Exception {
            closed = true;
            server.close();
            try {
                accept.get(5, TimeUnit.SECONDS);
                synchronized (replies) { for (Future<?> reply : replies) reply.get(5, TimeUnit.SECONDS); }
            } finally {
                workers.shutdownNow();
                assertTrue("Loopback workers must stop", workers.awaitTermination(5, TimeUnit.SECONDS));
            }
        }
    }
}
