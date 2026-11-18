package main

// Command-line interface: bcv latest | on | convert | history | status.
//
// Same subcommands, flags, output and exit codes as the Python `bcv` and the
// JavaScript `bcv-today` CLIs: 0 success, 1 no data for the request (date out of
// range, currency not available), 2 invalid arguments, 3 upstream/network error.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	bcv "github.com/grupoclip/bcv-api/packages/go"
)

const (
	exitOK       = 0
	exitNoData   = 1
	exitUsage    = 2
	exitUpstream = 3

	prog        = "bcv"
	attribution = "Source: Banco Central de Venezuela via BCV Today (https://bcv.today). Unofficial."
)

var help = `Usage: ` + prog + ` [options] <command> [args]

Official Banco Central de Venezuela exchange rates from the BCV Today API
(https://bcv.today). Unofficial client, not affiliated with the bank.

Commands:
  latest                              rates currently in effect
  on <date> [-c CUR]                  rate in effect on a date (YYYY-MM-DD)
  convert <amount> <from> <to>        convert an amount, e.g. "` + prog + ` convert 100 USD VES"
          [-d DATE] [--decimals N]
  history <currency> [-n DAYS]        daily series (last N days, default 30, max ` + strconv.Itoa(bcv.MaxHistoryDays) + `)
          [--start DATE] [--end DATE]
  status                              data freshness

Options:
  --json             machine-readable JSON output
  --base-url URL     API origin (default https://bcv.today)
  --timeout SECONDS  request timeout (default 10)
  -h, --help         show this help
  -v, --version      show the version

Exit codes: 0 ok, 1 no data for the request, 2 invalid arguments, 3 network/API error.`

type optionSpec struct {
	short  string
	isBool bool
}

var options = map[string]optionSpec{
	"json":     {isBool: true},
	"base-url": {},
	"timeout":  {},
	"help":     {short: "h", isBool: true},
	"version":  {short: "v", isBool: true},
	"currency": {short: "c"},
	"date":     {short: "d"},
	"decimals": {},
	"days":     {short: "n"},
	"start":    {},
	"end":      {},
}

var common = []string{"json", "base-url", "timeout", "help", "version"}

var commands = map[string]struct {
	args    []string
	options []string
}{
	"latest":  {nil, nil},
	"on":      {[]string{"date"}, []string{"currency"}},
	"convert": {[]string{"amount", "from", "to"}, []string{"date", "decimals"}},
	"history": {[]string{"currency"}, []string{"days", "start", "end"}},
	"status":  {nil, nil},
}

var commandOrder = []string{"latest", "on", "convert", "history", "status"}

type usageError struct{ msg string }

func (e usageError) Error() string { return e.msg }

// Like argparse, negative numbers ("-5") are positionals, not options, so
// `convert -5 USD VES` reports an invalid amount.
var negativeRE = regexp.MustCompile(`^-\d+(?:\.\d*)?$`)

type parsedArgs struct {
	command     string
	positionals []string
	values      map[string]string // option name -> value ("true" for booleans)
}

