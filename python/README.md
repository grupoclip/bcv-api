# bcv: Python client for the BCV Today API

> **Unofficial: not affiliated with Banco Central de Venezuela.**
> This package is the official client of [BCV Today](https://bcv.today), an
> independent project that republishes the exchange rates posted by Banco
> Central de Venezuela (BCV). Despite the short package name `bcv`, it is **not**
> made, endorsed or operated by the bank. For legal or accounting use, check the
> figures against [bcv.org.ve](https://www.bcv.org.ve/).

Official BCV exchange rates (bolivars per unit of USD, EUR, CNY, TRY and RUB)
from the free, read-only [BCV Today API](https://bcv.today/api/), with
conversions, history and a command-line tool.

- Zero runtime dependencies (standard library `urllib`), Python 3.9+, fully typed (`py.typed`).
- `Decimal` everywhere money is involved.
- In-memory TTL cache, clear exceptions, CLI with `--json` output.
- Optional extras: `bcv[pandas]` for DataFrames, `bcv[async]` for an async client (httpx).

## Install

```bash
pip install bcv
pip install "bcv[pandas]"   # History.to_pandas()
pip install "bcv[async]"    # AsyncBCV
```

## Quickstart

```python
from bcv import BCV

client = BCV()

rates = client.latest()
print(rates["USD"], rates.effective_date)  # Decimal('916.6477') 2026-11-18

day = client.on("2026-01-04", currency="USD")  # a Sunday
print(day.rate, day.effective_date, day.carried_forward)
# 304.6796 2026-01-03 True

conv = client.convert(100, "USD", "VES")
print(conv.result, conv.rate, conv.effective_date)

print(client.convert(50_000, "VES", "EUR", date="2026-01-06"))

hist = client.history("USD", days=30)  # or start="2026-01-01", end="2026-03-31"
print(hist.first.rate, hist.last.rate, hist.change_pct, hist.min.date, hist.max.date)
df = hist.to_pandas()  # needs bcv[pandas]

print(client.status().stale)
```

### Async

```python
import asyncio
from bcv import AsyncBCV


async def main() -> None:
    async with AsyncBCV() as client:
        print(await client.convert(100, "USD", "VES"))


asyncio.run(main())
```

## API

| Method | Returns | Endpoint |
| --- | --- | --- |
| `BCV(base_url="https://bcv.today", timeout=10, cache_ttl=300, user_agent=None)` | client | |
| `.latest()` | `Rates` (`rates`, `date`, `effective_date`, `updated_at`, `source`) | `/api/v1/rate.json` |
| `.on(date, currency=None)` | `DayRate` (`date`, `effective_date`, `carried_forward`, `note`, `rates`, `.rate`) | `/api/v1/history/{date}.json` |
| `.history(currency, days=30, *, start=None, end=None)` | `History` (`points`, `first`, `last`, `min`, `max`, `change`, `change_pct`, `note`, `.to_list()`, `.to_pandas()`) | `/api/v1/history.json` |
| `.convert(amount, from_, to, date=None, *, decimals=2)` | `Conversion` (`result`, `result_exact`, `rate`, `rates_used`, `effective_date`, `carried_forward`) | rate.json or the day snapshot |
| `.status()` | `Status` (`status`, `updated_at`, `age_hours`, `stale`, `supported_currencies`) | `/api/v1/status.json` |

Dates accept `datetime.date`, `datetime.datetime` or `"YYYY-MM-DD"`. Currency
codes are case-insensitive. `Rates`/`DayRate` support `rates["USD"]`,
`rates.get("EUR")` and `rates.usd` (`try_` for the Turkish lira). Every result
has `to_dict()` (JSON-ready) and a readable `str()`.

### Exceptions

```
BCVError
├── InvalidArgument (ValueError)
│   ├── InvalidDate          malformed date, or start after end
│   ├── InvalidCurrency      unknown code, or from == to
│   └── InvalidAmount        negative, non-finite, > 1e15
├── DateOutOfRange           before 2021-08-02, after tomorrow (Caracas), not published yet
├── CurrencyNotAvailable     no rate for that currency on that day
├── NotFound                 HTTP 404
├── UpstreamError            network error, HTTP error, invalid JSON (.status)
└── MissingDependency        extra not installed (ImportError)
```

## Command line

```console
$ bcv latest
Official BCV rates, effective 2026-11-18 (Bs. per unit)

Currency  Rate (VES)
--------  ----------
USD         916.6477
EUR       1,007.3867
CNY         137.5233
TRY          18.2102
RUB          11.1719

$ bcv on 2026-01-04 --currency USD
$ bcv convert 100 USD VES [--date 2026-01-04] [--decimals 2]
$ bcv history USD --days 7          # or --start 2026-01-01 --end 2026-01-31
$ bcv status
$ bcv latest --json                 # machine output on any command
```

`python -m bcv` works too. Exit codes: `0` success, `1` no data for the request
(date out of range, currency not available that day), `2` invalid arguments, `3`
network or API error. With `--json`, errors are also printed to stdout as
`{"error": {"type": ..., "message": ...}}`.

## How the data works

- **Value date and carry-forward.** `effective_date` is BCV's official validity
  date ("fecha valor"); `updated_at` is the UTC capture time. BCV does not publish
  on weekends and holidays, so the last published rate stays in effect:
  `on("2026-01-04")` (Sunday) returns the rate with `effective_date` 2026-01-03
  and `carried_forward=True`, plus a human `note`. BCV publishes the next business
  day's rate in the afternoon, so `effective_date` of `latest()` can be tomorrow.
- **Range.** Daily snapshots start on **2021-08-02**. Dates after tomorrow
  (Caracas time, UTC-4) raise `DateOutOfRange`. `history()` reads `history.json`,
  which keeps the latest 1830 daily entries; older single days are available
  through `on()`. Older entries may lack some currencies (EUR, CNY, TRY and RUB
  appear later than USD); those days raise `CurrencyNotAvailable` or are skipped
  in a history series.
- **Money math.** Rates are parsed from JSON directly into `Decimal`. Conversions
  go through the bolivar (`amount * VES_per_from / VES_per_to`) with 28
  significant digits; `result` is rounded to `decimals` places (default 2) with
  ROUND_HALF_UP, and `result_exact` keeps the unrounded value. `rate` is the
  unrounded cross rate. Float amounts are converted with `str()`; pass `Decimal`
  or a string for exact input.
- **Caching.** Each client keeps responses in memory for `cache_ttl` seconds
  (default 300; `0` disables). Call `client.clear_cache()` to force a refresh. The
  data changes a few times per business day at most, and the API is served from a
  CDN, so there is no need to poll more often than every few minutes.
- **User-Agent.** Requests send `bcv-python/<version> (+https://bcv.today)`.

## Attribution and license

Code: Apache-2.0 (see `LICENSE`). Data: CC BY 4.0, see
[bcv.today/licencia](https://bcv.today/licencia/). When you display the rates,
credit the source, for example:

> Rates: Banco Central de Venezuela, via [BCV Today](https://bcv.today).

## En español

`bcv` es el cliente Python oficial de la API de [BCV Today](https://bcv.today):
tasas oficiales del Banco Central de Venezuela (bolívares por USD, EUR, CNY, TRY y
RUB), sin dependencias y con línea de comandos. **Proyecto no oficial: no está
afiliado al Banco Central de Venezuela.**

```bash
pip install bcv
bcv latest
bcv convert 100 USD VES
bcv on 2026-01-04 --currency USD   # domingo: usa la tasa vigente con fecha valor 2026-01-03
```

`effective_date` es la fecha valor del BCV. Los fines de semana y feriados se
mantiene la última tasa publicada (`carried_forward=True`). Datos desde el
2021-08-02. Licencia de los datos: CC BY 4.0, cita la fuente "BCV Today".

## Links

- Website: https://bcv.today
- API documentation: https://bcv.today/api/
- Source and issues: https://github.com/grupoclip/bcv-api
