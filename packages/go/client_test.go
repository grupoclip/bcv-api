package bcv_test

// Same scenarios and expected values as packages/python/tests/test_client.py,
// packages/js/test/unit/client.test.mjs and packages/php/tests/BcvTest.php, on the
// shared fixtures.

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	bcv "github.com/grupoclip/bcv-api/packages/go"
)

const sundayNote = "2026-01-04 (Sunday) uses the rate with effective date 2026-01-03 (Saturday): a published BCV rate " +
	"stays in effect until the next publication (weekends and holidays carry it forward)."

var ctx = context.Background()

func setup(t *testing.T, overrides map[string]reply, opts ...bcv.Option) (*fakeAPI, *bcv.Client) {
	t.Helper()
	f := newFakeAPI(overrides)
	t.Cleanup(f.Close)
	return f, f.client(opts...)
}

func rateJSON(t *testing.T, body string) (*fakeAPI, *bcv.Client) {
	t.Helper()
	return setup(t, map[string]reply{"rate.json": {200, body}})
}

// wantErr checks the category (errors.Is) and the exact message (or a prefix ending in "...").
func wantErr(t *testing.T, err error, kind error, msg string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected %v error %q, got nil", kind, msg)
	}
	if !errors.Is(err, kind) {
		t.Fatalf("expected %v, got %T %v", kind, err, err)
	}
	var e *bcv.Error
	if !errors.As(err, &e) {
		t.Fatalf("expected *bcv.Error, got %T", err)
	}
	if prefix, ok := strings.CutSuffix(msg, "..."); ok {
		if !strings.HasPrefix(err.Error(), prefix) {
			t.Fatalf("message %q does not start with %q", err.Error(), prefix)
		}
	} else if msg != "" && err.Error() != msg {
		t.Fatalf("message\n got: %q\nwant: %q", err.Error(), msg)
	}
}

func eq[T any](t *testing.T, label string, got, want T) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s: got %#v, want %#v", label, got, want)
	}
}

// must panics on error, which fails the running test with a stack trace.
func must[T any](v T, err error) T {
	if err != nil {
		panic(fmt.Sprintf("unexpected error: %v", err))
	}
	return v
}

// ------------------------------------------------------------------ latest

func TestLatestParsesExactRatesAndDates(t *testing.T) {
	_, c := setup(t, nil)
	r := must(c.Latest(ctx))
	eq(t, "rates", r.Rates, map[string]string{
		"USD": "916.6477", "EUR": "1007.38665582", "CNY": "137.52328442", "TRY": "18.21021713", "RUB": "11.17192733",
	})
	eq(t, "Rate(USD)", r.Rate("USD"), "916.6477")
	eq(t, "Rate(try)", r.Rate("try"), "18.21021713")
	eq(t, "Rate(XYZ)", r.Rate("XYZ"), "")
	eq(t, "Float(USD)", r.Float("USD"), 916.6477)
	eq(t, "Currencies", r.Currencies(), []string{"USD", "EUR", "CNY", "TRY", "RUB"})
	eq(t, "Date", r.Date, "2026-11-18")
	eq(t, "EffectiveDate", r.EffectiveDate, "2026-11-18")
	eq(t, "UpdatedAt", r.UpdatedAt, time.Date(2026, 11, 18, 2, 1, 3, 699523000, time.UTC))
	eq(t, "Raw USD", fmt.Sprint(r.Raw["USD"]), "916.6477")
	if !strings.HasPrefix(r.String(), "Official BCV rates (effective 2026-11-18, Bs. per unit): USD 916.6477, EUR 1,007.3867") {
		t.Errorf("String() = %q", r.String())
	}
}

func TestMissingCurrencyInLatest(t *testing.T) {
	_, c := rateJSON(t, `{"USD": 1, "date": "2026-01-02"}`)
	r := must(c.Latest(ctx))
	eq(t, "rates", r.Rates, map[string]string{"USD": "1"})
	eq(t, "Rate(EUR)", r.Rate("EUR"), "")
	eq(t, "UpdatedAt zero", r.UpdatedAt.IsZero(), true)
	eq(t, "EffectiveDate", r.EffectiveDate, "2026-01-02")
}

func TestRawIsACopy(t *testing.T) {
	_, c := setup(t, nil)
	r := must(c.Latest(ctx))
	r.Raw["USD"] = "tampered"
	eq(t, "cached entry untouched", must(c.Latest(ctx)).Rate("USD"), "916.6477")
}

func TestUserAgentAndAcceptHeaders(t *testing.T) {
	f, c := setup(t, nil)
	must(c.Latest(ctx))
	eq(t, "calls", f.Calls(), []string{"/api/v1/rate.json"})
	eq(t, "User-Agent", f.Headers()[0].Get("User-Agent"), "bcv-today-go/"+bcv.Version+" (+https://bcv.today)")
	eq(t, "Accept", f.Headers()[0].Get("Accept"), "application/json")
	eq(t, "DefaultUserAgent", bcv.DefaultUserAgent, "bcv-today-go/1.0.0 (+https://bcv.today)")
}

