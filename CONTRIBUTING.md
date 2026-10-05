# Contributing to Motes

Thanks for helping! Bug reports, ideas, new agents and fixes are all welcome.

## Getting started

```sh
brew install xcodegen
cd Motes && xcodegen && open Motes.xcodeproj
```

- Run the tests before opening a pull request: `cd Motes && xcodebuild -scheme Motes test`. CI runs them on every pull request.
- The `.xcodeproj` is generated: change `Motes/project.yml`, never the project file.
- Read [AGENTS.md](AGENTS.md): it lists where things are and the project's rules (they apply to people too, not only to AI agents).

## Rules that matter most

- Never block the agent: the hook gives up after 0.3 s and prints nothing unless the user answered.
- Never write a user's config without a dated backup, a diff and their confirmation.
- Never approve anything without an explicit click.
- No telemetry, no network calls, no third-party dependencies.
- Pure logic stays free of AppKit and gets tests.

## Changing how motes look

Motes are Core Animation layers (`Motes/Sources/Character/MoteLayer.swift`); their traits are data (`MoteForm`, `MotePalette`). To see every mote in every state:

```sh
cd Motes && TEST_RUNNER_MOTES_RENDER_DIR=/tmp xcodebuild -scheme Motes test -only-testing:MotesTests/MoteSheetTests
open /tmp/motes-sheet.png
```

Attach the sheet to pull requests that change the look.

## Supporting another agent

See "Supporting a new CLI" in [docs/INTEGRATION.md](docs/INTEGRATION.md).

## Commits

[Conventional Commits](https://www.conventionalcommits.org), in English: `feat(island): …`, `fix(bridge): …`. Details in [AGENTS.md](AGENTS.md#commits).

## Releases (maintainers)

1. Add the version's section to `CHANGELOG.md` and bump `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in `Motes/project.yml`.
2. Commit, then tag and push: `git tag v<version> && git push origin v<version>`.
3. The Release workflow tests, builds with `scripts/release.sh` (ad-hoc signed) and publishes the zip, its checksum and the changelog section.

`scripts/release.sh` also runs locally; set `MOTES_SIGN_IDENTITY` to sign with a Developer ID instead.

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
