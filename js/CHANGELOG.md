# Changelog

All notable changes to the `bcv-today` npm package. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

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