func TestCustomBaseURLAndUserAgent(t *testing.T) {
	f := newFakeAPI(map[string]reply{"rate.json": {200, `{"USD": 1, "date": "2026-01-02"}`}})
	defer f.Close()
	c := bcv.New(bcv.WithBaseURL(f.URL+"//"), bcv.WithUserAgent("me/1"), bcv.WithTimeout(3*time.Second))
	eq(t, "BaseURL", c.BaseURL(), f.URL)
	eq(t, "Rate", must(c.Latest(ctx)).Rate("USD"), "1")
	eq(t, "User-Agent", f.Headers()[0].Get("User-Agent"), "me/1")
}

func TestConstructorValidation(t *testing.T) {
	for _, tc := range []struct {
		opt  bcv.Option
		want string
	}{
		{bcv.WithBaseURL("file:///etc"), `Invalid base URL "file:///etc": it must start with https:// or http://.`},
		{bcv.WithTimeout(-time.Second), "Invalid timeout -1s: use a duration >= 0."},
		{bcv.WithCacheTTL(-time.Second), "Invalid cache TTL -1s: use a duration >= 0."},
	} {
		c := bcv.New(tc.opt)
		_, err := c.Latest(ctx)
		wantErr(t, err, bcv.ErrInvalidArgument, tc.want)
		_, err = c.Convert(ctx, "1", "USD", "VES")
		wantErr(t, err, bcv.ErrInvalidArgument, tc.want)
	}
}

// ------------------------------------------------------------------ on() / carry-forward

func TestOnBusinessDayIsNotCarried(t *testing.T) {
	f, c := setup(t, nil)
	d := must(c.On(ctx, "2026-01-06", ""))
	eq(t, "Date", d.Date, "2026-01-06")
	eq(t, "EffectiveDate", d.EffectiveDate, "2026-01-06")
	eq(t, "CarriedForward", d.CarriedForward, false)
	eq(t, "Note", d.Note, "")
	eq(t, "Currencies", d.Currencies(), []string{"USD", "EUR"})
	eq(t, "calls", f.Calls(), []string{"/api/v1/history/2026-01-06.json"})
}

func TestOnSundayCarriesForwardSaturday(t *testing.T) {
	_, c := setup(t, nil)
	d := must(c.On(ctx, "2026-01-04", "usd"))
	eq(t, "Date", d.Date, "2026-01-04")
	eq(t, "EffectiveDate", d.EffectiveDate, "2026-01-03")
	eq(t, "CarriedForward", d.CarriedForward, true)
	eq(t, "Rate", d.Rate("USD"), "304.6796")
	eq(t, "Rates", d.Rates, map[string]string{"USD": "304.6796"})
	eq(t, "Note", d.Note, sundayNote)
	eq(t, "String", d.String(), "BCV rate in effect on 2026-01-04 (Bs. per unit): USD 304.6796. "+sundayNote)
}

func TestOnErrors(t *testing.T) {
	for _, tc := range []struct {
		name, date, currency string
		kind                 error
		msg                  string
	}{
		{"currency missing on old day", "2021-08-02", "EUR", bcv.ErrCurrencyNotAvailable,
			"No EUR rate in the BCV data for 2021-08-02 (older entries may lack some currencies). Available that day: USD."},
		{"before first snapshot", "2021-08-01", "", bcv.ErrDateOutOfRange,
			"No BCV data for 2021-08-01: daily snapshots start on 2021-08-02."},
		{"future", "2026-11-20", "", bcv.ErrDateOutOfRange,
			"2026-11-20 is in the future (today in Caracas is 2026-11-18); BCV rates are only known up to the next business day."},
		{"tomorrow not published yet", "2026-11-19", "", bcv.ErrDateOutOfRange,
			"No BCV rate published yet for 2026-11-19. Daily snapshots are available from 2021-08-02 to 2026-11-18. Use latest() for the rate currently in effect."},
		{"invalid currency", "2026-01-06", "GBP", bcv.ErrInvalidCurrency,
			`Unsupported currency "GBP": use one of USD, EUR, CNY, TRY, RUB.`},
		{"VES is not a published rate", "2026-01-06", "VES", bcv.ErrInvalidArgument, "Unsupported currency..."},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, c := setup(t, nil)
			_, err := c.On(ctx, tc.date, tc.currency)
			wantErr(t, err, tc.kind, tc.msg)
		})
	}
}

func TestOnInvalidDatesMakeNoRequest(t *testing.T) {
	for _, bad := range []string{"2026-02-30", "2026-1-4", "04/01/2026", "", "2026-01-04T00:00", "nope", "2026-13-01"} {
		t.Run(bad, func(t *testing.T) {
			f, c := setup(t, nil)
			_, err := c.On(ctx, bad, "")
			wantErr(t, err, bcv.ErrInvalidDate,
				fmt.Sprintf("Invalid date %q: use a real calendar date in YYYY-MM-DD format, e.g. 2026-01-02.", bad))
			if !errors.Is(err, bcv.ErrInvalidArgument) {
				t.Error("ErrInvalidDate must also match ErrInvalidArgument")
			}
			eq(t, "calls", len(f.Calls()), 0)
		})
	}
}

func TestOnTomorrowFetchesLatestForTheMessage(t *testing.T) {
	f, c := setup(t, nil)
	_, err := c.On(ctx, "2026-11-19", "")
	wantErr(t, err, bcv.ErrDateOutOfRange, "")
	calls := f.Calls()
	eq(t, "last call", calls[len(calls)-1], "/api/v1/rate.json")
}

