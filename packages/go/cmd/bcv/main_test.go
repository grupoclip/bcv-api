package main

// Same scenarios as packages/python/tests/test_cli.py and
// packages/js/test/unit/cli.test.mjs, against the shared fixtures.

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	bcv "github.com/grupoclip/bcv-api/packages/go"
)

var fixturesDir = filepath.Join("..", "..", "..", "python", "tests", "fixtures")

// fixtureServer serves the recorded samples; overrides map /api/v1-relative paths to a status code.
func fixtureServer(t *testing.T, overrides map[string]int) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rel, ok := strings.CutPrefix(path.Clean(r.URL.Path), "/api/v1/")
		if code, hit := overrides[rel]; ok && hit {
			w.WriteHeader(code)
			return
		}
		body, err := os.ReadFile(filepath.Join(fixturesDir, filepath.FromSlash(rel)))
		if !ok || err != nil {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(body)
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

type result struct {
	code           int
	stdout, stderr string
}

func runCLI(t *testing.T, overrides map[string]int, args ...string) result {
	t.Helper()
	base := fixtureServer(t, overrides)
	var out, errb bytes.Buffer
	clock := bcv.WithClock(func() time.Time { return time.Date(2026, 11, 18, 15, 0, 0, 0, time.UTC) })
	code := run(context.Background(), append([]string{"--base-url", base}, args...), &out, &errb, clock)
	return result{code, out.String(), errb.String()}
}

func decode(t *testing.T, s string) map[string]any {
	t.Helper()
	var v map[string]any
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		t.Fatalf("invalid JSON %q: %v", s, err)
	}
	return v
}

func eq(t *testing.T, label string, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s: got %#v, want %#v", label, got, want)
	}
}

func ok(t *testing.T, r result) {
	t.Helper()
	if r.code != exitOK || r.stderr != "" {
		t.Fatalf("exit %d, stderr %q", r.code, r.stderr)
	}
}

func TestLatestTable(t *testing.T) {
	r := runCLI(t, nil, "latest")
	ok(t, r)
	eq(t, "stdout", r.stdout, `Official BCV rates, effective 2026-11-18 (Bs. per unit)

Currency  Rate (VES)
--------  ----------
USD         916.6477
EUR       1,007.3867
CNY         137.5233
TRY          18.2102
RUB          11.1719

Updated 2026-11-18 02:01 UTC. Source: Banco Central de Venezuela via BCV Today (https://bcv.today). Unofficial.
`)
}

func TestLatestJSON(t *testing.T) {
	r := runCLI(t, nil, "latest", "--json")
	ok(t, r)
	if !strings.HasPrefix(r.stdout, "{\n  \"rates\": {\n    \"USD\": 916.6477,\n    \"EUR\": 1007.38665582,") {
		t.Errorf("key order / indentation: %s", r.stdout)
	}
	j := decode(t, r.stdout)
	eq(t, "USD", j["rates"].(map[string]any)["USD"], 916.6477)
	eq(t, "effective_date", j["effective_date"], "2026-11-18")
	eq(t, "updated_at", j["updated_at"], "2026-11-18T02:01:03.699523+00:00")
	eq(t, "unit", j["unit"], bcv.Unit)
	eq(t, "source", j["source"], bcv.Source)
}

func TestJSONFlagBeforeCommand(t *testing.T) {
	r := runCLI(t, nil, "--json", "status")
	ok(t, r)
	j := decode(t, r.stdout)
	eq(t, "status", j["status"], "ok")
	eq(t, "updated_at", j["updated_at"], "2026-11-18T02:01:03.699523+00:00")
	eq(t, "age_hours", j["age_hours"], 13.0)
	eq(t, "stale", j["stale"], false)
	eq(t, "supported_currencies", j["supported_currencies"], []any{"USD", "EUR", "CNY", "TRY", "RUB"})
}

func TestStatusText(t *testing.T) {
	r := runCLI(t, nil, "status")
	ok(t, r)
	eq(t, "stdout", r.stdout, `Status          ok
Updated         2026-11-18T02:01:03.699523+00:00
Age             13 h
Effective date  2026-11-18
Currencies      USD, EUR, CNY, TRY, RUB
`)
}

func TestOnWithCurrency(t *testing.T) {
	r := runCLI(t, nil, "on", "2026-01-04", "--currency", "USD")
	ok(t, r)
	eq(t, "stdout", r.stdout, `BCV rate in effect on 2026-01-04 (effective date 2026-01-03, Bs. per unit)

Currency  Rate (VES)
--------  ----------
USD         304.6796

Note: 2026-01-04 (Sunday) uses the rate with effective date 2026-01-03 (Saturday): a published BCV rate stays in effect until the next publication (weekends and holidays carry it forward).

Source: Banco Central de Venezuela via BCV Today (https://bcv.today). Unofficial.
`)
}

