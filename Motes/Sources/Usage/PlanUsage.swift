import Foundation

/// How much of the Claude plan's limits is used, from the `rate_limits` of
/// Claude Code's status line. Only Pro and Max plans (or a gateway with a
/// spend limit) send it. The usage is the account's, not a session's.
struct PlanUsage: Equatable, Sendable {
    enum Kind: String, CaseIterable, Sendable {
        case fiveHour = "five_hour"
        case sevenDay = "seven_day"
        case spend = "spend_limit"

        var label: String {
            switch self {
            case .fiveHour: "5h"
            case .sevenDay: "7d"
            case .spend: "Spend"
            }
        }
    }

    struct Window: Equatable, Sendable {
        let kind: Kind
        /// 0 to 100, above 100 once a spend limit is exceeded.
        let usedPercent: Double
        let resetsAt: Date

        var level: Level {
            usedPercent >= PlanUsage.nearLimit ? .critical : usedPercent >= PlanUsage.high ? .high : .normal
        }
    }

    enum Level: Equatable, Sendable { case normal, high, critical }

    /// Windows in `Kind` order.
    let windows: [Window]

    static let high: Double = 70
    /// From here on, idle Claude motes look tired.
    static let nearLimit: Double = 90

    /// Reads `rate_limits`; `nil` when it holds no window.
    static func parse(_ rateLimits: Any?) -> PlanUsage? {
        guard let limits = rateLimits as? [String: Any] else { return nil }
        let windows = Kind.allCases.compactMap { kind -> Window? in
            guard let window = limits[kind.rawValue] as? [String: Any],
                  let used = (window["used_percentage"] as? NSNumber)?.doubleValue, used.isFinite,
                  let resets = (window["resets_at"] as? NSNumber)?.doubleValue, resets.isFinite
            else { return nil }
            return Window(kind: kind, usedPercent: max(0, used), resetsAt: Date(timeIntervalSince1970: resets))
        }
        return windows.isEmpty ? nil : PlanUsage(windows: windows)
    }

    /// Without the windows that have reset by `now`; `nil` once none is left.
    func current(at now: Date) -> PlanUsage? {
        let left = windows.filter { $0.resetsAt > now }
        return left.isEmpty ? nil : PlanUsage(windows: left)
    }

    /// When the next window resets, to drop it on time.
    var nextReset: Date? { windows.map(\.resetsAt).min() }

    /// The window closest to its limit.
    var peak: Window? { windows.max { $0.usedPercent < $1.usedPercent } }

    var isNearLimit: Bool { (peak?.usedPercent ?? 0) >= Self.nearLimit }

    /// An idle Claude mote looks tired while the plan is near its limit.
    func adjusted(_ state: MoteState, agent: String) -> MoteState {
        state == .idle && agent == BridgeProtocol.defaultAgent && isNearLimit ? .tired : state
    }
}
