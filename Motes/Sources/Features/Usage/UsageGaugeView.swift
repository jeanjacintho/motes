import SwiftUI

/// Claude plan usage on the open island's right shoulder: a ring and a
/// percentage per window. Near a limit only that window shows, with when it resets.
struct UsageGaugeView: View {
    let usage: PlanUsage

    var body: some View {
        let critical = usage.windows.filter { $0.level == .critical }
        let shown = critical.isEmpty ? usage.windows : critical
        HStack(spacing: 10) {
            ForEach(shown, id: \.kind) { window in
                WindowGauge(window: window, showsReset: shown.count == 1 && window.level == .critical)
            }
        }
        .help(help)
    }

    private var help: String {
        usage.windows.map { window in
            "\(Self.name(window.kind)): \(Int(window.usedPercent.rounded()))% used, resets \(Self.resetText(window.resetsAt))"
        }.joined(separator: "\n")
    }

    static func name(_ kind: PlanUsage.Kind) -> String {
        switch kind {
        case .fiveHour: "5-hour limit"
        case .sevenDay: "Weekly limit"
        case .spend: "Spend limit"
        }
    }

    /// `14:30` today, `Mon 09:00` later on.
    static func resetText(_ date: Date, now: Date = .now) -> String {
        Calendar.current.isDate(date, inSameDayAs: now)
            ? date.formatted(date: .omitted, time: .shortened)
            : date.formatted(.dateTime.weekday(.abbreviated).hour().minute())
    }
}

private struct WindowGauge: View {
    let window: PlanUsage.Window
    let showsReset: Bool

    var body: some View {
        HStack(spacing: 4) {
            ZStack {
                Circle().stroke(.white.opacity(0.15), lineWidth: 2)
                Circle()
                    .trim(from: 0, to: min(1, window.usedPercent / 100))
                    .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
            .frame(width: 11, height: 11)

            Text("\(window.kind.label) \(Int(window.usedPercent.rounded()))%")
                .foregroundStyle(window.level == .normal ? .white.opacity(0.7) : color)
            if showsReset {
                Text("· \(UsageGaugeView.resetText(window.resetsAt))")
                    .foregroundStyle(.white.opacity(0.45))
            }
        }
        .font(.system(size: 11, weight: .semibold, design: .rounded))
        .monospacedDigit()
        .lineLimit(1)
    }

    private var color: Color {
        switch window.level {
        case .normal: .white.opacity(0.8)
        case .high: MotePalette.amber.color.color
        case .critical: MotePalette.coral.color.color
        }
    }
}