func TestOnJSON(t *testing.T) {
	r := runCLI(t, nil, "on", "2026-01-04", "-c", "eur", "--json")
	ok(t, r)
	j := decode(t, r.stdout)
	eq(t, "carried_forward", j["carried_forward"], true)
	eq(t, "rates", j["rates"], map[string]any{"EUR": 357.8858})
	if !strings.Contains(j["note"].(string), "carry it forward") {
		t.Errorf("note: %v", j["note"])
	}
}

func TestConvertText(t *testing.T) {
	r := runCLI(t, nil, "convert", "100", "USD", "VES")
	ok(t, r)
	eq(t, "stdout", r.stdout, `Amount     100.00 USD
Result     91,664.77 VES
Rate       1 USD = 916.647700 VES
BCV USD    916.6477 VES
Effective  2026-11-18

Source: Banco Central de Venezuela via BCV Today (https://bcv.today). Unofficial.
`)
}

func TestConvertCrossRateText(t *testing.T) {
	r := runCLI(t, nil, "convert", "50", "eur", "usd", "--decimals=4")
	ok(t, r)
	for _, line := range []string{"Result     54.9495 USD", "Rate       1 EUR = 1.098990 USD", "BCV EUR    1,007.3867 VES", "BCV USD    916.6477 VES"} {
		if !strings.Contains(r.stdout, line+"\n") {
			t.Errorf("missing %q in\n%s", line, r.stdout)
		}
	}
}

func TestConvertJSONWithDateAndDecimals(t *testing.T) {
	r := runCLI(t, nil, "convert", "10", "usd", "ves", "--date", "2026-01-04", "--decimals", "1", "--json")
	ok(t, r)
	j := decode(t, r.stdout)
	eq(t, "result", j["result"], 3046.8)
	eq(t, "result_text", j["result_text"], "3046.8")
	eq(t, "result_exact", j["result_exact"], "3046.796")
	eq(t, "effective_date", j["effective_date"], "2026-01-03")
	eq(t, "carried_forward", j["carried_forward"], true)
	eq(t, "rates_used", j["rates_used"], map[string]any{"USD": 304.6796})
	if !strings.Contains(j["note"].(string), "carry it forward") {
		t.Errorf("note: %v", j["note"])
	}
}

func TestConvertJSONDefaultDecimals(t *testing.T) {
	r := runCLI(t, nil, "convert", "10", "USD", "VES", "-d", "2026-01-04", "--json")
	ok(t, r)
	j := decode(t, r.stdout)
	eq(t, "result", j["result"], 3046.8)
	eq(t, "result_text", j["result_text"], "3046.80")
}

func TestHistory(t *testing.T) {
	r := runCLI(t, nil, "history", "USD", "--days", "7")
	ok(t, r)
	lines := strings.Split(r.stdout, "\n")
	eq(t, "first line", lines[0], "USD/VES official BCV rate, 2026-11-12 to 2026-11-18 (7 days)")
	for _, s := range []string{"2026-11-18", "Min ", "Change "} {
		if !strings.Contains(r.stdout, s) {
			t.Errorf("missing %q", s)
		}
	}
}

func TestHistoryRangeMarksCarryForward(t *testing.T) {
	r := runCLI(t, nil, "history", "EUR", "--start", "2026-01-01", "--end", "2026-01-06")
	ok(t, r)
	eq(t, "stdout", r.stdout, `EUR/VES official BCV rate, 2026-01-01 to 2026-01-06 (6 days)

Date        Effective     Rate (VES)
----------  ------------  ----------
2026-01-01  2026-01-01      354.4935
2026-01-02  2026-01-01 *    354.4935
2026-01-03  2026-01-03      357.8858
2026-01-04  2026-01-03 *    357.8858
2026-01-05  2026-01-03 *    357.8858
2026-01-06  2026-01-06      360.5039

First 354.4935  Last 360.5039  Change +6.0104 (+1.70%)
Min 354.4935 on 2026-01-01  Max 360.5039 on 2026-01-06
* rate carried forward from the effective date (weekend/holiday).
Source: Banco Central de Venezuela via BCV Today (https://bcv.today). Unofficial.
`)
}

func TestHistoryJSON(t *testing.T) {
	r := runCLI(t, nil, "history", "EUR", "--start", "2026-01-01", "--end", "2026-01-06", "--json")
	ok(t, r)
	j := decode(t, r.stdout)
	eq(t, "points", j["points"], 6.0)
	eq(t, "from", j["from"], "2026-01-01")
	eq(t, "to", j["to"], "2026-01-06")
	eq(t, "change", j["change"], 6.0104)
	eq(t, "change_pct", j["change_pct"], 1.6955)
	eq(t, "series[1]", j["series"].([]any)[1], map[string]any{"date": "2026-01-02", "effective_date": "2026-01-01", "rate": 354.4935})
	eq(t, "min", j["min"], map[string]any{"date": "2026-01-01", "rate": 354.4935})
	if _, has := j["note"]; has {
		t.Error("no note expected")
	}
	n := decode(t, runCLI(t, nil, "history", "USD", "-n", "3", "--json").stdout)
	eq(t, "points", n["points"], 3.0)
}