func TestSnapshot404WithLatestFailureUsesGenericMessage(t *testing.T) {
	_, c := setup(t, map[string]reply{"rate.json": {500, "x"}})
	_, err := c.On(ctx, "2026-11-19", "")
	wantErr(t, err, bcv.ErrDateOutOfRange,
		"No BCV rate published yet for 2026-11-19. Daily snapshots are available from 2021-08-02 to the latest business day. Use latest() for the rate currently in effect.")
}

func TestCaracasTodayIsUTCMinus4(t *testing.T) {
	// 02:00 UTC on the 19th is still the 18th in Caracas: the 20th is "future".
	_, c := setup(t, nil, bcv.WithClock(func() time.Time { return time.Date(2026, 11, 19, 2, 0, 0, 0, time.UTC) }))
	_, err := c.On(ctx, "2026-11-20", "")
	wantErr(t, err, bcv.ErrDateOutOfRange, "2026-11-20 is in the future (today in Caracas is 2026-11-18)...")
}

// ------------------------------------------------------------------ history

func TestHistoryLastNDays(t *testing.T) {
	_, c := setup(t, nil)
	h := must(c.History(ctx, "USD", bcv.Days(7)))
	eq(t, "len", len(h.Points), 7)
	eq(t, "Start", h.Start, "2026-11-12")
	eq(t, "End", h.End, "2026-11-18")
	for i := 1; i < len(h.Points); i++ {
		if h.Points[i-1].Date >= h.Points[i].Date {
			t.Fatalf("points not sorted: %v", h.Points)
		}
	}
	eq(t, "First", h.First, h.Points[0])
	eq(t, "Note", h.Note, "")
	if !strings.HasPrefix(h.String(), "USD/VES from 2026-11-12 to 2026-11-18 (7 days): ") {
		t.Errorf("String() = %q", h.String())
	}
	if len(h.ChangePct) < 6 || h.ChangePct[len(h.ChangePct)-5] != '.' {
		t.Errorf("ChangePct must have 4 decimals: %q", h.ChangePct)
	}
}

func TestHistoryDefaultIs30Days(t *testing.T) {
	_, c := setup(t, nil)
	h := must(c.History(ctx, "usd"))
	eq(t, "Start", h.Start, "2026-10-20")
	eq(t, "End", h.End, "2026-11-18")
}

func TestHistoryRangeCarryFlagsAndStats(t *testing.T) {
	_, c := setup(t, nil)
	h := must(c.History(ctx, "eur", bcv.Range("2026-01-01", "2026-01-06")))
	var dates []string
	var flags []bool
	for _, p := range h.Points {
		dates = append(dates, p.Date)
		flags = append(flags, p.CarriedForward)
	}
	eq(t, "dates", dates, []string{"2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06"})
	eq(t, "flags", flags, []bool{false, true, false, true, true, false})
	eq(t, "First", h.First.Rate, "354.4935")
	eq(t, "Last", h.Last.Rate, "360.5039")
	eq(t, "Min", h.Min.Date, "2026-01-01")
	eq(t, "Max", h.Max.Date, "2026-01-06")
	eq(t, "Change", h.Change, "6.0104")
	eq(t, "ChangePct", h.ChangePct, "1.6955") // 6.0104 / 354.4935 * 100 = 1.69549...
	eq(t, "ChangeFloat", h.ChangeFloat(), 6.0104)
	eq(t, "ChangePctFloat", h.ChangePctFloat(), 1.6955)
	eq(t, "Points[1].EffectiveDate", h.Points[1].EffectiveDate, "2026-01-01")
	eq(t, "RateFloat", h.First.RateFloat(), 354.4935)
	eq(t, "String", h.String(),
		"EUR/VES from 2026-01-01 to 2026-01-06 (6 days): 354.4935 -> 360.5039 (+1.70%). Min 354.4935 on 2026-01-01, max 360.5039 on 2026-01-06.")
}

func TestHistoryMinMaxEarliestOnTies(t *testing.T) {
	_, c := setup(t, nil)
	h := must(c.History(ctx, "USD", bcv.Range("2026-01-03", "2026-01-05")))
	eq(t, "Min", h.Min.Date, "2026-01-03")
	eq(t, "Max", h.Max.Date, "2026-01-03")
	eq(t, "Change", h.Change, "0")
	eq(t, "ChangePct", h.ChangePct, "0.0000")
}

func TestHistoryNotes(t *testing.T) {
	for _, tc := range []struct {
		name, currency, start, end, wantStart, note string
	}{
		{"skips entries without the currency and clips the start", "EUR", "2025-12-01", "2026-01-02", "2026-01-01",
			"History for EUR starts on 2026-01-01; earlier dates were skipped."},
		{"end after latest", "USD", "2026-11-17", "2026-12-31", "2026-11-17", "Latest available date is 2026-11-18."},
		{"open start", "USD", "", "2021-11-16", "2021-11-15", ""},
		{"open end", "USD", "2026-11-17", "", "2026-11-17", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, c := setup(t, nil)
			h := must(c.History(ctx, tc.currency, bcv.Range(tc.start, tc.end)))
			eq(t, "Start", h.Start, tc.wantStart)
			eq(t, "Note", h.Note, tc.note)
			if tc.note != "" && !strings.HasSuffix(h.String(), " "+tc.note) {
				t.Errorf("String() must end with the note: %q", h.String())
			}
		})
	}
}

