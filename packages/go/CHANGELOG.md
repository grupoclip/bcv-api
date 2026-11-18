# Changelog

All notable changes to the Go module `github.com/grupoclip/bcv-api/packages/go`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the module uses
[Semantic Versioning](https://semver.org/). Releases are the git tags `packages/go/vX.Y.Z`.

## [1.0.0] - 2026-11-18

First release, versioned 1.0.0 to match the Python (`bcv`), JavaScript (`bcv-today`) and PHP
(`grupoclip/bcv-today`) clients.

### Added

- `bcv.Client` with context-first `Latest`, `On`, `History`, `Convert` and `Status`, plus `ClearCache`; options
  `WithBaseURL`, `WithHTTPClient`, `WithTimeout`, `WithCacheTTL`, `WithUserAgent` and `WithClock`.
- The same rules and English messages as the other clients: weekend and holiday carry-forward with a note, date
  validation (2021-08-02 up to tomorrow in Caracas), history windows clipped to `history.json` (`Days`, `Range`),
  and cross rates through the bolivar.
- Exact decimal arithmetic on `math/big` (28 significant digits for divisions, ROUND_HALF_UP); rates, amounts and
  results are decimal strings, with float64 convenience accessors. `FormatNumber` for display.
- Sentinel errors (`ErrInvalidDate`, `ErrInvalidCurrency`, `ErrInvalidAmount`, `ErrInvalidArgument`,
  `ErrDateOutOfRange`, `ErrCurrencyNotAvailable`, `ErrNotFound`, `ErrUpstream`) and the `*bcv.Error` type, for
  `errors.Is` and `errors.As`.
- In-memory TTL cache safe for concurrent use; concurrent requests for the same path share one HTTP request.
- The `bcv` command (`go install github.com/grupoclip/bcv-api/packages/go/cmd/bcv@latest`) with the same
  subcommands, options, output and exit codes as the Python and JavaScript command-line tools.
- Standard library only; Go 1.22 or later.

[1.0.0]: https://github.com/grupoclip/bcv-api/releases/tag/packages/go/v1.0.0
