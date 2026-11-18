// Package bcv is the official Go client for the BCV Today API
// (https://bcv.today/api/): the exchange rates published by Banco Central de
// Venezuela (BCV) for USD, EUR, CNY, TRY and RUB against the bolivar (VES).
//
// Unofficial project, not affiliated with Banco Central de Venezuela. Data: CC BY
// 4.0, attribution "BCV Today (https://bcv.today), data from Banco Central de
// Venezuela".
//
// The package uses the standard library only and follows the same rules and
// English messages as the Python (bcv), JavaScript (bcv-today) and PHP
// (grupoclip/bcv-today) clients.
//
// # Usage
//
//	c := bcv.New()
//	ctx := context.Background()
//
//	r, err := c.Latest(ctx)
//	r.Rate("USD")        // "916.6477" (bolivars per dollar)
//	r.EffectiveDate      // "2026-11-18" (official BCV value date)
//
//	d, err := c.On(ctx, "2026-01-04", "USD")
//	d.EffectiveDate      // "2026-01-03": the Saturday rate stays in effect
//	d.CarriedForward     // true
//	d.Note               // explains the carry-forward
//
//	v, err := c.Convert(ctx, "100", "USD", "VES")
//	v.Result             // "91664.77" (exactly 2 decimals by default)
//	v.ResultExact        // unrounded exact decimal string
//
//	h, err := c.History(ctx, "EUR", bcv.Days(30)) // or bcv.Range("2026-01-01", "2026-01-31")
//	h.Min, h.Max, h.First, h.Last, h.Change, h.ChangePct
//
//	s, err := c.Status(ctx)
//	s.Stale              // true if no capture for more than 96 hours
//
// # Dates and carry-forward
//
// Calendar days are "YYYY-MM-DD" strings (use t.Format(time.DateOnly) for a
// time.Time). BCV does not publish on weekends and holidays: the last published
// rate stays in effect, so [Client.On] and [Client.Convert] with [OnDate] return an
// EffectiveDate earlier than the requested day, CarriedForward true and an English
// Note. Daily snapshots start on 2021-08-02; dates after tomorrow in Caracas
// (UTC-4) are rejected with [ErrDateOutOfRange] before any request.
//
// # Exact decimals
//
// Rates, amounts and results are decimal strings taken from the JSON text without
// going through float64. Conversions multiply exactly and divide with 28
// significant digits, the same as Python's decimal module, then round half-up
// (0.125 -> 0.13) to [Decimals] places (default 2, 0 to 12; [FullPrecision] keeps
// every digit). Float accessors such as [Conversion.ResultFloat] exist for display
// and charts only.
//
// # Errors
//
// Every error returned on purpose is an [*Error] whose Kind is one of the sentinel
// errors ([ErrInvalidDate], [ErrInvalidCurrency], [ErrInvalidAmount],
// [ErrDateOutOfRange], [ErrCurrencyNotAvailable], [ErrNotFound], [ErrUpstream]),
// so errors.Is and errors.As both work. Invalid arguments are rejected before any
// request is made. Context cancellation and timeouts are reported as [ErrUpstream]
// errors that wrap the context error.
//
// # Caching and concurrency
//
// A [Client] is safe for concurrent use. Responses are cached in memory for 5
// minutes ([WithCacheTTL]; 0 disables it) and concurrent requests for the same path
// share one HTTP request. Errors are never cached.
//
// # Command line
//
// The module also ships a command:
//
//	go install github.com/grupoclip/bcv-api/packages/go/cmd/bcv@latest
//	bcv convert 100 USD VES
package bcv
