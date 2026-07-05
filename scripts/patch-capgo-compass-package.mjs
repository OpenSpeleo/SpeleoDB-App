import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const swiftRoot = path.join(
  repoRoot,
  'node_modules/@capgo/capacitor-compass/ios/Sources/CapgoCompassPlugin',
)

function replaceExactlyOnce(source, expected, replacement, label) {
  if (source.includes(replacement)) return source
  const occurrences = source.split(expected).length - 1
  if (occurrences !== 1) {
    throw new Error(`[compass-patch] Expected one ${label} match, found ${occurrences}.`)
  }
  return source.replace(expected, replacement)
}

function replaceAtMostOnce(source, expected, replacement, label) {
  if (source.includes(replacement)) return source
  const occurrences = source.split(expected).length - 1
  if (occurrences > 1) {
    throw new Error(`[compass-patch] Expected at most one ${label} match, found ${occurrences}.`)
  }
  return occurrences === 0 ? source : source.replace(expected, replacement)
}

function patchFile(fileName, patches) {
  const filePath = path.join(swiftRoot, fileName)
  let source = readFileSync(filePath, 'utf8')
  for (const [label, expected, replacement, optional = false] of patches) {
    source = optional
      ? replaceAtMostOnce(source, expected, replacement, label)
      : replaceExactlyOnce(source, expected, replacement, label)
  }
  writeFileSync(filePath, source)
}

patchFile('CapgoCompass.swift', [
  [
    'UIKit import',
    `import CoreLocation
import os.log`,
    `import CoreLocation
import UIKit
import os.log`,
  ],
  [
    'background-unsafe orientation helper upgrade',
    `    private func updateHeadingOrientation() {
        guard let orientation = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive })?
            .interfaceOrientation else { return }
        switch orientation {
        case .portrait: locationManager.headingOrientation = .portrait
        case .portraitUpsideDown: locationManager.headingOrientation = .portraitUpsideDown
        case .landscapeLeft: locationManager.headingOrientation = .landscapeLeft
        case .landscapeRight: locationManager.headingOrientation = .landscapeRight
        default: break
        }
    }
`,
    `    private var isUpdating = false

    private func performOnMainThread(_ action: @escaping () -> Void) {
        if Thread.isMainThread {
            action()
        } else {
            DispatchQueue.main.sync(execute: action)
        }
    }

    private func updateHeadingOrientationOnMainThread() {
        guard let orientation = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive })?
            .interfaceOrientation else { return }
        switch orientation {
        case .portrait: locationManager.headingOrientation = .portrait
        case .portraitUpsideDown: locationManager.headingOrientation = .portraitUpsideDown
        case .landscapeLeft: locationManager.headingOrientation = .landscapeLeft
        case .landscapeRight: locationManager.headingOrientation = .landscapeRight
        default: break
        }
    }

    @objc public func refreshHeadingOrientation() {
        performOnMainThread { [weak self] in
            self?.updateHeadingOrientationOnMainThread()
        }
    }
`,
    true,
  ],
  [
    'interface-orientation helper',
    `    /// Configure throttling parameters.
`,
    `    private var isUpdating = false

    private func performOnMainThread(_ action: @escaping () -> Void) {
        if Thread.isMainThread {
            action()
        } else {
            DispatchQueue.main.sync(execute: action)
        }
    }

    private func updateHeadingOrientationOnMainThread() {
        guard let orientation = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive })?
            .interfaceOrientation else { return }
        switch orientation {
        case .portrait: locationManager.headingOrientation = .portrait
        case .portraitUpsideDown: locationManager.headingOrientation = .portraitUpsideDown
        case .landscapeLeft: locationManager.headingOrientation = .landscapeLeft
        case .landscapeRight: locationManager.headingOrientation = .landscapeRight
        default: break
        }
    }

    @objc public func refreshHeadingOrientation() {
        performOnMainThread { [weak self] in
            self?.updateHeadingOrientationOnMainThread()
        }
    }

    /// Configure throttling parameters.
`,
  ],
  [
    'obsolete direct orientation refresh',
    `    @objc public func startListeners() {
        updateHeadingOrientation()
        // Reset throttling state`,
    `    @objc public func startListeners() {
        // Reset throttling state`,
    true,
  ],
  [
    'main-thread sensor lifecycle',
    `        if CLLocationManager.headingAvailable() {
            locationManager.startUpdatingLocation()
            locationManager.startUpdatingHeading()
        } else {
            os_log("CLLocationManager heading not available", log: log, type: .error)
        }
    }

    @objc public func stopListeners() {
        locationManager.stopUpdatingLocation()
        locationManager.stopUpdatingHeading()
    }`,
    `        guard CLLocationManager.headingAvailable() else {
            os_log("CLLocationManager heading not available", log: log, type: .error)
            return
        }

        performOnMainThread { [weak self] in
            guard let self else { return }
            if self.isUpdating {
                self.updateHeadingOrientationOnMainThread()
                return
            }
            self.isUpdating = true
            UIDevice.current.beginGeneratingDeviceOrientationNotifications()
            self.updateHeadingOrientationOnMainThread()
            self.locationManager.startUpdatingLocation()
            self.locationManager.startUpdatingHeading()
        }
    }

    @objc public func stopListeners() {
        performOnMainThread { [weak self] in
            guard let self, self.isUpdating else { return }
            self.locationManager.stopUpdatingLocation()
            self.locationManager.stopUpdatingHeading()
            UIDevice.current.endGeneratingDeviceOrientationNotifications()
            self.isUpdating = false
        }
    }`,
  ],
])

