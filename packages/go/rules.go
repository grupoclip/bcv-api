package bcv

// Business rules shared by every BCV Today client: the same date validation,
// carry-forward semantics, history windowing, cross rates through the bolivar and
// the same English messages as packages/python/bcv/_core.py,
// packages/js/src/rules.ts and packages/php/src/Internal/Rules.php.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Currencies published by BCV, in display order. Conversions also accept "VES"
// (and its pre-2021 name "VEF").
var Currencies = []string{"USD", "EUR", "CNY", "TRY", "RUB"}

var anyCurrencies = []string{"VES", "USD", "EUR", "CNY", "TRY", "RUB"}

const (
	// DefaultBaseURL is the API origin used unless [WithBaseURL] changes it.
	DefaultBaseURL = "https://bcv.today"
	// Source is the attribution of every rate.
	Source = "Banco Central de Venezuela (BCV), via https://bcv.today"
	// Unit is the unit of every rate value.
	Unit = "VES (bolivars) per 1 unit of the currency"
	// EarliestSnapshot is the first calendar day with a /api/v1/history/{date}.json snapshot.
	EarliestSnapshot = "2021-08-02"
	// MaxHistoryDays is the largest number of daily entries kept by history.json.
	MaxHistoryDays = 1830
	// StaleAfterHours is the age of the last capture after which data is considered stale.
	StaleAfterHours = 96.0

	latestPath  = "/api/v1/rate.json"
	historyPath = "/api/v1/history.json"
	statusPath  = "/api/v1/status.json"
)

