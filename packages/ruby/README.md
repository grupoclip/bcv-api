# bcv

[![Gem Version](https://img.shields.io/gem/v/bcv)](https://rubygems.org/gems/bcv)

Official Ruby client for the [BCV Today API](https://bcv.today/api/): the exchange rates published by Banco Central de
Venezuela (BCV) for USD, EUR, CNY, TRY and RUB against the bolivar (VES).

> **Unofficial, not affiliated with Banco Central de Venezuela.** BCV Today republishes the rates that BCV publishes on
> its website. Data: [CC BY 4.0](https://bcv.today/licencia/), attribution "BCV Today (https://bcv.today), data from
> Banco Central de Venezuela".

- Ruby 3.1+, zero runtime dependencies (Net::HTTP and JSON from the standard library; no bigdecimal).
- Exact decimal conversions on Ruby integers, returned as strings (`"91664.77"`), rounded half-up.
- Weekend and holiday carry-forward, with the same rules and messages as the Python, JavaScript and PHP clients and
  the BCV Today MCP server.
- Immutable result objects (`Data` on Ruby 3.2+), typed errors, a thread-safe in-memory cache (or `Rails.cache`) and a
  `bcv` command.

```bash
gem install bcv        # or: bundle add bcv
```

## Usage

```ruby
require "bcv"

bcv = BCV::Client.new

latest = bcv.latest
latest.rate("USD")          # => "916.6477" (bolivars per dollar)
latest.rates                # => {"USD" => "916.6477", "EUR" => "1007.38665582", ...}
latest.effective_date       # => #<Date: 2026-11-18> (official BCV value date)

sunday = bcv.on("2026-01-04", "USD")
sunday.effective_date       # => #<Date: 2026-01-03>: the Saturday rate stays in effect
sunday.carried_forward?     # => true
sunday.rate                 # => "304.6796"
sunday.note                 # => "2026-01-04 (Sunday) uses the rate with effective date 2026-01-03 (Saturday): ..."

c = bcv.convert("100", "USD", "VES")
c.result                    # => "91664.77" (exactly `decimals` places)
c.result_exact              # unrounded exact decimal string
c.rate                      # => "916.6477"
c.to_s                      # => "100.00 USD = 91,664.77 VES at the official BCV rate (effective 2026-11-18; ...)."

h = bcv.history("EUR", days: 30)      # or start: "2026-01-01", end: "2026-01-31"
h.min; h.max; h.first; h.last; h.change; h.change_pct
h.each { |point| point.date; point.rate; point.carried_forward? }

s = bcv.status
s.stale?                    # => true if no capture for more than 96 h

# Module-level shortcuts use a shared default client:
BCV.latest.rate("EUR")
BCV.convert(50, "EUR", "USD", date: "2026-01-04")
```

### API

| Method | Returns | Notes |
| --- | --- | --- |
| `BCV::Client.new(base_url:, timeout:, cache_ttl:, user_agent:, http:, clock:, cache:)` | client | Defaults: `https://bcv.today`, 10 s, 300 s cache (0 disables), in-memory cache, Net::HTTP. |
| `latest` | `BCV::Rates` | Rates currently in effect (`/api/v1/rate.json`). `rate("USD")` returns one rate or `nil`. |
| `on(date, currency = nil)` | `BCV::DayRate` | `date` is `"YYYY-MM-DD"`, a `Date` or a `Time`. From 2021-08-02 up to tomorrow in Caracas. |
| `history(currency, days: 30)` / `history(currency, start:, end:)` | `BCV::History` | Last N days (1 to 1830) or an inclusive range, oldest first, with `min`, `max`, `first`, `last`, `change`, `change_pct`. Ranges are clipped to `history.json` and `note` says so. Enumerable. |
| `convert(amount, from, to, date: nil, decimals: 2)` | `BCV::Conversion` | Between VES, USD, EUR, CNY, TRY and RUB. Cross rates go through the bolivar. |
| `status` | `BCV::Status` | Data freshness. |
| `clear_cache` | `nil` | Forget responses held by the built-in in-memory cache. |

`BCV.latest`, `BCV.on`, `BCV.history`, `BCV.convert` and `BCV.status` call a default client; replace it with
`BCV.client = BCV::Client.new(...)`.

Results are frozen value objects (`Data.define` on Ruby 3.2+, a frozen `Struct` on Ruby 3.1). Calendar days are `Date`
objects, timestamps (`updated_at`, `generated_at`) are UTC `Time`s, and rates and amounts are decimal strings, so no
precision is lost to floats. Every result has an English `summary` (also its `to_s`), the attribution `source` and an
`as_json` / `to_json` with the same shape as the CLI's `--json` output. Currency codes are case-insensitive and may be
symbols (`:usd`); `"VEF"` is accepted as `"VES"`.

### Exact decimals and rounding

`convert` never uses binary floating point for money: rates are read from their shortest decimal form, amounts can be
strings (`"1234.56"`, `"1_000"`, `"1e3"`), integers, floats (a float is taken from its shortest decimal form, so `0.1` is
exactly `0.1`) or a `BigDecimal` if your app already uses one. The product is exact and divisions keep 28 significant
digits, the same as Python's `decimal` module, so the digits match the Python, JavaScript and PHP clients. `result` is
then rounded **half-up** (`0.125` -> `0.13`) to `decimals` places (default 2, 0 to 12; `nil` keeps full precision). The
arithmetic runs on Ruby's arbitrary-precision integers: the bigdecimal gem is not needed.

### Errors

```text
BCV::Error (StandardError)
├── BCV::InvalidArgument
│   ├── BCV::InvalidDate          bad date, not a real calendar day, bad range or days
│   ├── BCV::InvalidCurrency      unknown currency code, or from == to
│   └── BCV::InvalidAmount        negative, non-finite or > 1e15 amount; bad decimals
├── BCV::DateOutOfRange           before 2021-08-02, in the future, not published yet, outside history.json
├── BCV::CurrencyNotAvailable     valid code, but no rate that day
├── BCV::NotFound                 HTTP 404
└── BCV::UpstreamError            network failure, timeout, HTTP error or invalid JSON (#status holds the HTTP code)
```

Invalid arguments are rejected before any request is made.

### Caching

Responses are cached for `cache_ttl` seconds (default 300; BCV publishes a few times per business day) in a
per-client, thread-safe in-memory cache. To share it across processes, pass any store with `read(key)` and
`write(key, value, expires_in:)`, such as `Rails.cache` (the raw JSON bodies are stored):

```ruby
# config/initializers/bcv.rb
BCV.client = BCV::Client.new(cache: Rails.cache, cache_ttl: 600)
```

There is no Railtie: the gem does not depend on Rails and needs no configuration beyond that initializer.

### HTTP

The client sends `User-Agent: bcv-ruby/<version> (+https://bcv.today)` and `Accept: application/json` through
Net::HTTP (gzip is handled by Net::HTTP). To use your own HTTP stack (or a fake in tests), pass a callable:

```ruby
http = ->(url, headers, timeout) do
  r = Faraday.get(url, nil, headers) { |req| req.options.timeout = timeout }
  BCV::Response.new(status: r.status, body: r.body)
end
bcv = BCV::Client.new(http: http)
```

Return non-2xx responses as a `BCV::Response` (or a `[status, body]` pair); any `StandardError` raised by the callable
becomes a `BCV::UpstreamError` (the original is its `cause`).

## Command line

```console
$ bcv latest
$ bcv on 2026-01-04 --currency USD
$ bcv convert 100 USD VES [--date 2026-01-04] [--decimals 2]
$ bcv history EUR --days 30          # or --start 2026-01-01 --end 2026-01-31
$ bcv status --json
```

Options: `--json`, `--base-url URL`, `--timeout SECONDS`, `-h/--help`, `-v/--version`. Exit codes, the same as the
Python `bcv` and JavaScript `bcv-today` commands: 0 ok, 1 no data for the request, 2 invalid arguments, 3 network/API
error.

## Development

```bash
cd packages/ruby
BUNDLE_PATH=vendor/bundle bundle install
bundle exec rake            # RuboCop + Minitest (offline, on packages/python/tests/fixtures)
BCV_LIVE=1 bundle exec rake test   # also run the live tests against https://bcv.today
gem build bcv.gemspec
```

Development dependencies are pinned to exact versions in the `Gemfile`; no `Gemfile.lock` is committed.

## MCP

For AI assistants, connect to the remote BCV Today MCP server instead: `https://mcp.bcv.today/mcp`
(Streamable HTTP, no authentication, nothing to install).

## En español

`bcv` es la gema oficial de Ruby para la [API de BCV Today](https://bcv.today/api/): las tasas de cambio oficiales del
Banco Central de Venezuela (USD, EUR, CNY, TRY y RUB contra el bolívar). **Proyecto no oficial, no afiliado al Banco
Central de Venezuela.** Datos bajo [CC BY 4.0](https://bcv.today/licencia/).

```ruby
require "bcv"

BCV.latest.rate("USD")                          # bolívares por dólar
BCV.on("2026-01-04", "USD").effective_date      # domingo: rige la tasa con fecha valor 2026-01-03
BCV.convert("100", "USD", "VES").result         # "91664.77"
```

Las conversiones usan aritmética decimal exacta con enteros de Ruby (sin bigdecimal) y, por defecto, redondean a 2
decimales con la mitad hacia arriba (0,005 → 0,01). En Rails basta con un inicializador:
`BCV.client = BCV::Client.new(cache: Rails.cache)`. También incluye el comando `bcv` (`bcv convert 100 USD VES`).
Más integraciones (Python, JavaScript, PHP, Odoo, MCP, A2A): https://bcv.today/integraciones/

## Links

- API docs: https://bcv.today/api/ · OpenAPI: https://bcv.today/openapi.json · llms.txt: https://bcv.today/llms.txt
- Python library: https://pypi.org/project/bcv/ · JavaScript library: https://www.npmjs.com/package/bcv-today ·
  PHP library: https://packagist.org/packages/grupoclip/bcv-today
- Source: https://github.com/grupoclip/bcv-api/tree/main/packages/ruby · Issues: https://github.com/grupoclip/bcv-api/issues

## License

Code: Apache-2.0. Data: CC BY 4.0, BCV Today, from Banco Central de Venezuela.
