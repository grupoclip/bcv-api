// Command bcv prints the official Banco Central de Venezuela exchange rates from
// the BCV Today API (https://bcv.today). Unofficial client, not affiliated with
// the bank.
//
// Install:
//
//	go install github.com/grupoclip/bcv-api/packages/go/cmd/bcv@latest
//
// Usage:
//
//	bcv latest                              rates currently in effect
//	bcv on <date> [-c CUR]                  rate in effect on a date (YYYY-MM-DD)
//	bcv convert <amount> <from> <to>        convert an amount, e.g. "bcv convert 100 USD VES"
//	        [-d DATE] [--decimals N]
//	bcv history <currency> [-n DAYS]        daily series (last N days, default 30, max 1830)
//	        [--start DATE] [--end DATE]
//	bcv status                              data freshness
//
// Options: --json (machine-readable output), --base-url URL, --timeout SECONDS,
// -h/--help, -v/--version.
//
// Exit codes (the same as the Python and JavaScript CLIs): 0 ok, 1 no data for
// the request, 2 invalid arguments, 3 network/API error.
package main

import (
	"context"
	"os"
)

func main() {
	os.Exit(run(context.Background(), os.Args[1:], os.Stdout, os.Stderr))
}