var (
	isoDateRE   = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	timestampRE = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2})(:\d{2})?(?:\.(\d+))?([Zz]|[+-]\d{2}:?\d{2})?$`)
	nonFiniteRE = regexp.MustCompile(`(?i)^[+-]?(nan|inf|infinity)$`)
	maxAmount   = decFromInt(1_000_000_000_000_000)
	hundred     = decFromInt(100)
	caracas     = time.FixedZone("America/Caracas", -4*3600)
)

func dayPath(date string) string { return "/api/v1/history/" + date + ".json" }

// repr quotes a caller value for messages, like JSON (and the other clients).
func repr(s string) string {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(s)
	return strings.TrimSuffix(b.String(), "\n")
}

// ------------------------------------------------------------------ dates

func isISODate(s string) bool {
	if !isoDateRE.MatchString(s) {
		return false
	}
	_, err := time.Parse(time.DateOnly, s)
	return err == nil
}

func invalidDateMessage(label, value string) string {
	return fmt.Sprintf("Invalid %s %s: use a real calendar date in YYYY-MM-DD format, e.g. 2026-01-02.", label, repr(value))
}

// parseDate validates a "YYYY-MM-DD" argument (surrounding spaces are ignored).
func parseDate(value, label string) (string, error) {
	text := strings.TrimSpace(value)
	if isISODate(text) {
		return text, nil
	}
	return "", newError(ErrInvalidDate, "%s", invalidDateMessage(label, value))
}

func todayCaracas(now time.Time) string { return now.In(caracas).Format(time.DateOnly) }

func addDays(date string, days int) string {
	t, _ := time.Parse(time.DateOnly, date)
	return t.AddDate(0, 0, days).Format(time.DateOnly)
}

func weekday(date string) string {
	t, _ := time.Parse(time.DateOnly, date)
	return t.Weekday().String()
}

// parseTimestamp parses an ISO 8601 timestamp (any fraction length, "Z" or an
// offset; no offset means UTC) as UTC, truncated to microseconds like Python and
// PHP. It returns the zero time when the value is missing or invalid.
func parseTimestamp(value any) time.Time {
	s, ok := value.(string)
	if !ok {
		return time.Time{}
	}
	m := timestampRE.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return time.Time{}
	}
	seconds := m[3]
	if seconds == "" {
		seconds = ":00"
	}
	fraction := ""
	if m[4] != "" {
		fraction = "." + (m[4] + "000000")[:6]
	}
	zone := m[5]
	switch {
	case zone == "" || strings.EqualFold(zone, "z"):
		zone = "+00:00"
	case len(zone) == 5: // +hhmm
		zone = zone[:3] + ":" + zone[3:]
	}
	t, err := time.Parse("2006-01-02T15:04:05.999999Z07:00", m[1]+"T"+m[2]+seconds+fraction+zone)
	if err != nil {
		return time.Time{}
	}
	return t.UTC()
}

func notPublishedMessage(date, latest string) string {
	upto := " to the latest business day."
	if latest != "" {
		upto = " to " + latest + "."
	}
	return "No BCV rate published yet for " + date + ". Daily snapshots are available from " + EarliestSnapshot +
		upto + " Use latest() for the rate currently in effect."
}

// carryForwardNote explains a weekend/holiday carry-forward, or "" when the rate is that day's own.
func carryForwardNote(date, effective string) string {
	if effective == "" || effective == date {
		return ""
	}
	return fmt.Sprintf("%s (%s) uses the rate with effective date %s (%s): "+
		"a published BCV rate stays in effect until the next publication "+
		"(weekends and holidays carry it forward).", date, weekday(date), effective, weekday(effective))
}

// checkDay rejects dates before the first snapshot or after tomorrow in Caracas.
func checkDay(date, today string) error {
	if date < EarliestSnapshot {
		return newError(ErrDateOutOfRange, "No BCV data for %s: daily snapshots start on %s.", date, EarliestSnapshot)
	}
	// BCV publishes the next business day's rate in the afternoon, so allow tomorrow.
	if date > addDays(today, 1) {
		return newError(ErrDateOutOfRange,
			"%s is in the future (today in Caracas is %s); BCV rates are only known up to the next business day.",
			date, today)
	}
	return nil
}

// ------------------------------------------------------------------ currencies and amounts

func normalizeCurrency(code string, allowVES bool) (string, error) {
	valid := Currencies
	if allowVES {
		valid = anyCurrencies
	}
	upper := strings.ToUpper(strings.TrimSpace(code))
	if upper == "VEF" && allowVES {
		upper = "VES" // pre-2021 name some users still type
	}
	for _, c := range valid {
		if c == upper {
			return upper, nil
		}
	}
	return "", newError(ErrInvalidCurrency, "Unsupported currency %s: use one of %s.", repr(code), strings.Join(valid, ", "))
}

// parseAmount validates an amount string ("100", "12.50", "1_000", "1e3").
func parseAmount(amount string) (dec, error) {
	text := strings.ReplaceAll(strings.TrimSpace(amount), "_", "")
	if nonFiniteRE.MatchString(text) {
		return dec{}, newError(ErrInvalidAmount, "Invalid amount %s: it must be a finite number.", repr(amount))
	}
	d, ok := parseDecimal(text)
	if !ok {
		return dec{}, newError(ErrInvalidAmount, "Invalid amount %s: expected a number.", repr(amount))
	}
	if d.sign() < 0 {
		return dec{}, newError(ErrInvalidAmount, "Invalid amount %s: it must be zero or positive.", repr(amount))
	}
	if d.cmp(maxAmount) > 0 {
		return dec{}, newError(ErrInvalidAmount, "Invalid amount %s: it must not exceed 1e15.", repr(amount))
	}
	return d, nil
}

// ------------------------------------------------------------------ entries

// rateValue is a positive, finite rate from a JSON number (decoded with UseNumber).
func rateValue(v any) (dec, bool) {
	n, ok := v.(json.Number)
	if !ok {
		return dec{}, false
	}
	d, ok := parseDecimal(string(n))
	if !ok || d.sign() <= 0 {
		return dec{}, false
	}
	return d, true
}

// ratesOf returns the published rates of an entry.
func ratesOf(entry map[string]any) map[string]dec {
	out := make(map[string]dec, len(Currencies))
	for _, c := range Currencies {
		if d, ok := rateValue(entry[c]); ok {
			out[c] = d
		}
	}
	return out
}

// codesOf lists the keys of a rate map in canonical currency order.
func codesOf[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for _, c := range Currencies {
		if _, ok := m[c]; ok {
			out = append(out, c)
		}
	}
	return out
}

func plainRates(rates map[string]dec) map[string]string {
	out := make(map[string]string, len(rates))
	for c, d := range rates {
		out[c] = d.toPlain()
	}
	return out
}

func entryDate(entry map[string]any, key string) string {
	if s, ok := entry[key].(string); ok && isISODate(s) {
		return s
	}
	return ""
}

// entryDates returns the calendar date and effective date of an entry.
func entryDates(entry map[string]any, fallback string) (string, string, error) {
	day := entryDate(entry, "date")
	if day == "" {
		day = fallback
	}
	if day == "" {
		return "", "", newError(ErrUpstream, "Unexpected API response: the entry has no valid 'date'.")
	}
	effective := entryDate(entry, "effective_date")
	if effective == "" {
		effective = day
	}
	return day, effective, nil
}

// ------------------------------------------------------------------ history

type seriesPoint struct {
	date, effective string
	rate            dec
}

type historyWindow struct {
	series   []seriesPoint
	min, max int // indexes into series (earliest day on ties)
	notes    []string
}

func buildWindow(entries []map[string]any, currency string, days int, from, to string) (*historyWindow, error) {
	series := make([]seriesPoint, 0, len(entries))
	for _, e := range entries {
		day := entryDate(e, "date")
		rate, ok := rateValue(e[currency])
		if day == "" || !ok {
			continue
		}
		effective := entryDate(e, "effective_date")
		if effective == "" {
			effective = day
		}
		series = append(series, seriesPoint{date: day, effective: effective, rate: rate})
	}
	// history.json is published oldest first; a stable sort keeps that order.
	sort.SliceStable(series, func(i, j int) bool { return series[i].date < series[j].date })
	if len(series) == 0 {
		return nil, newError(ErrCurrencyNotAvailable, "No %s data in the BCV history.", currency)
	}
	earliest, latest := series[0].date, series[len(series)-1].date

	var start, end string
	if from != "" || to != "" {
		start, end = from, to
		if start == "" {
			start = earliest
		}
		if end == "" {
			end = latest
		}
	} else {
		end = latest
		start = addDays(latest, -(days - 1))
	}
	w := &historyWindow{}
	for _, p := range series {
		if p.date >= start && p.date <= end {
			w.series = append(w.series, p)
		}
	}
	if len(w.series) == 0 {
		return nil, newError(ErrDateOutOfRange,
			"No %s rates between %s and %s. The history covers %s to %s for %s (latest %d daily entries). For older single days use on().",
			currency, start, end, earliest, latest, currency, MaxHistoryDays)
	}
	for i, p := range w.series {
		if p.rate.cmp(w.series[w.min].rate) < 0 {
			w.min = i
		}
		if p.rate.cmp(w.series[w.max].rate) > 0 {
			w.max = i
		}
	}
	if start < earliest {
		w.notes = append(w.notes, fmt.Sprintf("History for %s starts on %s; earlier dates were skipped.", currency, earliest))
	}
	if end > latest {
		w.notes = append(w.notes, fmt.Sprintf("Latest available date is %s.", latest))
	}
	return w, nil
}

// ------------------------------------------------------------------ status

func roundTo(x float64, places int) float64 {
	f := math.Pow(10, float64(places))
	return math.Round(x*f) / f
}

func truthy(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case string:
		return t != ""
	case json.Number:
		d, ok := parseDecimal(string(t))
		return ok && d.sign() != 0
	default:
		return true
	}
}

func textOf(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case json.Number:
		return string(t)
	case nil:
		return "null"
	default:
		return fmt.Sprint(t)
	}
}

// cloneJSON deep-copies decoded JSON so callers cannot mutate cached responses.
func cloneJSON(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, x := range t {
			out[k] = cloneJSON(x)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, x := range t {
			out[i] = cloneJSON(x)
		}
		return out
	default:
		return v
	}
}
