package bcv

import (
	"context"
	"fmt"
	"strings"
)

// Latest returns the official rates currently in effect (/api/v1/rate.json).
func (c *Client) Latest(ctx context.Context) (*Rates, error) {
	if c.err != nil {
		return nil, c.err
	}
	entry, err := c.latestEntry(ctx)
	if err != nil {
		return nil, err
	}
	date, effective, err := entryDates(entry, "")
	if err != nil {
		return nil, err
	}
	return &Rates{
		Rates:         plainRates(ratesOf(entry)),
		Date:          date,
		EffectiveDate: effective,
		UpdatedAt:     parseTimestamp(entry["updated_at"]),
		Raw:           cloneJSON(entry).(map[string]any),
	}, nil
}

// On returns the rate(s) in effect on a calendar day ("YYYY-MM-DD").
//
// BCV does not publish on weekends and holidays: the last published rate stays in
// effect, so EffectiveDate may be earlier than date and CarriedForward is then true,
// with an English Note. Data starts on 2021-08-02; dates after tomorrow (Caracas
// time) fail with ErrDateOutOfRange.
//
// currency restricts the result to one code (case-insensitive); "" returns every
// currency published that day. A currency not published that day fails with
// ErrCurrencyNotAvailable.
func (c *Client) On(ctx context.Context, date, currency string) (*DayRate, error) {
	if c.err != nil {
		return nil, c.err
	}
	day, err := parseDate(date, "date")
	if err != nil {
		return nil, err
	}
	code := ""
	if currency != "" {
		if code, err = normalizeCurrency(currency, false); err != nil {
			return nil, err
		}
	}
	entry, err := c.dayEntry(ctx, day)
	if err != nil {
		return nil, err
	}
	_, effective, err := entryDates(entry, day)
	if err != nil {
		return nil, err
	}
	rates := ratesOf(entry)
	if code != "" {
		v, ok := rates[code]
		if !ok {
			avail := strings.Join(codesOf(rates), ", ")
			if avail == "" {
				avail = "none"
			}
			return nil, newError(ErrCurrencyNotAvailable,
				"No %s rate in the BCV data for %s (older entries may lack some currencies). Available that day: %s.",
				code, day, avail)
		}
		rates = map[string]dec{code: v}
	}
	note := carryForwardNote(day, effective)
	return &DayRate{
		Date:           day,
		EffectiveDate:  effective,
		CarriedForward: note != "",
		Rates:          plainRates(rates),
		UpdatedAt:      parseTimestamp(entry["updated_at"]),
		Note:           note,
		Raw:            cloneJSON(entry).(map[string]any),
	}, nil
}

// HistoryOption selects the window of [Client.History].
type HistoryOption func(*historyOptions)

type historyOptions struct {
	days     int
	daysSet  bool
	start    string
	end      string
	rangeSet bool
}

// Days selects the last n calendar days ending on the latest published date
// (1 to 1830; the default is 30).
func Days(n int) HistoryOption {
	return func(o *historyOptions) { o.days, o.daysSet = n, true }
}

// Range selects an inclusive range of calendar days ("YYYY-MM-DD"); it overrides
// Days. Either bound may be "" to leave that side open.
func Range(start, end string) HistoryOption {
	return func(o *historyOptions) { o.start, o.end, o.rangeSet = start, end, true }
}

// History returns the daily series of one currency (USD, EUR, CNY, TRY or RUB),
// oldest first: the last 30 days by default, [Days](n) or a [Range].
//
// It reads /api/v1/history.json, which keeps the latest 1830 daily entries; ranges
// are clipped to what it covers and Note says so. Use [Client.On] for older single
// days.
func (c *Client) History(ctx context.Context, currency string, opts ...HistoryOption) (*History, error) {
	if c.err != nil {
		return nil, c.err
	}
	o := historyOptions{days: 30}
	for _, opt := range opts {
		if opt != nil {
			opt(&o)
		}
	}
	code, err := normalizeCurrency(currency, false)
	if err != nil {
		return nil, err
	}
	var start, end string
	if o.rangeSet && o.start != "" {
		if start, err = parseDate(o.start, "start"); err != nil {
			return nil, err
		}
	}
	if o.rangeSet && o.end != "" {
		if end, err = parseDate(o.end, "end"); err != nil {
			return nil, err
		}
	}
	if o.days < 1 || o.days > MaxHistoryDays {
		return nil, newError(ErrInvalidDate, "Invalid days %d: use a whole number from 1 to %d.", o.days, MaxHistoryDays)
	}
	if start != "" && end != "" && start > end {
		return nil, newError(ErrInvalidDate, "%q (%s) must be on or before %q (%s).", "start", start, "end", end)
	}
	entries, err := c.historyEntries(ctx)
	if err != nil {
		return nil, err
	}
	w, err := buildWindow(entries, code, o.days, start, end)
	if err != nil {
		return nil, err
	}
	return newHistory(code, w), nil
}