func TestHistoryErrors(t *testing.T) {
	for _, tc := range []struct {
		name     string
		currency string
		opts     []bcv.HistoryOption
		kind     error
		msg      string
		requests int
	}{
		{"empty window", "USD", []bcv.HistoryOption{bcv.Range("2024-01-01", "2024-01-31")}, bcv.ErrDateOutOfRange,
			"No USD rates between 2024-01-01 and 2024-01-31. The history covers 2021-11-15 to 2026-11-18 for USD (latest 1830 daily entries). For older single days use on().", 1},
		{"reversed range", "USD", []bcv.HistoryOption{bcv.Range("2026-01-06", "2026-01-01")}, bcv.ErrInvalidDate,
			`"start" (2026-01-06) must be on or before "end" (2026-01-01).`, 0},
		{"days 0", "USD", []bcv.HistoryOption{bcv.Days(0)}, bcv.ErrInvalidDate,
			"Invalid days 0: use a whole number from 1 to 1830.", 0},
		{"days 1831", "USD", []bcv.HistoryOption{bcv.Days(1831)}, bcv.ErrInvalidDate, "Invalid days 1831: use a whole number from 1 to 1830.", 0},
		{"bad start", "USD", []bcv.HistoryOption{bcv.Range("2026-13-01", "")}, bcv.ErrInvalidDate, `Invalid start "2026-13-01"...`, 0},
		{"bad end", "USD", []bcv.HistoryOption{bcv.Range("", "x")}, bcv.ErrInvalidDate, `Invalid end "x"...`, 0},
		{"VES", "VES", nil, bcv.ErrInvalidCurrency, `Unsupported currency "VES": use one of USD, EUR, CNY, TRY, RUB.`, 0},
		{"no data for the currency", "RUB", []bcv.HistoryOption{bcv.Range("2021-11-15", "2021-11-20")}, bcv.ErrDateOutOfRange, "No RUB rates between...", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f, c := setup(t, nil)
			_, err := c.History(ctx, tc.currency, tc.opts...)
			wantErr(t, err, tc.kind, tc.msg)
			eq(t, "requests", len(f.Calls()), tc.requests)
		})
	}
}

func TestHistoryWithoutAnyRateForTheCurrency(t *testing.T) {
	_, c := setup(t, map[string]reply{"history.json": {200, `[{"date": "2026-01-02", "USD": 1}, 3, {"date": "bad", "EUR": 2}]`}})
	_, err := c.History(ctx, "EUR")
	wantErr(t, err, bcv.ErrCurrencyNotAvailable, "No EUR data in the BCV history.")
}

// ------------------------------------------------------------------ convert

type conv struct {
	name, rateJSON        string // rateJSON "" = the recorded rate.json
	amount, from, to      string
	opts                  []bcv.ConvertOption
	result, exact, rate   string // "" = not checked
	amountWant, effective string
	decimals              int
	used                  map[string]string
	carried               bool
	summary               string
}

