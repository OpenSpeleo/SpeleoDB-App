import Darwin
import Foundation
import XCTest
@testable import SpeleoDB

final class GisGeometryHttpClientTests: XCTestCase {
    private let route = "/api/v2/gis-geometries/"
    private var client: GisGeometryHttpClient!
    private let headers = ["Authorization": "Token native-test-token", "Accept": "application/json"]

    override func setUp() { client = GisGeometryHttpClient() }

    override func tearDown() {
        client.cancelAll()
        client = nil
        for cookie in HTTPCookieStorage.shared.cookies ?? [] where cookie.name.hasPrefix("gis_test_") {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
    }

    func testRequestValidationEnforcesReadOnlyRoutesAndCookieFreeHeaders() throws {
        let request = try GisGeometryHttpClient.makeRequest(url: "https://example.test\(route)", headers: headers, timeoutMs: 5000)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertFalse(request.httpShouldHandleCookies)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Token native-test-token")
        XCTAssertEqual(request.timeoutInterval, 5)
        for suffix in ["/api/v2/gis-geometries", "\(route)not-a-uuid/", "\(route)?page=2", "\(route)#fragment", "/api/v2/gis-layers/"] {
            XCTAssertThrowsError(try GisGeometryHttpClient.makeRequest(url: "https://example.test\(suffix)", headers: headers, timeoutMs: 5000))
        }
        for name in ["Cookie", "cOoKiE2"] {
            XCTAssertThrowsError(try GisGeometryHttpClient.makeRequest(url: "https://example.test\(route)", headers: [name: "sessionid=injected"], timeoutMs: 5000))
        }
        XCTAssertThrowsError(try GisGeometryHttpClient.makeRequest(url: "https://user:password@example.test\(route)", headers: headers, timeoutMs: 5000))
        XCTAssertThrowsError(try GisGeometryHttpClient.makeRequest(url: "https://example.test\(route)", headers: headers, timeoutMs: .infinity))
    }

    func testRealSessionSendsTokenWithoutSharedCookiesAndDoesNotStoreSetCookie() throws {
        let server = try LoopbackHttpServer { _ in
            .init(status: 200, contentType: "application/json", body: "[]", headers: ["Set-Cookie": "gis_test_received=discard; Path=/"])
        }
        defer { server.close() }
        seedCookie()
        let completed = expectation(description: "native request")
        try client.get(id: "read", url: server.url(route), headers: headers, timeoutMs: 5000) { result in
            switch result {
            case .success(let response):
                XCTAssertEqual(response.status, 200)
                XCTAssertEqual(response.body, "[]")
                XCTAssertEqual(response.contentType, "application/json")
            case .failure(let error): XCTFail("Native request failed: \(error)")
            }
            completed.fulfill()
        }
        wait(for: [completed], timeout: 10)
        let sent = try XCTUnwrap(server.requests.first)
        XCTAssertEqual(sent.line, "GET \(route) HTTP/1.1")
        XCTAssertEqual(sent.headers["authorization"], "Token native-test-token")
        XCTAssertEqual(sent.headers["accept"], "application/json")
        XCTAssertNil(sent.headers["cookie"])
        XCTAssertNil(sent.headers["cookie2"])
        XCTAssertTrue(HTTPCookieStorage.shared.cookies?.contains(where: { $0.name == "gis_test_existing" }) == true)
        XCTAssertFalse(HTTPCookieStorage.shared.cookies?.contains(where: { $0.name == "gis_test_received" }) == true)
    }

    func testUnrelatedUrlSessionKeepsSharedCookiesDuringGeometryRequest() throws {
        let geometryStarted = expectation(description: "geometry reached server")
        let releaseGeometry = DispatchSemaphore(value: 0)
        let server = try LoopbackHttpServer { request in
            if request.line.contains("gis-geometries") {
                geometryStarted.fulfill()
                XCTAssertEqual(releaseGeometry.wait(timeout: .now() + 10), .success)
            }
            return .init(status: 200, contentType: "application/json", body: "[]", headers: [:])
        }
        defer { releaseGeometry.signal(); server.close() }
        seedCookie()
        let geometryCompleted = expectation(description: "geometry completed")
        try client.get(id: "geometry", url: server.url(route), headers: headers, timeoutMs: 10000) { _ in geometryCompleted.fulfill() }
        wait(for: [geometryStarted], timeout: 5)
        let otherCompleted = expectation(description: "unrelated request completed")
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = .shared
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        session.dataTask(with: URL(string: server.url("/api/v2/projects/"))!) { _, response, error in
            XCTAssertNil(error)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            otherCompleted.fulfill()
        }.resume()
        wait(for: [otherCompleted], timeout: 5)
        let other = try XCTUnwrap(server.requests.first(where: { $0.line.contains("/projects/") }))
        XCTAssertTrue(other.headers["cookie"]?.contains("gis_test_existing=existing-session") == true)
        releaseGeometry.signal()
        wait(for: [geometryCompleted], timeout: 5)
    }

    func testHtmlAccessErrorsPreserveStatusAndOmitBody() throws {
        for status in [403, 404] {
            let server = try LoopbackHttpServer { _ in .init(status: status, contentType: "text/html; charset=utf-8", body: "<html>private error</html>", headers: [:]) }
            defer { server.close() }
            let completed = expectation(description: "HTTP \(status)")
            try client.get(id: "error-\(status)", url: server.url(route), headers: headers, timeoutMs: 5000) { result in
                switch result {
                case .success(let response):
                    XCTAssertEqual(response.status, status)
                    XCTAssertEqual(response.body, "")
                    XCTAssertEqual(response.contentType, "text/html; charset=utf-8")
                case .failure(let error): XCTFail("Native request failed: \(error)")
                }
                completed.fulfill()
            }
            wait(for: [completed], timeout: 10)
        }
    }

    func testRedirectIsNotFollowedAndCredentialsAreNotReplayed() throws {
        let server = try LoopbackHttpServer { request in
            request.line.contains("gis-geometries")
                ? .init(status: 302, contentType: "text/html", body: "", headers: ["Location": "/redirect-target"])
                : .init(status: 200, contentType: "application/json", body: "[]", headers: [:])
        }
        defer { server.close() }
        let completed = expectation(description: "redirect response")
        try client.get(id: "redirect", url: server.url(route), headers: headers, timeoutMs: 5000) { result in
            switch result {
            case .success(let response): XCTAssertEqual(response.status, 302)
            case .failure(let error): XCTFail("Native request failed: \(error)")
            }
            completed.fulfill()
        }
        wait(for: [completed], timeout: 10)
        XCTAssertEqual(server.requests.count, 1)
    }

    func testDuplicateRequestIdCannotReplaceLiveRequestAndCancellationSettlesIt() throws {
        let started = expectation(description: "request reached server")
        let release = DispatchSemaphore(value: 0)
        let server = try LoopbackHttpServer { _ in
            started.fulfill()
            XCTAssertEqual(release.wait(timeout: .now() + 10), .success)
            return .init(status: 200, contentType: "application/json", body: "[]", headers: [:])
        }
        defer { release.signal(); server.close() }
        let cancelled = expectation(description: "request cancelled")
        try client.get(id: "pending", url: server.url(route), headers: headers, timeoutMs: 10000) { result in
            switch result {
            case .success: XCTFail("Cancelled request must not succeed")
            case .failure(let error): XCTAssertEqual((error as? URLError)?.code, .cancelled)
            }
            cancelled.fulfill()
        }
        wait(for: [started], timeout: 5)
        XCTAssertThrowsError(try client.get(id: "pending", url: server.url(route), headers: headers, timeoutMs: 5000) { _ in XCTFail("Duplicate must not execute") })
        client.cancel(id: "pending")
        wait(for: [cancelled], timeout: 5)
        XCTAssertEqual(server.requests.count, 1)
    }

    func testCancelAllSettlesEveryActiveSession() throws {
        let started = expectation(description: "requests reached server")
        started.expectedFulfillmentCount = 2
        let release = DispatchSemaphore(value: 0)
        let server = try LoopbackHttpServer { _ in
            started.fulfill()
            XCTAssertEqual(release.wait(timeout: .now() + 10), .success)
            return .init(status: 200, contentType: "application/json", body: "[]", headers: [:])
        }
        defer { release.signal(); release.signal(); server.close() }
        let cancelled = expectation(description: "all requests cancelled")
        cancelled.expectedFulfillmentCount = 2
        for id in ["first", "second"] {
            try client.get(id: id, url: server.url(route), headers: headers, timeoutMs: 10000) { result in
                switch result {
                case .success: XCTFail("Cancelled session must not succeed")
                case .failure(let error): XCTAssertEqual((error as? URLError)?.code, .cancelled)
                }
                cancelled.fulfill()
            }
        }
        wait(for: [started], timeout: 5)
        client.cancelAll()
        wait(for: [cancelled], timeout: 5)
    }

    private func seedCookie() {
        let cookie = HTTPCookie(properties: [.domain: "127.0.0.1", .path: "/", .name: "gis_test_existing", .value: "existing-session"])!
        HTTPCookieStorage.shared.setCookie(cookie)
    }
}

/// Local TCP server exercises the real Foundation networking/cookie/delegate path.
private final class LoopbackHttpServer: @unchecked Sendable {
    struct Request { let line: String; let headers: [String: String] }
    struct Reply { let status: Int; let contentType: String; let body: String; let headers: [String: String] }
    private let descriptor: Int32
    private let port: UInt16
    private let work = DispatchGroup()
    private let lock = NSLock()
    private var captured: [Request] = []
    private var stopped = false
    var requests: [Request] { lock.lock(); defer { lock.unlock() }; return captured }