func newHistory(code string, w *historyWindow) *History {
	points := make([]HistoryPoint, len(w.series))
	for i, p := range w.series {
		points[i] = HistoryPoint{
			Date:           p.date,
			EffectiveDate:  p.effective,
			Rate:           p.rate.toPlain(),
			CarriedForward: p.effective != p.date,
		}
	}
	firstRate, lastRate := w.series[0].rate, w.series[len(w.series)-1].rate
	minRate, maxRate := w.series[w.min].rate, w.series[w.max].rate
	change := lastRate.sub(firstRate)
	pct := change.div(firstRate, precision).mul(hundred).quantize(4)
	h := &History{
		Currency:  code,
		Points:    points,
		Start:     points[0].Date,
		End:       points[len(points)-1].Date,
		First:     points[0],
		Last:      points[len(points)-1],
		Min:       points[w.min],
		Max:       points[w.max],
		Change:    change.toPlain(),
		ChangePct: pct.toFixed(4),
		Note:      strings.Join(w.notes, " "),
	}
	sign := "+"
	if change.sign() < 0 {
		sign = ""
	}
	h.summary = fmt.Sprintf("%s/VES from %s to %s (%d days): %s -> %s (%s%s%%). Min %s on %s, max %s on %s.",
		code, h.Start, h.End, len(points), firstRate.group(4), lastRate.group(4), sign, pct.toFixed(2),
		minRate.group(4), h.Min.Date, maxRate.group(4), h.Max.Date)
	if h.Note != "" {
		h.summary += " " + h.Note
	}
	return h
}

// ConvertOption tunes [Client.Convert].
type ConvertOption func(*convertOptions)

type convertOptions struct {
	decimals int
	full     bool
	date     string
	dateSet  bool
}

// Decimals sets the decimal places of Conversion.Result (0 to 12; the default is 2),
// rounded half-up.
func Decimals(n int) ConvertOption {
	return func(o *convertOptions) { o.decimals, o.full = n, false }
}

// FullPrecision keeps the unrounded result (28 significant digits) in Conversion.Result.
func FullPrecision() ConvertOption {
	return func(o *convertOptions) { o.full = true }
}

// OnDate uses the rate in effect on that calendar day ("YYYY-MM-DD") instead of the
// latest one, with the same carry-forward rules as [Client.On].
func OnDate(date string) ConvertOption {
	return func(o *convertOptions) { o.date, o.dateSet = date, true }
}