func TestConvert(t *testing.T) {
	tie := `{"USD": 2.5, "date": "2026-11-18"}`
	tenth := `{"USD": 0.1, "EUR": 0.3, "date": "2026-11-18"}`
	for _, tc := range []conv{
		{name: "USD to VES at the latest rate", amount: "100", from: "USD", to: "VES",
			result: "91664.77", exact: "91664.77", rate: "916.6477", amountWant: "100", effective: "2026-11-18", decimals: 2,
			used:    map[string]string{"USD": "916.6477"},
			summary: "100.00 USD = 91,664.77 VES at the official BCV rate (effective 2026-11-18; 1 USD = 916.647700 VES)."},
		{name: "VES to USD rounds half-up", amount: "1000", from: "ves", to: "usd",
			result: "1.09", exact: "1.090931663276960166921271935", decimals: 2, used: map[string]string{"USD": "916.6477"}},
		{name: "VES to USD keeps the trailing zero", amount: "1008.3125", from: "VES", to: "USD", result: "1.10"},
		{name: "EUR to USD cross rate through VES", amount: "50", from: "EUR", to: "USD", opts: []bcv.ConvertOption{bcv.FullPrecision()},
			rate: "1.098989999996727205010169119", exact: "54.94949999983636025050845597", result: "54.94949999983636025050845597",
			decimals: -1, used: map[string]string{"EUR": "1007.38665582", "USD": "916.6477"}},
		{name: "EUR to CNY", amount: "0.1", from: "EUR", to: "CNY", exact: "0.7325207946193407238579097339"},
		{name: "CNY to RUB with 4 decimals", amount: "123456.789", from: "CNY", to: "RUB", opts: []bcv.ConvertOption{bcv.Decimals(4)},
			exact: "1519718.362438267612684158052", result: "1519718.3624", decimals: 4},
		{name: "EUR to VES", amount: "100", from: "EUR", to: "VES",
			result: "100738.67", exact: "100738.665582", used: map[string]string{"EUR": "1007.38665582"}},
		{name: "VES to EUR back to the exact amount", amount: "100738.665582", from: "VES", to: "EUR",
			opts: []bcv.ConvertOption{bcv.FullPrecision()}, exact: "100", result: "100"},
		{name: "VES to EUR rate", amount: "1", from: "VES", to: "EUR", opts: []bcv.ConvertOption{bcv.FullPrecision()},
			rate: "0.0009926675067836913567585160114"},
		{name: "1000 VES to EUR", amount: "1000", from: "VES", to: "EUR",
			exact: "0.9926675067836913567585160114", result: "0.99", used: map[string]string{"EUR": "1007.38665582"}},
		{name: "on a date carries forward", amount: "10", from: "USD", to: "VES", opts: []bcv.ConvertOption{bcv.OnDate("2026-01-04")},
			result: "3046.80", effective: "2026-01-03", carried: true,
			summary: "10.00 USD = 3,046.80 VES at the official BCV rate (effective 2026-01-03; 1 USD = 304.679600 VES). " + sundayNote},
		{name: "max amount and VEF alias", amount: "1e15", from: "vef", to: "USD", amountWant: "1000000000000000"},
		// Exact ties round half-up.
		{name: "0.0025 -> 0.00", rateJSON: tie, amount: "0.001", from: "USD", to: "VES", result: "0.00"},
		{name: "0.0075 -> 0.01", rateJSON: tie, amount: "0.003", from: "USD", to: "VES", result: "0.01"},
		{name: "0.0125 -> 0.01", rateJSON: tie, amount: "0.005", from: "USD", to: "VES", result: "0.01", exact: "0.0125"},
		{name: "0.0025 -> 0.003", rateJSON: tie, amount: "0.001", from: "USD", to: "VES", opts: []bcv.ConvertOption{bcv.Decimals(3)}, result: "0.003"},
		{name: "2.5 -> 3", rateJSON: tie, amount: "1", from: "USD", to: "VES", opts: []bcv.ConvertOption{bcv.Decimals(0)}, result: "3"},
		{name: "0.12 -> 0.1", rateJSON: tie, amount: "0.3", from: "VES", to: "USD", opts: []bcv.ConvertOption{bcv.Decimals(1)}, result: "0.1"},
		{name: "0.15 exactly", rateJSON: tie, amount: "0.375", from: "VES", to: "USD", result: "0.15"},
		{name: "0.005 with 3 decimals", rateJSON: tie, amount: "0.0125", from: "VES", to: "USD", opts: []bcv.ConvertOption{bcv.Decimals(3)}, result: "0.005"},
		// No binary floating-point noise.
		{name: "0.1 * 0.1", rateJSON: tenth, amount: "0.1", from: "USD", to: "VES", opts: []bcv.ConvertOption{bcv.FullPrecision()},
			amountWant: "0.1", exact: "0.01"},
		{name: "3 * 0.1 / 0.3", rateJSON: tenth, amount: "3", from: "USD", to: "EUR", opts: []bcv.ConvertOption{bcv.FullPrecision()},
			exact: "1", rate: "0.3333333333333333333333333333"},
		{name: "large amount", rateJSON: tenth, amount: "999999999999999.99", from: "VES", to: "USD", result: "9999999999999999.90"},
		{name: "1 USD", rateJSON: tenth, amount: "1", from: "USD", to: "VES", result: "0.10"},
		{name: "underscores", rateJSON: tenth, amount: "1_000", from: "USD", to: "VES", result: "100.00"},
		{name: "exponent", rateJSON: tenth, amount: "1e3", from: "USD", to: "VES", result: "100.00"},
		{name: "zero", rateJSON: tenth, amount: "0", from: "USD", to: "VES", result: "0.00"},
		{name: "spaces", rateJSON: tenth, amount: " 2.50 ", from: " usd ", to: "ves", result: "0.25", amountWant: "2.5"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var c *bcv.Client
			if tc.rateJSON != "" {
				_, c = rateJSON(t, tc.rateJSON)
			} else {
				_, c = setup(t, nil)
			}
			v := must(c.Convert(ctx, tc.amount, tc.from, tc.to, tc.opts...))
			check := func(label, got, want string) {
				t.Helper()
				if want != "" && got != want {
					t.Errorf("%s: got %q, want %q", label, got, want)
				}
			}
			check("Result", v.Result, tc.result)
			check("ResultExact", v.ResultExact, tc.exact)
			check("Rate", v.Rate, tc.rate)
			check("Amount", v.Amount, tc.amountWant)
			check("EffectiveDate", v.EffectiveDate, tc.effective)
			check("String", v.String(), tc.summary)
			if tc.decimals != 0 {
				eq(t, "Decimals", v.Decimals, tc.decimals)
			}
			if tc.used != nil {
				eq(t, "RatesUsed", v.RatesUsed, tc.used)
			}
			eq(t, "CarriedForward", v.CarriedForward, tc.carried)
			if tc.carried {
				eq(t, "Note", v.Note, sundayNote)
				eq(t, "Date", v.Date, "2026-01-04")
			} else {
				eq(t, "Note", v.Note, "")
			}
		})
	}
}

func TestConvertFloatAccessors(t *testing.T) {
	_, c := setup(t, nil)
	v := must(c.Convert(ctx, "100", "USD", "VES"))
	eq(t, "ResultFloat", v.ResultFloat(), 91664.77)
	eq(t, "RateFloat", v.RateFloat(), 916.6477)
	eq(t, "From/To", v.From+"/"+v.To, "USD/VES")
	eq(t, "Date", v.Date, "2026-11-18")
}

