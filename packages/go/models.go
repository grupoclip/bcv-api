package bcv

import (
	"strconv"
	"strings"
	"time"
)

// Money values are exact decimal strings without trailing zeros ("916.6477",
// "1007.38665582"), taken from the JSON text without going through float64.
// Calendar days are "YYYY-MM-DD" strings. The Float accessors are conveniences
// for display or charts; never use them for money math.

func lookup(m map[string]string, code string) string {
	return m[strings.ToUpper(strings.TrimSpace(code))]
}

func toFloat(s string) float64 {
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return f
}

// Rates are the official BCV rates currently in effect (/api/v1/rate.json).
type Rates struct {
	// Rates maps currency codes to bolivars per unit (only the currencies published).
	Rates map[string]string
	// Date is the calendar date of the snapshot.
	Date string
	// EffectiveDate is the official BCV validity date ("fecha valor").
	EffectiveDate string
	// UpdatedAt is the UTC capture time of the rate; zero when unknown.
	UpdatedAt time.Time
	// Raw is the entry as published (numbers are json.Number).
	Raw map[string]any
}

// Rate returns the rate for code (case-insensitive) as a decimal string, or "" when absent.
func (r *Rates) Rate(code string) string { return lookup(r.Rates, code) }

// Float returns the rate for code as a float64, or 0 when absent.
func (r *Rates) Float(code string) float64 { return toFloat(r.Rate(code)) }

// Currencies lists the codes present in Rates, in canonical order (USD, EUR, CNY, TRY, RUB).
func (r *Rates) Currencies() []string { return codesOf(r.Rates) }

// String is a one-line English summary.
func (r *Rates) String() string {
	return "Official BCV rates (effective " + r.EffectiveDate + ", Bs. per unit): " + linePlain(r.Rates)
}

// DayRate holds the BCV rate(s) in effect on one calendar day (/api/v1/history/{date}.json).
type DayRate struct {
	// Date is the calendar day that was requested.
	Date string
	// EffectiveDate is the date of the BCV publication in effect that day (earlier on weekends and holidays).
	EffectiveDate string
	// CarriedForward is true when EffectiveDate differs from Date.
	CarriedForward bool
	// Rates maps currency codes to bolivars per unit (only the requested currency, when one was given).
	Rates map[string]string
	// UpdatedAt is the UTC capture time; zero when unknown.
	UpdatedAt time.Time
	// Note explains the carry-forward; "" when the rate is that day's own.
	Note string
	// Raw is the snapshot as published (numbers are json.Number).
	Raw map[string]any
}

// Rate returns the rate for code (case-insensitive) as a decimal string, or "" when absent.
func (d *DayRate) Rate(code string) string { return lookup(d.Rates, code) }

// Float returns the rate for code as a float64, or 0 when absent.
func (d *DayRate) Float(code string) float64 { return toFloat(d.Rate(code)) }

// Currencies lists the codes present in Rates, in canonical order.
func (d *DayRate) Currencies() []string { return codesOf(d.Rates) }

// String is a one-line English summary, including the carry-forward note.
func (d *DayRate) String() string {
	text := "BCV rate in effect on " + d.Date + " (Bs. per unit): " + linePlain(d.Rates) + "."
	if d.Note != "" {
		return text + " " + d.Note
	}
	return text
}

// HistoryPoint is one daily entry of a [History] series.
type HistoryPoint struct {
	Date          string
	EffectiveDate string
	// Rate is bolivars per unit of the series currency (exact decimal string).
	Rate string
	// CarriedForward is true when EffectiveDate differs from Date (weekend or holiday).
	CarriedForward bool
}

// RateFloat returns Rate as a float64.
func (p HistoryPoint) RateFloat() float64 { return toFloat(p.Rate) }

// History is a daily rate series for one currency, oldest first (never empty).
type History struct {
	Currency string
	Points   []HistoryPoint
	// Start and End are the first and last dates of Points.
	Start, End string
	First      HistoryPoint
	Last       HistoryPoint
	// Min and Max are the lowest and highest rates (earliest day on ties).
	Min, Max HistoryPoint
	// Change is Last.Rate - First.Rate (exact decimal string).
	Change string
	// ChangePct is the percentage change from First to Last with 4 decimals (half-up), e.g. "1.6955".
	ChangePct string
	// Note explains when the requested range was clipped to the available data; "" otherwise.
	Note string

	summary string
}

