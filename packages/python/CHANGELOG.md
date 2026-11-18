# Changelog

All notable changes to the `bcv` Python package. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Releases are tagged `py-vX.Y.Z`.

## [1.0.0] - 2026-11-18

### Added

- `BCV` client with `latest()`, `on()`, `history()`, `convert()` and `status()`,
  zero runtime dependencies and an in-memory TTL cache.
- Carry-forward semantics for weekends and holidays (`effective_date`,
  `carried_forward`, `note`), matching the BCV Today MCP server.
- `Decimal` money math with documented rounding (`decimals`, ROUND_HALF_UP).
- Exception hierarchy rooted at `BCVError`.
- `AsyncBCV` (extra `bcv[async]`, httpx) and `History.to_pandas()` (extra `bcv[pandas]`).
- `bcv` command-line tool with `--json` output and meaningful exit codes.
- Type information (`py.typed`).

[1.0.0]: https://github.com/grupoclip/bcv-api/releases/tag/py-v1.0.0
