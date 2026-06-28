import Foundation

enum SensitiveDataProtection {
    static func apply(fileManager: FileManager = .default) throws {
        let directories: [FileManager.SearchPathDirectory] = [
            .libraryDirectory,
            .documentDirectory,
            .applicationSupportDirectory,
            .cachesDirectory
        ]
        let urls = directories.flatMap {
            fileManager.urls(for: $0, in: .userDomainMask)
        }
        try excludeFromBackup(urls: urls, fileManager: fileManager)
    }

    static func excludeFromBackup(
        urls: [URL],
        fileManager: FileManager = .default
    ) throws {
        var visited = Set<URL>()
        for originalURL in urls where visited.insert(originalURL).inserted {
            guard fileManager.fileExists(atPath: originalURL.path) else { continue }
            var url = originalURL
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try url.setResourceValues(values)
        }
    }
}
