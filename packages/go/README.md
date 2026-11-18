# bcv (Go)

[![Go Reference](https://pkg.go.dev/badge/github.com/grupoclip/bcv-api/packages/go.svg)](https://pkg.go.dev/github.com/grupoclip/bcv-api/packages/go)

Official Go client for the [BCV Today API](https://bcv.today/api/): the exchange rates published by Banco Central de
Venezuela (BCV) for USD, EUR, CNY, TRY and RUB against the bolivar (VES).

> **Unofficial, not affiliated with Banco Central de Venezuela.** BCV Today republishes the rates that BCV publishes on
> its website. Data: [CC BY 4.0](https://bcv.today/licencia/), attribution "BCV Today (https://bcv.today), data from
> Banco Central de Venezuela".

- Standard library only, Go 1.22 or later.
- Exact decimal conversions (no floating-point drift), rounded half-up; results are decimal strings.
- Weekend and holiday carry-forward, the same rules and messages as the Python, JavaScript and PHP clients.
- Context-first API, in-memory cache safe for concurrent use, `errors.Is`/`errors.As` friendly errors and a `bcv`
  command.

```bash
go get github.com/grupoclip/bcv-api/packages/go
```

## Usage

```go
import (
	"context"
	"fmt"

	bcv "github.com/grupoclip/bcv-api/packages/go"
)

func main() {
	c := bcv.New()
	ctx := context.Background()

	r, err := c.Latest(ctx)
	if err != nil {
		panic(err)
	}
	r.Rate("USD")    // "916.6477" (bolivars per dollar)
	r.Float("USD")   // 916.6477
	r.EffectiveDate  // "2026-11-18" (official BCV value date)

	d, _ := c.On(ctx, "2026-01-04", "USD")
	d.EffectiveDate  // "2026-01-03": the Saturday rate stays in effect
	d.CarriedForward // true
	d.Note           // explains the carry-forward

	v, _ := c.Convert(ctx, "100", "USD", "VES")
	v.Result         // "91664.77" (exactly 2 decimals by default)
	v.ResultExact    // unrounded exact decimal string
	fmt.Println(v)   // 100.00 USD = 91,664.77 VES at the official BCV rate (effective 2026-11-18; 1 USD = 916.647700 VES).

	h, _ := c.History(ctx, "EUR", bcv.Days(30)) // or bcv.Range("2026-01-01", "2026-01-31")
	h.Min, h.Max, h.First, h.Last, h.Change, h.ChangePct

	s, _ := c.Status(ctx)
	s.Stale          // true if no capture for more than 96 h
}
```

### API

| Call | Returns | Notes |
| --- | --- | --- |
| `bcv.New(opts...)` | `*Client` | Options: `WithBaseURL` (default `https://bcv.today`), `WithHTTPClient`, `WithTimeout` (10s; 0 disables), `WithCacheTTL` (5m; 0 disables), `WithUserAgent`, `WithClock` (tests). |
| `Latest(ctx)` | `*Rates` | Rates currently in effect (`/api/v1/rate.json`). `Rate(code)`, `Float(code)`, `Currencies()`. |
| `On(ctx, date, currency)` | `*DayRate` | `date` is `"YYYY-MM-DD"`, from 2021-08-02 up to tomorrow in Caracas; `currency` `""` returns every currency. |
| `History(ctx, currency, opts...)` | `*History` | `bcv.Days(n)` (1 to 1830, default 30) or `bcv.Range(start, end)` (inclusive, `""` leaves a side open), oldest first, with `Min`, `Max`, `First`, `Last`, `Change`, `ChangePct`. Ranges are clipped to `history.json` and `Note` says so. |
| `Convert(ctx, amount, from, to, opts...)` | `*Conversion` | Between VES, USD, EUR, CNY, TRY and RUB; options `bcv.Decimals(n)`, `bcv.FullPrecision()`, `bcv.OnDate(date)`. Cross rates go through the bolivar. |
| `Status(ctx)` | `*Status` | Data freshness. |
| `ClearCache()` | | Forget cached responses. |

Calendar days are `"YYYY-MM-DD"` strings (`t.Format(time.DateOnly)` for a `time.Time`); timestamps (`UpdatedAt`,
`GeneratedAt`) are `time.Time` in UTC, zero when unknown. Every result has a one-line English `String()`. `Raw` holds
the JSON entry as published.

A `Client` is safe for concurrent use. Responses are cached in memory and concurrent requests for the same path share
one HTTP request; errors are never cached. Invalid options do not panic: every call then returns an
`ErrInvalidArgument` error.

### Exact decimals and rounding

Rates come from the JSON text as exact decimal strings (`"1007.38665582"`), never through `float64`. `Convert` takes the
amount as a string (`"100"`, `"12.50"`, `"1_000"`, `"1e3"`; non-negative, at most 1e15), multiplies exactly and divides
with 28 significant digits, the same as Python's `decimal` module. `Result` is then rounded **half-up** (`0.125` ->
`0.13`) to `Decimals` places (default 2, 0 to 12; `FullPrecision()` keeps every digit). `ResultExact` and `Rate` are
exact strings. `ResultFloat()`, `RateFloat()`, `Float(code)` and friends are for display only. `bcv.FormatNumber("91664.77", 2)`
gives `"91,664.77"`.

### Errors

Every error returned on purpose is a `*bcv.Error` (`Kind`, `Message`, `StatusCode`, `Type()`) matching one sentinel:

```text
ErrInvalidArgument
├── ErrInvalidDate          bad date, not a real calendar day, bad range or days
├── ErrInvalidCurrency      unknown currency code, or from == to
└── ErrInvalidAmount        negative, non-finite or > 1e15 amount; bad decimals
ErrDateOutOfRange           before 2021-08-02, in the future, not published yet, outside history.json
ErrCurrencyNotAvailable     valid code, but no rate that day
ErrNotFound                 HTTP 404
ErrUpstream                 network failure, timeout, HTTP error or invalid JSON (StatusCode holds the HTTP code)
```

```go
_, err := c.On(ctx, "2020-01-01", "USD")
if errors.Is(err, bcv.ErrDateOutOfRange) { /* "No BCV data for 2020-01-01: daily snapshots start on 2021-08-02." */ }
```

Invalid arguments are rejected before any request is made. Timeouts and context cancellation are `ErrUpstream` errors
that wrap the context error, so `errors.Is(err, context.Canceled)` also works.

## Command line

```bash
go install github.com/grupoclip/bcv-api/packages/go/cmd/bcv@latest

bcv latest
bcv on 2026-01-04 --currency USD
bcv convert 100 USD VES [--date 2026-01-02] [--decimals 4]
bcv history EUR --days 30        # or --start 2026-01-01 --end 2026-01-31
bcv status
bcv convert 100 USD VES --json   # machine-readable
```

Options: `--json`, `--base-url URL`, `--timeout SECONDS`, `--version`, `--help`.
Exit codes: `0` ok, `1` no data for the request, `2` invalid arguments, `3` network or API error.

## MCP

For AI assistants, connect to the remote BCV Today MCP server instead: `https://mcp.bcv.today/mcp`
(Streamable HTTP, no authentication, nothing to install).

## Development

```bash
cd packages/go
go vet ./... && go test -race ./...   # offline, against packages/python/tests/fixtures
BCV_LIVE=1 go test -run TestLive .    # against https://bcv.today
```

## En español

`bcv` es el cliente oficial en Go para la [API de BCV Today](https://bcv.today/api/): las tasas de cambio oficiales del
Banco Central de Venezuela (USD, EUR, CNY, TRY y RUB contra el bolívar). **Proyecto no oficial, no afiliado al Banco
Central de Venezuela.** Datos bajo [CC BY 4.0](https://bcv.today/licencia/).

```go
c := bcv.New()
r, _ := c.Latest(ctx)
r.Rate("USD")                                   // bolívares por dólar
d, _ := c.On(ctx, "2026-01-04", "USD")
d.EffectiveDate                                 // domingo: rige la tasa con fecha valor 2026-01-03
v, _ := c.Convert(ctx, "100", "USD", "VES")
v.Result                                        // "91664.77"
```

Las conversiones usan aritmética decimal exacta y, por defecto, redondean a 2 decimales con la mitad hacia arriba
(0,005 → 0,01). En la terminal: `go install github.com/grupoclip/bcv-api/packages/go/cmd/bcv@latest` y luego
`bcv convert 100 USD VES`. Más integraciones (Python, JavaScript, PHP, Odoo, MCP, A2A): https://bcv.today/integraciones/

## Links

- API docs: https://bcv.today/api/ · OpenAPI: https://bcv.today/openapi.json · llms.txt: https://bcv.today/llms.txt
- Package docs: https://pkg.go.dev/github.com/grupoclip/bcv-api/packages/go
- Source: https://github.com/grupoclip/bcv-api/tree/main/packages/go · Issues: https://github.com/grupoclip/bcv-api/issues

## License

Code: Apache-2.0. Data: CC BY 4.0, BCV Today, from Banco Central de Venezuela.
