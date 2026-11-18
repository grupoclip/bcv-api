# Changelog

All notable changes to the `bcv` Ruby gem. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the gem uses
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-18

First release, versioned 1.0.0 to match the Python (`bcv`), JavaScript (`bcv-today`) and PHP (`grupoclip/bcv-today`)
clients.

### Added

- `BCV::Client`: `latest`, `on`, `history`, `convert`, `status` and `clear_cache`, with the same rules and messages
  as the other clients: weekend and holiday carry-forward with an English note, date validation (2021-08-02 up to
  tomorrow in Caracas), history windows clipped to `history.json`, and cross rates through the bolivar.
- Module-level shortcuts (`BCV.latest`, `BCV.on`, `BCV.history`, `BCV.convert`, `BCV.status`) on a default client.
- Exact decimal arithmetic on Ruby integers (28 significant digits for divisions, ROUND_HALF_UP); rates, amounts and
  results are decimal strings. No bigdecimal dependency.
- Immutable result objects (`BCV::Rates`, `DayRate`, `History`, `HistoryPoint`, `Conversion`, `Status`), built with
  `Data.define` on Ruby 3.2+ and frozen `Struct`s on Ruby 3.1, and the `BCV::Error` hierarchy.
- Zero runtime dependencies: Net::HTTP by default or any callable passed as `http:`. Thread-safe in-memory cache, or
  any `Rails.cache`-style store passed as `cache:`.
- `bcv` command (`latest`, `on`, `convert`, `history`, `status`, `--json`) with the same output and exit codes as the
  Python and JavaScript commands.

[1.0.0]: https://github.com/grupoclip/bcv-api/releases/tag/rb-v1.0.0