func TestConvertErrors(t *testing.T) {
	for _, tc := range []struct {
		name, amount, from, to string
		opts                   []bcv.ConvertOption
		kind                   error
		msg                    string
	}{
		{"same currency", "1", "USD", "usd", nil, bcv.ErrInvalidCurrency, `"from" and "to" are both USD; choose two different currencies.`},
		{"unknown currency", "1", "USD", "GBP", nil, bcv.ErrInvalidCurrency, `Unsupported currency "GBP": use one of VES, USD, EUR, CNY, TRY, RUB.`},
		{"negative", "-1", "USD", "VES", nil, bcv.ErrInvalidAmount, `Invalid amount "-1": it must be zero or positive.`},
		{"negative fraction", "-0.5", "USD", "VES", nil, bcv.ErrInvalidAmount, `Invalid amount "-0.5": it must be zero or positive.`},
		{"not a number", "abc", "USD", "VES", nil, bcv.ErrInvalidAmount, `Invalid amount "abc": expected a number.`},
		{"empty", "", "USD", "VES", nil, bcv.ErrInvalidAmount, `Invalid amount "": expected a number.`},
		{"Infinity", "Infinity", "USD", "VES", nil, bcv.ErrInvalidAmount, `Invalid amount "Infinity": it must be a finite number.`},
		{"NaN", "nan", "USD", "VES", nil, bcv.ErrInvalidAmount, `Invalid amount "nan": it must be a finite number.`},
		{"too large", "1e16", "USD", "VES", nil, bcv.ErrInvalidAmount, `Invalid amount "1e16": it must not exceed 1e15.`},
		{"decimals -1", "1", "USD", "VES", []bcv.ConvertOption{bcv.Decimals(-1)}, bcv.ErrInvalidAmount,
			"Invalid decimals -1: use a whole number from 0 to 12, or FullPrecision()."},
		{"decimals 13", "1", "USD", "VES", []bcv.ConvertOption{bcv.Decimals(13)}, bcv.ErrInvalidAmount,
			"Invalid decimals 13: use a whole number from 0 to 12, or FullPrecision()."},
		{"bad date", "1", "USD", "VES", []bcv.ConvertOption{bcv.OnDate("2026-02-30")}, bcv.ErrInvalidDate,
			`Invalid date "2026-02-30": use a real calendar date in YYYY-MM-DD format, e.g. 2026-01-02.`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f, c := setup(t, nil)
			_, err := c.Convert(ctx, tc.amount, tc.from, tc.to, tc.opts...)
			wantErr(t, err, tc.kind, tc.msg)
			eq(t, "requests", len(f.Calls()), 0)
		})
	}
}

func TestConvertCurrencyMissingThatDay(t *testing.T) {
	_, c := setup(t, nil)
	_, err := c.Convert(ctx, "1", "USD", "EUR", bcv.OnDate("2021-08-02"))
	wantErr(t, err, bcv.ErrCurrencyNotAvailable,
		"No BCV rate for EUR on 2021-08-02 (older entries may lack some currencies). Available: USD.")
	_, err = c.Convert(ctx, "1", "CNY", "EUR", bcv.OnDate("2021-08-02"))
	wantErr(t, err, bcv.ErrCurrencyNotAvailable, "No BCV rate for CNY and EUR on 2021-08-02...")
}

// ------------------------------------------------------------------ status

func TestStatus(t *testing.T) {
	_, c := setup(t, nil)
	s := must(c.Status(ctx))
	eq(t, "Status", s.Status, "ok")
	eq(t, "Stale", s.Stale, false)
	eq(t, "AgeHours", s.AgeHours, 13.0) // 02:01 UTC -> 15:00 UTC
	eq(t, "SupportedCurrencies", s.SupportedCurrencies, []string{"USD", "EUR", "CNY", "TRY", "RUB"})
	eq(t, "Date", s.Date, "2026-11-18")
	eq(t, "EffectiveDate", s.EffectiveDate, "2026-11-18")
	eq(t, "Timezone", s.Timezone, "America/Caracas")
	eq(t, "APIVersion", s.APIVersion, "v1")
	eq(t, "Currencies", s.Currencies, map[string]bool{"USD": true, "EUR": true, "CNY": true, "TRY": true, "RUB": true})
	eq(t, "GeneratedAt", s.GeneratedAt, time.Date(2026, 11, 18, 10, 27, 42, 276253000, time.UTC))
	eq(t, "String", s.String(), "Status ok: last capture 2026-11-18T02:01:03.699523+00:00 (13 h ago), effective date 2026-11-18.")
}

func TestStatusIsStaleAfter96Hours(t *testing.T) {
	_, c := setup(t, nil, bcv.WithClock(func() time.Time { return time.Date(2026, 11, 22, 3, 0, 0, 0, time.UTC) }))
	s := must(c.Status(ctx))
	eq(t, "AgeHours", s.AgeHours, 97.0)
	eq(t, "Stale", s.Stale, true)
	if !strings.Contains(s.String(), "STALE") {
		t.Errorf("String() = %q", s.String())
	}
}