func shortName(s string) (string, bool) {
	for name, spec := range options {
		if spec.short == s {
			return name, true
		}
	}
	return "", false
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func parse(argv []string) (*parsedArgs, error) {
	p := &parsedArgs{values: map[string]string{}}
	var positionals []string
	for i := 0; i < len(argv); i++ {
		arg := argv[i]
		switch {
		case arg == "--":
			positionals = append(positionals, argv[i+1:]...)
			i = len(argv)
		case strings.HasPrefix(arg, "--"):
			name, value, hasValue := strings.Cut(arg[2:], "=")
			spec, ok := options[name]
			if !ok {
				return nil, usageError{fmt.Sprintf("unknown option '--%s'", name)}
			}
			if spec.isBool {
				if hasValue {
					return nil, usageError{fmt.Sprintf("option '--%s' does not take an argument", name)}
				}
				p.values[name] = "true"
				continue
			}
			if !hasValue {
				if i+1 >= len(argv) {
					return nil, usageError{fmt.Sprintf("option '--%s <value>' argument missing", name)}
				}
				i++
				value = argv[i]
			}
			p.values[name] = value
		case strings.HasPrefix(arg, "-") && len(arg) > 1 && !negativeRE.MatchString(arg):
			name, ok := shortName(arg[1:2])
			if !ok {
				return nil, usageError{fmt.Sprintf("unknown option '-%s'", arg[1:2])}
			}
			spec := options[name]
			rest := arg[2:]
			if spec.isBool {
				if rest != "" {
					return nil, usageError{fmt.Sprintf("unknown option '%s'", arg)}
				}
				p.values[name] = "true"
				continue
			}
			if rest == "" {
				if i+1 >= len(argv) {
					return nil, usageError{fmt.Sprintf("option '-%s, --%s <value>' argument missing", spec.short, name)}
				}
				i++
				rest = argv[i]
			}
			p.values[name] = rest
		default:
			positionals = append(positionals, arg)
		}
	}
	if p.values["version"] != "" || p.values["help"] != "" {
		return p, nil
	}
	if len(positionals) == 0 {
		return nil, usageError{"missing command"}
	}
	p.command, p.positionals = positionals[0], positionals[1:]
	spec, ok := commands[p.command]
	if !ok {
		return nil, usageError{fmt.Sprintf("unknown command %q (choose from %s)", p.command, strings.Join(commandOrder, ", "))}
	}
	if len(p.positionals) != len(spec.args) {
		want := "no arguments"
		if len(spec.args) > 0 {
			parts := make([]string, len(spec.args))
			for i, a := range spec.args {
				parts[i] = "<" + a + ">"
			}
			want = strings.Join(parts, " ")
		}
		return nil, usageError{fmt.Sprintf("%q expects %s", p.command, want)}
	}
	for name := range p.values {
		if !contains(common, name) && !contains(spec.options, name) {
			return nil, usageError{fmt.Sprintf("option --%s is not valid for %q", name, p.command)}
		}
	}
	return p, nil
}

var intRE = regexp.MustCompile(`^-?\d+$`)

func intOption(values map[string]string, name string) (int, bool, error) {
	v, ok := values[name]
	if !ok {
		return 0, false, nil
	}
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if !intRE.MatchString(strings.TrimSpace(v)) || err != nil {
		return 0, false, usageError{fmt.Sprintf("argument --%s: invalid int value: '%s'", name, v)}
	}
	return n, true, nil
}

// run is the testable entry point; extra options are appended to the client's (testing hook).
func run(ctx context.Context, argv []string, stdout, stderr io.Writer, extra ...bcv.Option) int {
	p, err := parse(argv)
	if err != nil {
		fmt.Fprintf(stderr, "Usage: %s [options] <command> [args]   (%s --help for details)\n", prog, prog)
		fmt.Fprintf(stderr, "%s: error: %s\n", prog, err)
		return exitUsage
	}
	if p.values["version"] != "" {
		fmt.Fprintf(stdout, "%s %s\n", prog, bcv.Version)
		return exitOK
	}
	if p.values["help"] != "" {
		fmt.Fprintln(stdout, help)
		return exitOK
	}
	asJSON := p.values["json"] != ""
	result, text, err := execute(ctx, p, extra)
	if err != nil {
		var ue usageError
		if errors.As(err, &ue) {
			fmt.Fprintf(stderr, "%s: error: %s\n", prog, err)
			return exitUsage
		}
		code := exitNoData
		typ := "BCVError"
		var be *bcv.Error
		if errors.As(err, &be) {
			typ = be.Type()
		}
		switch {
		case errors.Is(err, bcv.ErrInvalidArgument):
			code = exitUsage
		case errors.Is(err, bcv.ErrUpstream):
			code = exitUpstream
		}
		if asJSON {
			out, _ := marshal(object{{"error", object{{"type", typ}, {"message", err.Error()}}}}, false)
			fmt.Fprintln(stdout, string(out))
		}
		fmt.Fprintf(stderr, "%s: error: %s\n", prog, err)
		return code
	}
	if asJSON {
		out, err := marshal(result, true)
		if err != nil {
			fmt.Fprintf(stderr, "%s: error: %s\n", prog, err)
			return exitUpstream
		}
		fmt.Fprintln(stdout, string(out))
	} else {
		fmt.Fprintln(stdout, text)
	}
	return exitOK
}

func execute(ctx context.Context, p *parsedArgs, extra []bcv.Option) (object, string, error) {
	timeout := 10.0
	if v, ok := p.values["timeout"]; ok {
		t, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
		if err != nil || t < 0 || math.IsInf(t, 0) || math.IsNaN(t) {
			return nil, "", usageError{fmt.Sprintf("argument --timeout: invalid float value: '%s'", v)}
		}
		timeout = t
	}
	opts := []bcv.Option{bcv.WithTimeout(time.Duration(timeout * float64(time.Second)))}
	if base, ok := p.values["base-url"]; ok {
		opts = append(opts, bcv.WithBaseURL(base))
	}
	c := bcv.New(append(opts, extra...)...)
	pos := p.positionals
	switch p.command {
	case "latest":
		r, err := c.Latest(ctx)
		if err != nil {
			return nil, "", err
		}
		return latestJSON(r), renderRates(r), nil
	case "on":
		currency, given := p.values["currency"]
		if given && currency == "" { // "" means "every currency" in the library, not on the command line
			return nil, "", &bcv.Error{Kind: bcv.ErrInvalidCurrency,
				Message: `Unsupported currency "": use one of ` + strings.Join(bcv.Currencies, ", ") + "."}
		}
		d, err := c.On(ctx, pos[0], currency)
		if err != nil {
			return nil, "", err
		}
		return onJSON(d), renderDay(d), nil
	case "convert":
		var copts []bcv.ConvertOption
		n, ok, err := intOption(p.values, "decimals")
		if err != nil {
			return nil, "", err
		}
		if ok {
			copts = append(copts, bcv.Decimals(n))
		}
		if date, ok := p.values["date"]; ok {
			copts = append(copts, bcv.OnDate(date))
		}
		v, err := c.Convert(ctx, pos[0], pos[1], pos[2], copts...)
		if err != nil {
			return nil, "", err
		}
		return convertJSON(v), renderConversion(v), nil
	case "history":
		var hopts []bcv.HistoryOption
		n, ok, err := intOption(p.values, "days")
		if err != nil {
			return nil, "", err
		}
		if ok {
			hopts = append(hopts, bcv.Days(n))
		}
		start, hasStart := p.values["start"]
		end, hasEnd := p.values["end"]
		// "" leaves a side of bcv.Range open; on the command line it is an invalid date.
		for _, b := range []struct {
			label, value string
			given        bool
		}{{"start", start, hasStart}, {"end", end, hasEnd}} {
			if b.given && b.value == "" {
				return nil, "", &bcv.Error{Kind: bcv.ErrInvalidDate, Message: "Invalid " + b.label +
					` "": use a real calendar date in YYYY-MM-DD format, e.g. 2026-01-02.`}
			}
		}
		if hasStart || hasEnd {
			hopts = append(hopts, bcv.Range(start, end))
		}
		h, err := c.History(ctx, pos[0], hopts...)
		if err != nil {
			return nil, "", err
		}
		return historyJSON(h), renderHistory(h), nil
	default:
		s, err := c.Status(ctx)
		if err != nil {
			return nil, "", err
		}
		return statusJSON(s), renderStatus(s), nil
	}
}

// ------------------------------------------------------------------ text rendering

func num(value string, places int) string { return bcv.FormatNumber(value, places) }

func table(headers []string, rows [][]string, align string) string {
	widths := make([]int, len(headers))
	for i, h := range headers {
		widths[i] = len(h)
		for _, r := range rows {
			widths[i] = max(widths[i], len(r[i]))
		}
	}
	line := func(cells []string) string {
		parts := make([]string, len(cells))
		for i, c := range cells {
			pad := strings.Repeat(" ", widths[i]-len(c))
			if align[i] == 'r' {
				parts[i] = pad + c
			} else {
				parts[i] = c + pad
			}
		}
		return strings.TrimRight(strings.Join(parts, "  "), " ")
	}
	seps := make([]string, len(widths))
	for i, w := range widths {
		seps[i] = strings.Repeat("-", w)
	}
	out := []string{line(headers), strings.Join(seps, "  ")}
	for _, r := range rows {
		out = append(out, line(r))
	}
	return strings.Join(out, "\n")
}

// bare renders a two-column table without its header and separator lines.
func bare(rows [][]string) string {
	lines := strings.Split(table([]string{"", ""}, rows, "ll"), "\n")
	return strings.Join(lines[2:], "\n")
}

func utc(t time.Time) string {
	if t.IsZero() {
		return "unknown"
	}
	return t.UTC().Format("2006-01-02 15:04") + " UTC"
}

func rateRows(codes []string, rate func(string) string) [][]string {
	rows := make([][]string, len(codes))
	for i, c := range codes {
		rows[i] = []string{c, num(rate(c), 4)}
	}
	return rows
}

func renderRates(r *bcv.Rates) string {
	return strings.Join([]string{
		"Official BCV rates, effective " + r.EffectiveDate + " (Bs. per unit)",
		"",
		table([]string{"Currency", "Rate (VES)"}, rateRows(r.Currencies(), r.Rate), "lr"),
		"",
		"Updated " + utc(r.UpdatedAt) + ". " + attribution,
	}, "\n")
}

func renderDay(d *bcv.DayRate) string {
	out := []string{
		"BCV rate in effect on " + d.Date + " (effective date " + d.EffectiveDate + ", Bs. per unit)",
		"",
		table([]string{"Currency", "Rate (VES)"}, rateRows(d.Currencies(), d.Rate), "lr"),
	}
	if d.Note != "" {
		out = append(out, "", "Note: "+d.Note)
	}
	return strings.Join(append(out, "", attribution), "\n")
}

func renderConversion(c *bcv.Conversion) string {
	places := c.Decimals
	if places < 0 {
		places = 8
	}
	rows := [][]string{
		{"Amount", num(c.Amount, 2) + " " + c.From},
		{"Result", num(c.Result, places) + " " + c.To},
		{"Rate", "1 " + c.From + " = " + num(c.Rate, 6) + " " + c.To},
	}
	for _, code := range []string{c.From, c.To} {
		if v, ok := c.RatesUsed[code]; ok {
			rows = append(rows, []string{"BCV " + code, num(v, 4) + " VES"})
		}
	}
	rows = append(rows, []string{"Effective", c.EffectiveDate})
	out := []string{bare(rows)}
	if c.Note != "" {
		out = append(out, "", "Note: "+c.Note)
	}
	return strings.Join(append(out, "", attribution), "\n")
}

func renderHistory(h *bcv.History) string {
	rows := make([][]string, len(h.Points))
	carried := false
	for i, p := range h.Points {
		eff := p.EffectiveDate
		if p.CarriedForward {
			eff += " *"
			carried = true
		}
		rows[i] = []string{p.Date, eff, num(p.Rate, 4)}
	}
	sign := "+"
	if strings.HasPrefix(h.Change, "-") {
		sign = ""
	}
	out := []string{
		fmt.Sprintf("%s/VES official BCV rate, %s to %s (%d days)", h.Currency, h.Start, h.End, len(h.Points)),
		"",
		table([]string{"Date", "Effective", "Rate (VES)"}, rows, "llr"),
		"",
		fmt.Sprintf("First %s  Last %s  Change %s%s (%s%s%%)", num(h.First.Rate, 4), num(h.Last.Rate, 4),
			sign, num(h.Change, 4), sign, num(h.ChangePct, 2)),
		fmt.Sprintf("Min %s on %s  Max %s on %s", num(h.Min.Rate, 4), h.Min.Date, num(h.Max.Rate, 4), h.Max.Date),
	}
	if carried {
		out = append(out, "* rate carried forward from the effective date (weekend/holiday).")
	}
	if h.Note != "" {
		out = append(out, "Note: "+h.Note)
	}
	return strings.Join(append(out, attribution), "\n")
}

func renderStatus(s *bcv.Status) string {
	status := s.Status
	if s.Stale {
		status += " (STALE)"
	}
	updated, age := "unknown", "unknown"
	if raw, ok := s.Raw["updated_at"].(string); ok && !s.UpdatedAt.IsZero() {
		updated = raw
		age = strconv.FormatFloat(s.AgeHours, 'f', -1, 64) + " h"
	}
	eff := s.EffectiveDate
	if eff == "" {
		eff = "unknown"
	}
	return bare([][]string{
		{"Status", status},
		{"Updated", updated},
		{"Age", age},
		{"Effective date", eff},
		{"Currencies", strings.Join(s.SupportedCurrencies, ", ")},
	})
}

// ------------------------------------------------------------------ JSON (same shape as the JavaScript CLI)

type field struct {
	key   string
	value any
}

// object is a JSON object that keeps its key order.
type object []field

func (o object) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, f := range o {
		if i > 0 {
			b.WriteByte(',')
		}
		k, err := marshal(f.key, false)
		if err != nil {
			return nil, err
		}
		v, err := marshal(f.value, false)
		if err != nil {
			return nil, err
		}
		b.Write(k)
		b.WriteByte(':')
		b.Write(v)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

func marshal(v any, indent bool) ([]byte, error) {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if indent {
		enc.SetIndent("", "  ")
	}
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(b.Bytes(), "\n"), nil
}

// number is a decimal string as a JSON number (float64, like the other CLIs).
func number(s string) any {
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil
	}
	return f
}

func rateObject(rates map[string]string) object {
	out := object{}
	for _, c := range bcv.Currencies {
		if v, ok := rates[c]; ok {
			out = append(out, field{c, number(v)})
		}
	}
	return out
}

// stamp is the timestamp as published when it parsed, else null.
func stamp(raw map[string]any, key string, parsed time.Time) any {
	if parsed.IsZero() {
		return nil
	}
	if s, ok := raw[key].(string); ok {
		return s
	}
	return parsed.Format(time.RFC3339Nano)
}

func withNote(o object, note string) object {
	if note != "" {
		return append(o, field{"note", note})
	}
	return o
}

func latestJSON(r *bcv.Rates) object {
	return object{
		{"rates", rateObject(r.Rates)},
		{"date", r.Date},
		{"effective_date", r.EffectiveDate},
		{"updated_at", stamp(r.Raw, "updated_at", r.UpdatedAt)},
		{"unit", bcv.Unit},
		{"source", bcv.Source},
	}
}

func onJSON(d *bcv.DayRate) object {
	return withNote(object{
		{"date", d.Date},
		{"effective_date", d.EffectiveDate},
		{"carried_forward", d.CarriedForward},
		{"rates", rateObject(d.Rates)},
		{"updated_at", stamp(d.Raw, "updated_at", d.UpdatedAt)},
		{"unit", bcv.Unit},
		{"source", bcv.Source},
	}, d.Note)
}

func historyJSON(h *bcv.History) object {
	point := func(p bcv.HistoryPoint) object { return object{{"date", p.Date}, {"rate", number(p.Rate)}} }
	series := make([]object, len(h.Points))
	for i, p := range h.Points {
		series[i] = object{{"date", p.Date}, {"effective_date", p.EffectiveDate}, {"rate", number(p.Rate)}}
	}
	return withNote(object{
		{"currency", h.Currency},
		{"from", h.Start},
		{"to", h.End},
		{"points", len(h.Points)},
		{"first", point(h.First)},
		{"last", point(h.Last)},
		{"min", point(h.Min)},
		{"max", point(h.Max)},
		{"change", number(h.Change)},
		{"change_pct", number(h.ChangePct)},
		{"series", series},
		{"unit", bcv.Unit},
		{"source", bcv.Source},
	}, h.Note)
}

func convertJSON(c *bcv.Conversion) object {
	used := object{}
	for _, code := range []string{c.From, c.To} {
		if v, ok := c.RatesUsed[code]; ok {
			used = append(used, field{code, number(v)})
		}
	}
	return withNote(object{
		{"amount", number(c.Amount)},
		{"from", c.From},
		{"to", c.To},
		{"result", number(c.Result)},
		{"result_text", c.Result},
		{"result_exact", c.ResultExact},
		{"rate", number(c.Rate)},
		{"rates_used", used},
		{"date", c.Date},
		{"effective_date", c.EffectiveDate},
		{"carried_forward", c.CarriedForward},
		{"source", bcv.Source},
	}, c.Note)
}

func statusJSON(s *bcv.Status) object {
	nullable := func(v string) any {
		if v == "" {
			return nil
		}
		return v
	}
	var age any
	if !s.UpdatedAt.IsZero() {
		age = s.AgeHours
	}
	currencies := object{}
	seen := map[string]bool{}
	for _, c := range append(append([]string{}, s.SupportedCurrencies...), bcv.Currencies...) {
		if v, ok := s.Currencies[c]; ok && !seen[c] {
			currencies = append(currencies, field{c, v})
			seen[c] = true
		}
	}
	var rest []string
	for c := range s.Currencies {
		if !seen[c] {
			rest = append(rest, c)
		}
	}
	sort.Strings(rest)
	for _, c := range rest {
		currencies = append(currencies, field{c, s.Currencies[c]})
	}
	return object{
		{"status", s.Status},
		{"updated_at", stamp(s.Raw, "updated_at", s.UpdatedAt)},
		{"generated_at", stamp(s.Raw, "generated_at", s.GeneratedAt)},
		{"date", nullable(s.Date)},
		{"effective_date", nullable(s.EffectiveDate)},
		{"age_hours", age},
		{"stale", s.Stale},
		{"supported_currencies", s.SupportedCurrencies},
		{"currencies", currencies},
		{"timezone", nullable(s.Timezone)},
		{"api_version", nullable(s.APIVersion)},
		{"source", bcv.Source},
	}
}
