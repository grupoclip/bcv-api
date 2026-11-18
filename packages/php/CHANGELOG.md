# Changelog

All notable changes to the `grupoclip/bcv-today` Composer package. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-18

First release, versioned 1.0.0 to match the Python (`bcv`) and JavaScript (`bcv-today`) clients.

### Added

- `BcvToday\Bcv` client: `latest()`, `on()`, `history()`, `convert()`, `status()` and `clearCache()`, with the
  same rules and messages as the Python and JavaScript clients: weekend and holiday carry-forward with an English
  note, date validation (2021-08-02 up to tomorrow in Caracas), history windows clipped to `history.json`, and
  cross rates through the bolivar.
- Exact decimal arithmetic in pure PHP (28 significant digits for divisions, ROUND_HALF_UP); rates, amounts and
  results are decimal strings.
- Immutable result objects (`Rates`, `DayRate`, `History`, `HistoryPoint`, `Conversion`, `Status`) and the
  `BcvException` hierarchy.
- Zero runtime dependencies: HTTP through ext-curl when loaded, PHP streams otherwise, or any callable passed as
  `httpClient`. In-memory cache by default, or any PSR-16 style cache.
- Laravel service provider, `Bcv` facade and publishable `config/bcv.php`, registered through package
  auto-discovery without requiring Laravel.

[1.0.0]: https://github.com/grupoclip/bcv-api/releases/tag/php-v1.0.0