func TestStatusWithMissingFields(t *testing.T) {
	_, c := setup(t, map[string]reply{"status.json": {200, `{"currencies": {"USD": 1, "EUR": 0}}`}})
	s := must(c.Status(ctx))
	eq(t, "Status", s.Status, "unknown")
	eq(t, "Stale", s.Stale, true)
	eq(t, "SupportedCurrencies", s.SupportedCurrencies, bcv.Currencies)
	eq(t, "Currencies", s.Currencies, map[string]bool{"USD": true, "EUR": false})
	eq(t, "String", s.String(), "Status unknown (STALE): last capture unknown, effective date unknown.")
}

func TestParseTimestampVariants(t *testing.T) {
	utc := func(ns int) time.Time { return time.Date(2026, 1, 5, 21, 0, 0, ns, time.UTC) }
	for _, tc := range []struct {
		in   string
		want time.Time
	}{
		{"2026-01-05T21:00:00Z", utc(0)},
		{"2026-01-05T21:00:00.1+00:00", utc(100000000)},
		{"2026-01-05T21:00:00.123456789Z", utc(123456000)},
		{"2026-01-05T17:00:00-04:00", utc(0)},
		{"2026-01-05T17:00:00-0400", utc(0)},
		{"2026-01-05 21:00", utc(0)},
		{"garbage", time.Time{}},
		{"2026-02-30T21:00:00Z", time.Time{}},
	} {
		_, c := setup(t, map[string]reply{"rate.json": {200, fmt.Sprintf(`{"USD": 1, "date": "2026-01-05", "updated_at": %q}`, tc.in)}})
		eq(t, tc.in, must(c.Latest(ctx)).UpdatedAt, tc.want)
	}
}

// ------------------------------------------------------------------ upstream errors

func TestUpstreamErrors(t *testing.T) {
	for _, tc := range []struct {
		name      string
		overrides map[string]reply
		call      func(*bcv.Client) error
		kind      error
		msg       string
		status    int
	}{
		{"HTTP 503", map[string]reply{"rate.json": {503, "down"}}, latest, bcv.ErrUpstream,
			"The BCV Today data API answered HTTP 503 for /api/v1/rate.json. Try again in a moment.", 503},
		{"invalid JSON", map[string]reply{"rate.json": {200, "<html>"}}, latest, bcv.ErrUpstream,
			"The BCV Today data API returned invalid JSON for /api/v1/rate.json.", 0},
		{"trailing garbage", map[string]reply{"rate.json": {200, `{"USD": 1} x`}}, latest, bcv.ErrUpstream,
			"The BCV Today data API returned invalid JSON for /api/v1/rate.json.", 0},
		{"history not an array", map[string]reply{"history.json": {200, "{}"}},
			func(c *bcv.Client) error { _, err := c.History(ctx, "USD"); return err }, bcv.ErrUpstream,
			"Unexpected history.json shape (expected an array).", 0},
		{"rate not an object", map[string]reply{"rate.json": {200, "[]"}}, latest, bcv.ErrUpstream,
			"Unexpected /api/v1/rate.json shape (expected an object).", 0},
		{"snapshot not an object", map[string]reply{"history/2026-01-06.json": {200, "1"}},
			func(c *bcv.Client) error { _, err := c.On(ctx, "2026-01-06", ""); return err }, bcv.ErrUpstream,
			"Unexpected day snapshot shape (expected an object).", 0},
		{"entry without date", map[string]reply{"rate.json": {200, `{"USD": 1}`}}, latest, bcv.ErrUpstream,
			"Unexpected API response: the entry has no valid 'date'.", 0},
		{"404 on a plain path", map[string]reply{"status.json": {404, ""}},
			func(c *bcv.Client) error { _, err := c.Status(ctx); return err }, bcv.ErrNotFound,
			"Not found: /api/v1/status.json", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, c := setup(t, tc.overrides)
			err := tc.call(c)
			wantErr(t, err, tc.kind, tc.msg)
			var e *bcv.Error
			errors.As(err, &e)
			eq(t, "StatusCode", e.StatusCode, tc.status)
		})
	}
}

func latest(c *bcv.Client) error { _, err := c.Latest(ctx); return err }

func TestNetworkFailureIsUpstream(t *testing.T) {
	f := newFakeAPI(nil)
	url := f.URL
	f.Close()
	_, err := bcv.New(bcv.WithBaseURL(url)).Latest(ctx)
	wantErr(t, err, bcv.ErrUpstream, "Could not reach the BCV Today data API (...")
	if !strings.HasSuffix(err.Error(), "). Try again in a moment.") || errors.Unwrap(err) == nil {
		t.Errorf("unexpected error %q", err)
	}
}

func TestTimeoutIsUpstream(t *testing.T) {
	f, c := setup(t, nil, bcv.WithTimeout(50*time.Millisecond))
	f.delay.Store(int64(2 * time.Second))
	_, err := c.Latest(ctx)
	wantErr(t, err, bcv.ErrUpstream, "Could not reach the BCV Today data API (timed out after 50ms). Try again in a moment.")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("timeout must wrap context.DeadlineExceeded: %v", err)
	}
}

func TestContextCancellationIsUpstream(t *testing.T) {
	f, c := setup(t, nil)
	f.delay.Store(int64(2 * time.Second))
	cctx, cancel := context.WithTimeout(ctx, 30*time.Millisecond)
	defer cancel()
	_, err := c.Latest(cctx)
	wantErr(t, err, bcv.ErrUpstream, "Could not reach the BCV Today data API (context deadline exceeded). Try again in a moment.")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("must wrap the context error: %v", err)
	}
	canceled, cancelNow := context.WithCancel(ctx)
	cancelNow()
	_, err = c.Status(canceled)
	if !errors.Is(err, context.Canceled) || !errors.Is(err, bcv.ErrUpstream) {
		t.Errorf("canceled context: %v", err)
	}
}

