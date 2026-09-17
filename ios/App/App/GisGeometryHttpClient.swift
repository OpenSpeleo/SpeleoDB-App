import Foundation

/// A scoped GET transport: shared browser sessions never participate in token reads.
final class GisGeometryHttpClient: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    struct Response {
        let status: Int
        let body: String
        let contentType: String
    }

    enum RequestError: Error { case invalidRequest, invalidResponse }
    private struct Pending {
        let task: URLSessionDataTask
        let session: URLSession
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
        let task = session.dataTask(with: request) { [weak self] data, response, error in
            self?.lock.lock()
            let completed = self?.pending.removeValue(forKey: id)
            self?.lock.unlock()
            completed?.session.finishTasksAndInvalidate()
            if let error = error { completion(.failure(error)); return }
            guard let response = response as? HTTPURLResponse else {
                completion(.failure(RequestError.invalidResponse)); return
            }
            completion(.success(Response(
                status: response.statusCode,
                body: (200..<300).contains(response.statusCode)
                    ? String(data: data ?? Data(), encoding: .utf8) ?? "" : "",
                contentType: response.value(forHTTPHeaderField: "Content-Type") ?? ""
            )))
        }
        pending[id] = Pending(task: task, session: session)
        lock.unlock()
        task.resume()
    }

    func cancel(id: String) {
        lock.lock()
        let task = pending[id]?.task
        lock.unlock()
        task?.cancel()
    }

    func cancelAll() {
        lock.lock()
        let sessions = pending.values.map(\.session)
        lock.unlock()
        sessions.forEach { $0.invalidateAndCancel() }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
