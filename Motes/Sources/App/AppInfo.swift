import Foundation

enum AppInfo {
    /// "Motes 0.1.0 (1)" from the bundle's version keys.
    static func displayVersion(bundle: Bundle) -> String {
        displayVersion(
            short: bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
            build: bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String
        )
    }

    static func displayVersion(short: String?, build: String?) -> String {
        let short = short?.trimmingCharacters(in: .whitespaces) ?? ""
        let build = build?.trimmingCharacters(in: .whitespaces) ?? ""
        switch (short.isEmpty, build.isEmpty) {
        case (true, _): return "Motes"
        case (false, true): return "Motes \(short)"
        case (false, false): return "Motes \(short) (\(build))"
        }
    }
}