// ChangeFloat returns Change as a float64.
func (h *History) ChangeFloat() float64 { return toFloat(h.Change) }

// ChangePctFloat returns ChangePct as a float64.
func (h *History) ChangePctFloat() float64 { return toFloat(h.ChangePct) }

// String is a one-line English summary, including the note.
func (h *History) String() string { return h.summary }

// Conversion is the result of [Client.Convert].
//
// Result is Amount * RatesUsed[From] / RatesUsed[To] (VES counts as 1), computed
// with exact decimals (divisions keep 28 significant digits) and then rounded
// half-up to Decimals places.
type Conversion struct {
	// Amount is the normalized amount ("100", "0.1").
	Amount string
	From   string
	To     string
	// Result has exactly Decimals places ("91664.77", "3046.80"); with FullPrecision it equals ResultExact.
	Result string
	// ResultExact is the unrounded result (28 significant digits, no trailing zeros).
	ResultExact string
	// Rate is units of To per 1 unit of From (28 significant digits).
	Rate string
	// RatesUsed holds the bolivars per unit of the non-VES side(s) of the conversion.
	RatesUsed map[string]string
	// Date is the requested date, or the date of the latest snapshot.
	Date          string
	EffectiveDate string
	// CarriedForward is true when a requested date used an earlier publication.
	CarriedForward bool
	// Decimals is the number of places of Result, or -1 with FullPrecision.
	Decimals int
	// Note explains the carry-forward (only when a date was requested); "" otherwise.
	Note string

	summary string
}

// ResultFloat returns Result as a float64.
func (c *Conversion) ResultFloat() float64 { return toFloat(c.Result) }

// RateFloat returns Rate as a float64.
func (c *Conversion) RateFloat() float64 { return toFloat(c.Rate) }

// String is a one-line English summary, e.g.
// "100.00 USD = 91,664.77 VES at the official BCV rate (effective 2026-11-18; 1 USD = 916.647700 VES)."
func (c *Conversion) String() string { return c.summary }

// Status describes the freshness of the published data (/api/v1/status.json).
type Status struct {
	// Status is "ok" when the last capture succeeded ("unknown" when absent).
	Status string
	// UpdatedAt is the UTC time of the last capture; zero when unknown.
	UpdatedAt time.Time
	// GeneratedAt is the UTC time the status file was generated; zero when unknown.
	GeneratedAt time.Time
	// Date and EffectiveDate of the latest rate; "" when unknown.
	Date, EffectiveDate string
	// AgeHours is the time since UpdatedAt in hours (one decimal); only meaningful when UpdatedAt is not zero.
	AgeHours float64
	// Stale is true when Status is not "ok", UpdatedAt is unknown or older than 96 hours.
	Stale               bool
	SupportedCurrencies []string
	Currencies          map[string]bool
	// Timezone and APIVersion as published; "" when absent.
	Timezone, APIVersion string
	// Raw is the document as published (numbers are json.Number).
	Raw map[string]any
}

// String is a one-line English summary.
func (s *Status) String() string {
	var b strings.Builder
	b.WriteString("Status " + s.Status)
	if s.Stale {
		b.WriteString(" (STALE)")
	}
	b.WriteString(": last capture ")
	if raw, ok := s.Raw["updated_at"].(string); ok {
		b.WriteString(raw)
	} else {
		b.WriteString("unknown")
	}
	if !s.UpdatedAt.IsZero() {
		b.WriteString(" (" + strconv.FormatFloat(s.AgeHours, 'f', -1, 64) + " h ago)")
	}
	eff := s.EffectiveDate
	if eff == "" {
		eff = "unknown"
	}
	b.WriteString(", effective date " + eff + ".")
	return b.String()
}

// linePlain renders "USD 916.6477, EUR 1,007.3867" from decimal strings.
func linePlain(rates map[string]string) string {
	parts := make([]string, 0, len(rates))
	for _, c := range codesOf(rates) {
		d, _ := parseDecimal(rates[c])
		parts = append(parts, c+" "+d.group(4))
	}
	return strings.Join(parts, ", ")
}
