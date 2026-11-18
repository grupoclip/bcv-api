package bcv_test

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	bcv "github.com/grupoclip/bcv-api/packages/go"
)

// The examples run offline against the recorded API samples (newExampleClient),
// with "today" frozen at 2026-11-18 in Caracas. Real code uses bcv.New().

func Example() {
	c, done := newExampleClient() // real code: c := bcv.New()
	defer done()
	ctx := context.Background()

	v, err := c.Convert(ctx, "100", "USD", "VES")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(v.Result)
	fmt.Println(v)
	// Output:
	// 91664.77
	// 100.00 USD = 91,664.77 VES at the official BCV rate (effective 2026-11-18; 1 USD = 916.647700 VES).
}

func ExampleNew() {
	c := bcv.New(
		bcv.WithTimeout(5*time.Second),
		bcv.WithCacheTTL(0), // no cache
		bcv.WithUserAgent("my-app/1.0"),
	)
	fmt.Println(c.BaseURL())
	// Output: https://bcv.today
}

func ExampleClient_Latest() {
	c, done := newExampleClient()
	defer done()

	r, err := c.Latest(context.Background())
	if err != nil {
		log.Fatal(err)
	}
	for _, code := range r.Currencies() {
		fmt.Println(code, r.Rate(code))
	}
	fmt.Println("effective", r.EffectiveDate)
	// Output:
	// USD 916.6477
	// EUR 1007.38665582
	// CNY 137.52328442
	// TRY 18.21021713
	// RUB 11.17192733
	// effective 2026-11-18
}

func ExampleClient_On() {
	c, done := newExampleClient()
	defer done()

	// 2026-01-04 is a Sunday: the rate published for Saturday 2026-01-03 stays in effect.
	d, err := c.On(context.Background(), "2026-01-04", "USD")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(d.Rate("USD"), d.EffectiveDate, d.CarriedForward)
	fmt.Println(d.Note)
	// Output:
	// 304.6796 2026-01-03 true
	// 2026-01-04 (Sunday) uses the rate with effective date 2026-01-03 (Saturday): a published BCV rate stays in effect until the next publication (weekends and holidays carry it forward).
}

func ExampleClient_Convert() {
	c, done := newExampleClient()
	defer done()
	ctx := context.Background()

	v, err := c.Convert(ctx, "100", "EUR", "USD", bcv.Decimals(4))
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(v.Result, v.ResultExact)
	fmt.Println(v.RatesUsed["EUR"], v.RatesUsed["USD"])

	// The rate in effect on a past day, with the carry-forward explained.
	w, err := c.Convert(ctx, "10", "USD", "VES", bcv.OnDate("2026-01-04"))
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(w.Result, w.EffectiveDate, w.CarriedForward)
	// Output:
	// 109.8990 109.8989999996727205010169119
	// 1007.38665582 916.6477
	// 3046.80 2026-01-03 true
}

func ExampleClient_History() {
	c, done := newExampleClient()
	defer done()

	h, err := c.History(context.Background(), "EUR", bcv.Range("2026-01-01", "2026-01-06"))
	if err != nil {
		log.Fatal(err)
	}
	for _, p := range h.Points {
		fmt.Println(p.Date, p.EffectiveDate, p.Rate, p.CarriedForward)
	}
	fmt.Println(h.Change, h.ChangePct)
	fmt.Println(h)
	// Output:
	// 2026-01-01 2026-01-01 354.4935 false
	// 2026-01-02 2026-01-01 354.4935 true
	// 2026-01-03 2026-01-03 357.8858 false
	// 2026-01-04 2026-01-03 357.8858 true
	// 2026-01-05 2026-01-03 357.8858 true
	// 2026-01-06 2026-01-06 360.5039 false
	// 6.0104 1.6955
	// EUR/VES from 2026-01-01 to 2026-01-06 (6 days): 354.4935 -> 360.5039 (+1.70%). Min 354.4935 on 2026-01-01, max 360.5039 on 2026-01-06.
}

func ExampleClient_Status() {
	c, done := newExampleClient()
	defer done()

	s, err := c.Status(context.Background())
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(s.Status, s.AgeHours, s.Stale)
	fmt.Println(s)
	// Output:
	// ok 13 false
	// Status ok: last capture 2026-11-18T02:01:03.699523+00:00 (13 h ago), effective date 2026-11-18.
}

func ExampleError() {
	c, done := newExampleClient()
	defer done()

	_, err := c.On(context.Background(), "2020-01-01", "USD")
	fmt.Println(errors.Is(err, bcv.ErrDateOutOfRange))
	var e *bcv.Error
	if errors.As(err, &e) {
		fmt.Println(e.Type()+":", e.Message)
	}

	_, err = c.Convert(context.Background(), "-5", "USD", "VES")
	fmt.Println(errors.Is(err, bcv.ErrInvalidAmount), errors.Is(err, bcv.ErrInvalidArgument))
	// Output:
	// true
	// DateOutOfRange: No BCV data for 2020-01-01: daily snapshots start on 2021-08-02.
	// true true
}
