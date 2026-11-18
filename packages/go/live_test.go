package bcv_test

import (
	"context"
	"errors"
	"os"
	"regexp"
	"testing"
	"time"

	bcv "github.com/grupoclip/bcv-api/packages/go"
)

// TestLive calls the real API at https://bcv.today. Opt in with BCV_LIVE=1
// (BCV_BASE_URL overrides the origin).
func TestLive(t *testing.T) {
	if os.Getenv("BCV_LIVE") != "1" {
		t.Skip("live API test; set BCV_LIVE=1 to run")
	}
	opts := []bcv.Option{bcv.WithTimeout(20 * time.Second)}
	if base := os.Getenv("BCV_BASE_URL"); base != "" {
		opts = append(opts, bcv.WithBaseURL(base))
	}
	c := bcv.New(opts...)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	isDate := regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`).MatchString
	isDecimal := regexp.MustCompile(`^\d+(\.\d+)?$`).MatchString

	r, err := c.Latest(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !isDecimal(r.Rate("USD")) || r.Float("USD") <= 0 || !isDate(r.EffectiveDate) {
		t.Fatalf("latest: %+v", r)
	}

	d, err := c.On(ctx, "2026-01-04", "USD")
	if err != nil {
		t.Fatal(err)
	}
	if d.EffectiveDate != "2026-01-03" || !d.CarriedForward || d.Note == "" {
		t.Fatalf("on: %+v", d)
	}

	v, err := c.Convert(ctx, "100", "USD", "VES")
	if err != nil {
		t.Fatal(err)
	}
	if v.Rate != r.Rate("USD") || !isDecimal(v.Result) {
		t.Fatalf("convert: %+v", v)
	}

	h, err := c.History(ctx, "EUR", bcv.Days(10))
	if err != nil {
		t.Fatal(err)
	}
	if len(h.Points) == 0 || h.End < h.Start {
		t.Fatalf("history: %+v", h)
	}

	s, err := c.Status(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if s.Status != "ok" || len(s.SupportedCurrencies) == 0 {
		t.Fatalf("status: %+v", s)
	}

	if _, err := c.On(ctx, "2020-01-01", ""); !errors.Is(err, bcv.ErrDateOutOfRange) {
		t.Fatalf("expected ErrDateOutOfRange, got %v", err)
	}
}