func TestErrorTypesAndHierarchy(t *testing.T) {
	for kind, name := range map[error]string{
		bcv.ErrInvalidDate: "InvalidDate", bcv.ErrInvalidCurrency: "InvalidCurrency", bcv.ErrInvalidAmount: "InvalidAmount",
		bcv.ErrInvalidArgument: "InvalidArgument", bcv.ErrDateOutOfRange: "DateOutOfRange",
		bcv.ErrCurrencyNotAvailable: "CurrencyNotAvailable", bcv.ErrNotFound: "NotFound", bcv.ErrUpstream: "UpstreamError",
	} {
		e := &bcv.Error{Kind: kind, Message: "m"}
		eq(t, "Type", e.Type(), name)
		isArg := kind == bcv.ErrInvalidDate || kind == bcv.ErrInvalidCurrency || kind == bcv.ErrInvalidAmount || kind == bcv.ErrInvalidArgument
		eq(t, name+" is InvalidArgument", errors.Is(e, bcv.ErrInvalidArgument), isArg)
		eq(t, name+" is itself", errors.Is(fmt.Errorf("wrapped: %w", e), kind), true)
		eq(t, name+" is not NotFound", errors.Is(e, bcv.ErrNotFound), kind == bcv.ErrNotFound)
	}
}

// ------------------------------------------------------------------ cache and concurrency

func TestCacheTTL(t *testing.T) {
	var now atomic.Int64
	now.Store(fixtureNow.UnixNano())
	clock := func() time.Time { return time.Unix(0, now.Load()) }
	f, c := setup(t, nil, bcv.WithCacheTTL(300*time.Second), bcv.WithClock(clock))
	must(c.Latest(ctx))
	must(c.Latest(ctx))
	must(c.Convert(ctx, "1", "USD", "VES"))
	eq(t, "calls", len(f.Calls()), 1)
	now.Add(int64(299 * time.Second))
	must(c.Latest(ctx))
	eq(t, "calls after 299s", len(f.Calls()), 1)
	now.Add(int64(2 * time.Second))
	must(c.Latest(ctx))
	eq(t, "calls after 301s", len(f.Calls()), 2)
	c.ClearCache()
	must(c.Latest(ctx))
	eq(t, "calls after ClearCache", len(f.Calls()), 3)
}

func TestCacheDisabled(t *testing.T) {
	f, c := setup(t, nil, bcv.WithCacheTTL(0))
	must(c.Latest(ctx))
	must(c.Latest(ctx))
	eq(t, "calls", len(f.Calls()), 2)
}

func TestErrorsAreNotCached(t *testing.T) {
	f, c := setup(t, map[string]reply{"rate.json": {500, ""}})
	for range 2 {
		_, err := c.Latest(ctx)
		wantErr(t, err, bcv.ErrUpstream, "")
	}
	eq(t, "calls", len(f.Calls()), 2)
}

func TestConcurrentCallsShareRequestsAndCache(t *testing.T) {
	f, c := setup(t, nil)
	f.delay.Store(int64(20 * time.Millisecond))
	var wg sync.WaitGroup
	errs := make(chan error, 400)
	for i := range 100 {
		wg.Add(4)
		go func() {
			defer wg.Done()
			r, err := c.Latest(ctx)
			if err == nil && r.Rate("USD") != "916.6477" {
				err = fmt.Errorf("goroutine %d: bad rate %q", i, r.Rate("USD"))
			}
			errs <- err
		}()
		go func() {
			defer wg.Done()
			v, err := c.Convert(ctx, "100", "USD", "VES")
			if err == nil && v.Result != "91664.77" {
				err = fmt.Errorf("bad result %q", v.Result)
			}
			errs <- err
		}()
		go func() {
			defer wg.Done()
			_, err := c.History(ctx, "EUR", bcv.Days(10))
			errs <- err
		}()
		go func() {
			defer wg.Done()
			d, err := c.On(ctx, "2026-01-04", "USD")
			if err == nil && d.Note != sundayNote {
				err = fmt.Errorf("bad note %q", d.Note)
			}
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	eq(t, "rate.json requests", f.count("/api/v1/rate.json"), 1)
	eq(t, "history.json requests", f.count("/api/v1/history.json"), 1)
	eq(t, "snapshot requests", f.count("/api/v1/history/2026-01-04.json"), 1)
}

func TestFollowerRetriesWhenTheLeaderIsCanceled(t *testing.T) {
	f, c := setup(t, nil)
	f.delay.Store(int64(100 * time.Millisecond))
	leader, cancel := context.WithCancel(ctx)
	done := make(chan error, 1)
	go func() { _, err := c.Latest(leader); done <- err }()
	time.Sleep(20 * time.Millisecond) // let the leader start its request
	follower := make(chan error, 1)
	go func() { _, err := c.Latest(ctx); follower <- err }()
	time.Sleep(20 * time.Millisecond)
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("leader: %v", err)
	}
	if err := <-follower; err != nil {
		t.Fatalf("follower must retry with its own context: %v", err)
	}
}
