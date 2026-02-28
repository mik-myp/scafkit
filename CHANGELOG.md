# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-28
### Added
- Initial release of `scafkit` CLI.
- Local JSON database support (`~/.scafkit/db.json`) with schema migration.
- Template management commands:
  - `scafkit template add`
  - `scafkit template list`
  - `scafkit template show`
  - `scafkit template update`
  - `scafkit template remove`
  - `scafkit template sync`
- Project initialization command:
  - `scafkit init <projectName> --template <id>`
- AI configuration and connectivity commands:
  - `scafkit ai set`
  - `scafkit ai show`
  - `scafkit ai test`
- Git AI assistance commands:
  - `scafkit git review`
  - `scafkit git commit-message`
- Hook management commands:
  - `scafkit hook install`
  - `scafkit hook status`
  - `scafkit hook uninstall`
- Automatic Chinese Conventional Commit generation via `commit-msg` hook.
- Fallback policy: AI failure does not block `git commit`.
- Unit and integration tests for migrations, AI parsing, template init flow, and hook behavior.
