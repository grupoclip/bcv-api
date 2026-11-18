# Changelog

All notable changes to the `bcv-today` npm package. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [1.0.3] - 2026-11-19

### Fixed

- README: source link points to the package's new location in the repository,
  `packages/js/`, and the Socket badge is added. No code changes.

## [1.0.2] - 2026-11-18

### Removed

- The `bcv-today mcp` local stdio MCP server and the optional peer dependency
  `@modelcontextprotocol/sdk`. The package now declares no dependencies of any
  kind. AI assistants should use the remote server https://mcp.bcv.today/mcp.

## [1.0.1] - 2026-11-18

### Changed

- First release published from GitHub Actions with npm Trusted Publishing, so the
  package now carries a signed provenance attestation linking it to
  https://github.com/grupoclip/bcv-api. No code changes.

## [1.0.0] - 2026-11-18

### Added

- `BCV` client with `latest()`, `on()`, `history()`, `convert()` and `status()`,
  in-memory TTL cache and typed errors (`BCVError` and subclasses).
- Exact decimal conversions (scaled BigInt, 28 significant digits for division,
  half-up rounding) with `resultText`/`resultExact` strings.
- Weekend and holiday carry-forward with an explanatory note.
- ESM and CommonJS builds with TypeScript declarations; zero runtime dependencies.
- `bcv-today` CLI (`latest`, `on`, `convert`, `history`, `status`, `--json`)
  with exit codes 0/1/2/3.
- `bcv-today mcp`: local stdio MCP server with the same five tools as
  https://mcp.bcv.today/mcp (optional peer dependency `@modelcontextprotocol/sdk`).
