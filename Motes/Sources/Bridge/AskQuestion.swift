import Foundation

/// The questions of an `AskUserQuestion` call: 1 to 4, each with 2 to 4 options.
struct AskQuestion: Equatable, Sendable {
    struct Option: Equatable, Sendable {
        let label: String
        let description: String?
    }

    struct Item: Equatable, Sendable {
        let question: String
        let header: String?
        let options: [Option]
        let multiSelect: Bool
    }

    let items: [Item]

    /// Parses `tool_input`. Returns `nil` for anything Motes can't show faithfully,
    /// so the question falls back to the terminal.
    static func parse(_ toolInput: Data) -> AskQuestion? {
        guard let object = (try? JSONSerialization.jsonObject(with: toolInput)) as? [String: Any],
              let questions = object["questions"] as? [[String: Any]],
              (1...4).contains(questions.count) else { return nil }
        var items: [Item] = []
        for question in questions {
            guard let text = question["question"] as? String, !text.isEmpty,
                  let options = question["options"] as? [[String: Any]], (2...4).contains(options.count)
            else { return nil }
            var parsed: [Option] = []
            for option in options {
                guard let label = option["label"] as? String, !label.isEmpty else { return nil }
                parsed.append(Option(label: label, description: option["description"] as? String))
            }
            items.append(Item(
                question: text, header: question["header"] as? String,
                options: parsed, multiSelect: question["multiSelect"] as? Bool ?? false
            ))
        }
        // Answers are keyed by question text, so questions must be distinct.
        guard Set(items.map(\.question)).count == items.count else { return nil }
        return AskQuestion(items: items)
    }
}