patchFile('CapgoCompassPlugin.swift', [
  [
    'orientation-change observer upgrade',
    `    override public func load() {
        NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: OperationQueue.main
        ) { [weak self] _ in
            guard let self, self.isListening else { return }
            self.implementation.startListeners()
        }

        NotificationCenter.default.addObserver(
            forName: UIApplication.willResignActiveNotification,
            object: nil,
            queue: OperationQueue.main
        ) { [weak self] _ in
            self?.implementation.stopListeners()
        }
    }`,
    `    override public func load() {
        NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: OperationQueue.main
        ) { [weak self] _ in
            guard let self, self.isListening else { return }
            self.implementation.startListeners()
        }

        NotificationCenter.default.addObserver(
            forName: UIApplication.willResignActiveNotification,
            object: nil,
            queue: OperationQueue.main
        ) { [weak self] _ in
            self?.implementation.stopListeners()
        }

        NotificationCenter.default.addObserver(
            forName: UIDevice.orientationDidChangeNotification,
            object: nil,
            queue: OperationQueue.main
        ) { [weak self] _ in
            guard let self, self.isListening else { return }
            self.implementation.refreshHeadingOrientation()
        }
    }`,
    true,
  ],
  [
    'sensor lifecycle ownership',
    `    override public func load() {
        implementation.startListeners()

        NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: OperationQueue.main
        ) { [weak self] _ in
            self?.implementation.startListeners()
        }

        NotificationCenter.default.addObserver(
            forName: UIApplication.willResignActiveNotification,
            object: nil,
            queue: OperationQueue.main
        ) { [weak self] _ in
            self?.implementation.stopListeners()
        }
    }`,
    `    override public func load() {
        NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: OperationQueue.main
        ) { [weak self] _ in
            guard let self, self.isListening else { return }
            self.implementation.startListeners()
        }

        NotificationCenter.default.addObserver(
            forName: UIApplication.willResignActiveNotification,
            object: nil,
            queue: OperationQueue.main
        ) { [weak self] _ in
            self?.implementation.stopListeners()
        }

        NotificationCenter.default.addObserver(
            forName: UIDevice.orientationDidChangeNotification,
            object: nil,
            queue: OperationQueue.main
        ) { [weak self] _ in
            guard let self, self.isListening else { return }
            self.implementation.refreshHeadingOrientation()
        }
    }`,
  ],
  [
    'start native sensors',
    `        implementation.setHeadingCallback { [weak self] heading in
            guard let self = self else { return }
            if heading >= 0 {
                self.notifyListeners("headingChange", data: [
                    "value": heading
                ])
            }
        }

        call.resolve()`,
    `        implementation.setHeadingCallback { [weak self] heading in
            guard let self = self else { return }
            if heading >= 0 {
                self.notifyListeners("headingChange", data: [
                    "value": heading
                ])
            }
        }
        implementation.startListeners()

        call.resolve()`,
  ],
  [
    'stop native sensors',
    `        isListening = false
        implementation.setHeadingCallback(nil)

        call.resolve()`,
    `        isListening = false
        implementation.setHeadingCallback(nil)
        implementation.stopListeners()

        call.resolve()`,
  ],
])

console.log('[compass-patch] Applied iOS subscriber lifecycle and orientation corrections.')