// Convert converts amount between VES, USD, EUR, CNY, TRY and RUB at the official
// BCV rate. Currency codes are case-insensitive ("VEF" is read as "VES").
//
// amount is a non-negative decimal string up to 1e15 ("100", "12.50", "1_000",
// "1e3"). Cross rates go through the bolivar: amount * vesPerFrom / vesPerTo. The
// math is exact decimal (no float drift; divisions keep 28 significant digits,
// half-up), then Result is rounded half-up to 2 places, or [Decimals](n), or not at
// all with [FullPrecision]. ResultExact is always the unrounded value.
func (c *Client) Convert(ctx context.Context, amount, from, to string, opts ...ConvertOption) (*Conversion, error) {
	if c.err != nil {
		return nil, c.err
	}
	o := convertOptions{decimals: 2}
	for _, opt := range opts {
		if opt != nil {
			opt(&o)
		}
	}
	value, err := parseAmount(amount)
	if err != nil {
		return nil, err
	}
	src, err := normalizeCurrency(from, true)
	if err != nil {
		return nil, err
	}
	dst, err := normalizeCurrency(to, true)
	if err != nil {
		return nil, err
	}
	if src == dst {
		return nil, newError(ErrInvalidCurrency, "%q and %q are both %s; choose two different currencies.", "from", "to", src)
	}
	if !o.full && (o.decimals < 0 || o.decimals > 12) {
		return nil, newError(ErrInvalidAmount, "Invalid decimals %d: use a whole number from 0 to 12, or FullPrecision().", o.decimals)
	}
	date := ""
	if o.dateSet {
		if date, err = parseDate(o.date, "date"); err != nil {
			return nil, err
		}
	}
	var entry map[string]any
	if date != "" {
		entry, err = c.dayEntry(ctx, date)
	} else {
		entry, err = c.latestEntry(ctx)
	}
	if err != nil {
		return nil, err
	}
	entryDay, effective, err := entryDates(entry, date)
	if err != nil {
		return nil, err
	}
	day := date
	if day == "" {
		day = entryDay
	}
	rates := ratesOf(entry)
	vesPer := func(code string) (dec, bool) {
		if code == "VES" {
			return decFromInt(1), true
		}
		d, ok := rates[code]
		return d, ok
	}
	rf, okF := vesPer(src)
	rt, okT := vesPer(dst)
	if !okF || !okT {
		var missing []string
		if !okF {
			missing = append(missing, src)
		}
		if !okT {
			missing = append(missing, dst)
		}
		return nil, newError(ErrCurrencyNotAvailable,
			"No BCV rate for %s on %s (older entries may lack some currencies). Available: %s.",
			strings.Join(missing, " and "), day, strings.Join(codesOf(rates), ", "))
	}
	used := map[string]string{}
	if src != "VES" {
		used[src] = rf.toPlain()
	}
	if dst != "VES" {
		used[dst] = rt.toPlain()
	}
	rate := rf.div(rt, precision)
	// Multiply first (like the Python library): VES -> X stays exact longer.
	exact := value.mul(rf).roundSignificant(precision).div(rt, precision)
	decimals := o.decimals
	result, rounded := exact.toPlain(), exact
	if o.full {
		decimals = -1
	} else {
		rounded = exact.quantize(decimals)
		result = rounded.format()
	}
	note := ""
	if date != "" {
		note = carryForwardNote(date, effective)
	}
	places := decimals
	if places < 0 {
		places = 8
	}
	conv := &Conversion{
		Amount:         value.toPlain(),
		From:           src,
		To:             dst,
		Result:         result,
		ResultExact:    exact.toPlain(),
		Rate:           rate.toPlain(),
		RatesUsed:      used,
		Date:           day,
		EffectiveDate:  effective,
		CarriedForward: note != "",
		Decimals:       decimals,
		Note:           note,
	}
	conv.summary = fmt.Sprintf("%s %s = %s %s at the official BCV rate (effective %s; 1 %s = %s %s).",
		value.group(2), src, rounded.group(places), dst, effective, src, rate.group(6), dst)
	if note != "" {
		conv.summary += " " + note
	}
	return conv, nil
}

// Status returns the freshness of the published data (/api/v1/status.json).
func (c *Client) Status(ctx context.Context) (*Status, error) {
	if c.err != nil {
		return nil, c.err
	}
	v, err := c.getJSON(ctx, statusPath)
	if err != nil {
		return nil, err
	}
	doc, err := expectObject(v, statusPath)
	if err != nil {
		return nil, err
	}
	s := &Status{
		Status:        "unknown",
		UpdatedAt:     parseTimestamp(doc["updated_at"]),
		GeneratedAt:   parseTimestamp(doc["generated_at"]),
		Date:          entryDate(doc, "date"),
		EffectiveDate: entryDate(doc, "effective_date"),
		Currencies:    map[string]bool{},
		Raw:           cloneJSON(doc).(map[string]any),
	}
	if st, ok := doc["status"].(string); ok {
		s.Status = st
	}
	if !s.UpdatedAt.IsZero() {
		s.AgeHours = roundTo(c.now().Sub(s.UpdatedAt).Hours(), 1)
	}
	s.Stale = s.UpdatedAt.IsZero() || s.AgeHours > StaleAfterHours || s.Status != "ok"
	if list, ok := doc["supported_currencies"].([]any); ok {
		s.SupportedCurrencies = make([]string, len(list))
		for i, x := range list {
			s.SupportedCurrencies[i] = textOf(x)
		}
	} else {
		s.SupportedCurrencies = append([]string(nil), Currencies...)
	}
	if m, ok := doc["currencies"].(map[string]any); ok {
		for k, x := range m {
			s.Currencies[k] = truthy(x)
		}
	}
	s.Timezone, _ = doc["timezone"].(string)
	s.APIVersion, _ = doc["api_version"].(string)
	return s, nil
}
