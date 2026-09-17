import Foundation

/// A scoped GET transport: shared browser sessions never participate in token reads.
final class GisGeometryHttpClient: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    struct Response {
        let status: Int
        let body: String
        let contentType: String
    }

    enum RequestError: Error { case invalidRequest, invalidResponse }
    private struct Pending {
        let task: URLSessionDataTask
        let session: URLSession
        let completion: (Result<Response, Error>) -> Void
        var headerResponse: Response?
        var data = Data()
        var cancelled = false
    }
    private let lock = NSLock()
    private var pending: [String: Pending] = [:]

    static func makeRequest(url: String, headers: [String: String], timeoutMs: Double) throws -> URLRequest {
        guard let components = URLComponents(string: url),
              let address = components.url,
              ["http", "https"].contains(components.scheme ?? ""),
              components.host != nil, components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil,
              components.path.range(
                of: "^/api/v2/gis-geometries/(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/)?$",
                options: [.regularExpression, .caseInsensitive]
              ) != nil,
              timeoutMs.isFinite, timeoutMs > 0,
              !headers.keys.contains(where: { ["cookie", "cookie2"].contains($0.lowercased()) }) else {
            throw RequestError.invalidRequest
        }
        var request = URLRequest(url: address, cachePolicy: .reloadIgnoringLocalCacheData,
                                 timeoutInterval: timeoutMs / 1000)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.allHTTPHeaderFields = headers
        return request
    }

    func get(id: String, url: String, headers: [String: String], timeoutMs: Double,
             completion: @escaping (Result<Response, Error>) -> Void) throws {
        guard !id.isEmpty else { throw RequestError.invalidRequest }
        let request = try Self.makeRequest(url: url, headers: headers, timeoutMs: timeoutMs)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.timeoutIntervalForResource = timeoutMs / 1000
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        lock.lock()
        guard pending[id] == nil else {
            lock.unlock()
            session.invalidateAndCancel()
            throw RequestError.invalidRequest
        }
        let task = session.dataTask(with: request)
        pending[id] = Pending(task: task, session: session, completion: completion)
        lock.unlock()
        task.resume()
    }

    func cancel(id: String) {
        lock.lock()
        pending[id]?.cancelled = true
        let task = pending[id]?.task
        lock.unlock()
        task?.cancel()
    }

    func cancelAll() {
        lock.lock()
        for id in pending.keys { pending[id]?.cancelled = true }
        let sessions = pending.values.map(\.session)
        lock.unlock()
        sessions.forEach { $0.invalidateAndCancel() }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            return
        }
        // Access denial is authoritative as soon as headers arrive. Reading its
        // body could turn a received 403/404 into a misleading network timeout.
        lock.lock()
        if let id = pending.first(where: { $0.value.task === dataTask })?.key,
           pending[id]?.cancelled == false {
            pending[id]?.headerResponse = Response(
                status: http.statusCode, body: "",
                contentType: http.value(forHTTPHeaderField: "Content-Type") ?? ""
            )
        }
        lock.unlock()
        completionHandler((200..<300).contains(http.statusCode) ? .allow : .cancel)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        if let id = pending.first(where: { $0.value.task === dataTask })?.key,
           pending[id]?.cancelled == false {
            pending[id]?.data.append(data)
        }
        lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let id = pending.first(where: { $0.value.task === task })?.key
        let completed = id.flatMap { pending.removeValue(forKey: $0) }
        lock.unlock()
        guard let completed else { return }
        completed.session.finishTasksAndInvalidate()
        if completed.cancelled { completed.completion(.failure(URLError(.cancelled))); return }
        if let response = completed.headerResponse, !(200..<300).contains(response.status) {
            completed.completion(.success(response)); return
        }
        if let error { completed.completion(.failure(error)); return }
        guard let response = completed.headerResponse else {
            completed.completion(.failure(RequestError.invalidResponse)); return
        }
        completed.completion(.success(Response(status: response.status,
            body: String(data: completed.data, encoding: .utf8) ?? "", contentType: response.contentType)))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