    init(reply: @escaping (Request) -> Reply) throws {
        let listener = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        descriptor = listener
        guard listener >= 0 else { throw POSIXError(.EIO) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        let bound = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(listener, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        guard bound == 0, Darwin.listen(descriptor, 8) == 0 else { Darwin.close(descriptor); throw POSIXError(.EIO) }
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let named = withUnsafeMutablePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(listener, $0, &length) }
        }
        guard named == 0 else { Darwin.close(descriptor); throw POSIXError(.EIO) }
        port = UInt16(bigEndian: address.sin_port)
        work.enter()
        DispatchQueue.global().async { [self] in
            defer { work.leave() }
            while true {
                let connection = Darwin.accept(descriptor, nil, nil)
                guard connection >= 0 else { return }
                work.enter()
                DispatchQueue.global().async { [self] in
                    defer { Darwin.close(connection); work.leave() }
                    var suppressPipe: Int32 = 1
                    setsockopt(connection, SOL_SOCKET, SO_NOSIGPIPE, &suppressPipe, socklen_t(MemoryLayout<Int32>.size))
                    var timeout = timeval(tv_sec: 5, tv_usec: 0)
                    setsockopt(connection, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
                    var bytes = [UInt8](repeating: 0, count: 4096)
                    var received = Data()
                    while received.count < 65536 {
                        let count = Darwin.recv(connection, &bytes, bytes.count, 0)
                        guard count > 0 else { return }
                        received.append(contentsOf: bytes.prefix(count))
                        if received.range(of: Data("\r\n\r\n".utf8)) != nil { break }
                    }
                    let lines = String(decoding: received, as: UTF8.self).components(separatedBy: "\r\n")
                    var headers: [String: String] = [:]
                    for line in lines.dropFirst() {
                        guard let colon = line.firstIndex(of: ":") else { continue }
                        headers[String(line[..<colon]).lowercased()] = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
                    }
                    let request = Request(line: lines[0], headers: headers)
                    lock.lock(); captured.append(request); lock.unlock()
                    let response = reply(request)
                    let body = Data(response.body.utf8)
                    let extra = response.headers.map { "\($0.key): \($0.value)\r\n" }.joined()
                    var output = Data("HTTP/1.1 \(response.status) Test\r\nContent-Type: \(response.contentType)\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\(extra)\r\n".utf8)
                    output.append(body)
                    output.withUnsafeBytes { raw in
                        guard let base = raw.baseAddress else { return }
                        var sent = 0
                        while sent < raw.count {
                            let count = Darwin.send(connection, base.advanced(by: sent), raw.count - sent, 0)
                            guard count > 0 else { return }
                            sent += count
                        }
                    }
                }
            }
        }
    }

    func url(_ path: String) -> String { "http://127.0.0.1:\(port)\(path)" }

    func close() {
        lock.lock()
        guard !stopped else { lock.unlock(); return }
        stopped = true
        lock.unlock()
        Darwin.shutdown(descriptor, SHUT_RDWR)
        Darwin.close(descriptor)
        XCTAssertEqual(work.wait(timeout: .now() + 5), .success, "Loopback server must stop")
    }
}