func TestErrorExitCodes(t *testing.T) {
	for _, tc := range []struct {
		args     []string
		code     int
		fragment string
	}{
		{[]string{"on", "2026-13-01"}, exitUsage, "Invalid date"},
		{[]string{"on", "2026-02-30"}, exitUsage, "Invalid date"},
		{[]string{"convert", "100", "USD", "GBP"}, exitUsage, "Unsupported currency"},
		{[]string{"convert", "-5", "USD", "VES"}, exitUsage, "zero or positive"},
		{[]string{"convert", "abc", "USD", "VES"}, exitUsage, "expected a number"},
		{[]string{"convert", "1", "USD", "VES", "--decimals", "13"}, exitUsage, "Invalid decimals 13"},
		{[]string{"history", "USD", "--days", "0"}, exitUsage, "Invalid days 0"},
		{[]string{"history", "USD", "--start", ""}, exitUsage, `Invalid start ""`},
		{[]string{"on", "2026-01-06", "-c", ""}, exitUsage, `Unsupported currency ""`},
		{[]string{"on", "2020-01-01"}, exitNoData, "snapshots start on 2021-08-02"},
		{[]string{"on", "2030-01-01"}, exitNoData, "in the future"},
		{[]string{"on", "2021-08-02", "--currency", "EUR"}, exitNoData, "No EUR rate"},
		{[]string{"history", "USD", "--start", "2024-01-01", "--end", "2024-01-31"}, exitNoData, "No USD rates between"},
	} {
		t.Run(strings.Join(tc.args, " "), func(t *testing.T) {
			r := runCLI(t, nil, tc.args...)
			eq(t, "exit code", r.code, tc.code)
			if !strings.HasPrefix(r.stderr, "bcv: error: ") || !strings.Contains(r.stderr, tc.fragment) {
				t.Errorf("stderr %q", r.stderr)
			}
			eq(t, "stdout", r.stdout, "")
		})
	}
}

func TestJSONErrors(t *testing.T) {
	r := runCLI(t, nil, "convert", "-5", "USD", "VES", "--json")
	eq(t, "exit", r.code, exitUsage)
	eq(t, "stdout", r.stdout, `{"error":{"type":"InvalidAmount","message":"Invalid amount \"-5\": it must be zero or positive."}}`+"\n")
	n := runCLI(t, nil, "on", "2021-08-02", "-c", "EUR", "--json")
	eq(t, "exit", n.code, exitNoData)
	eq(t, "type", decode(t, n.stdout)["error"].(map[string]any)["type"], "CurrencyNotAvailable")
}

func TestUpstreamExitCode(t *testing.T) {
	r := runCLI(t, map[string]int{"rate.json": 502}, "latest", "--json")
	eq(t, "exit", r.code, exitUpstream)
	eq(t, "type", decode(t, r.stdout)["error"].(map[string]any)["type"], "UpstreamError")
	if !strings.Contains(r.stderr, "HTTP 502") {
		t.Errorf("stderr %q", r.stderr)
	}
	var out, errb bytes.Buffer
	code := run(context.Background(), []string{"--base-url", "http://127.0.0.1:9", "--timeout", "2", "latest"}, &out, &errb)
	eq(t, "unreachable exit", code, exitUpstream)
}

func TestUsageErrors(t *testing.T) {
	for _, args := range [][]string{
		{"convert", "1", "USD"},
		{"latest", "--currency", "USD"},
		{"nope"},
		{},
		{"--bogus"},
		{"-x", "latest"},
		{"history", "USD", "--days", "x"},
		{"history", "USD", "--days"},
		{"latest", "--json=yes"},
		{"latest", "--timeout", "abc"},
		{"latest", "--timeout", "-1"},
		{"--base-url", "file:///etc", "latest"},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			var out, errb bytes.Buffer
			code := run(context.Background(), args, &out, &errb)
			eq(t, "exit", code, exitUsage)
			if !strings.Contains(errb.String(), "bcv: error: ") {
				t.Errorf("stderr %q", errb.String())
			}
		})
	}
}

func TestVersionAndHelp(t *testing.T) {
	var out, errb bytes.Buffer
	eq(t, "version exit", run(context.Background(), []string{"--version"}, &out, &errb), exitOK)
	eq(t, "version", out.String(), "bcv "+bcv.Version+"\n")
	out.Reset()
	eq(t, "-v exit", run(context.Background(), []string{"-v"}, &out, &errb), exitOK)
	eq(t, "-v", out.String(), "bcv "+bcv.Version+"\n")
	out.Reset()
	eq(t, "help exit", run(context.Background(), []string{"latest", "-h"}, &out, &errb), exitOK)
	if !strings.Contains(out.String(), "not affiliated") || !strings.Contains(out.String(), "Exit codes: 0 ok") {
		t.Errorf("help: %s", out.String())
	}
}
