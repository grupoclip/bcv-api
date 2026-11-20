# grupoclip/bcv-today

[![Packagist Version](https://img.shields.io/packagist/v/grupoclip/bcv-today)](https://packagist.org/packages/grupoclip/bcv-today)
[![PHP Version](https://img.shields.io/packagist/dependency-v/grupoclip/bcv-today/php)](https://packagist.org/packages/grupoclip/bcv-today)

Official PHP client for the [BCV Today API](https://bcv.today/api/): the exchange rates published by Banco Central de
Venezuela (BCV) for USD, EUR, CNY, TRY and RUB against the bolivar (VES).

> **Unofficial, not affiliated with Banco Central de Venezuela.** BCV Today republishes the rates that BCV publishes on
> its website. Data: [CC BY 4.0](https://bcv.today/licencia/), attribution "BCV Today (https://bcv.today), data from
> Banco Central de Venezuela".

- PHP 8.1+ (tested on 8.1 to 8.6), zero runtime dependencies (no Guzzle, no bcmath): HTTP through ext-curl when it is loaded, PHP streams
  otherwise.
- Exact decimal conversions in pure PHP, returned as strings (`"91664.77"`), rounded half-up.
- Weekend and holiday carry-forward, the same rules and messages as the Python and JavaScript clients and the BCV Today
  MCP server.
- Immutable result objects, typed exceptions, a pluggable cache (any PSR-16 cache) and Laravel auto-discovery.

```bash
composer require grupoclip/bcv-today
```

## Usage

```php
use BcvToday\Bcv;

$bcv = new Bcv();

$latest = $bcv->latest();
$latest->rate('USD');        // "916.6477" (bolivars per dollar)
$latest->rates;              // ['USD' => '916.6477', 'EUR' => '1007.38665582', ...]
$latest->effectiveDate;      // "2026-11-18" (official BCV value date)

$sunday = $bcv->on('2026-01-04', 'USD');
$sunday->effectiveDate;      // "2026-01-03": the Saturday rate stays in effect
$sunday->carriedForward;     // true
$sunday->rate;               // "304.6796"
$sunday->note;               // "2026-01-04 (Sunday) uses the rate with effective date 2026-01-03 (Saturday): ..."

$c = $bcv->convert('100', 'USD', 'VES');
$c->result;                  // "91664.77" (exactly `decimals` places)
$c->resultExact;             // unrounded exact decimal string
$c->rate;                    // "916.6477"

$h = $bcv->history('EUR', days: 30);   // or start: '2026-01-01', end: '2026-01-31'
$h->min; $h->max; $h->first; $h->last; $h->change; $h->changePct;
foreach ($h as $point) { /* $point->date, $point->rate, $point->carriedForward */ }

$s = $bcv->status();
$s->stale;                   // true if no capture for more than 96 h
```

### API

| Method | Returns | Notes |
| --- | --- | --- |
| `new Bcv(baseUrl:, timeout:, cacheTtl:, cache:, httpClient:, userAgent:)` | client | Defaults: `https://bcv.today`, 10 s, 300 s cache (0 disables), in-memory cache, curl or streams. |
| `latest()` | `Rates` | Rates currently in effect (`/api/v1/rate.json`). `rate('USD')` returns one rate or `null`. |
| `on($date, $currency = null)` | `DayRate` | `$date` is `"YYYY-MM-DD"` or a `DateTimeInterface`. From 2021-08-02 up to tomorrow in Caracas. |
| `history($currency, days: 30)` / `history($currency, start:, end:)` | `History` | Last N days (1 to 1830) or an inclusive range, oldest first, with `min`, `max`, `first`, `last`, `change`, `changePct`. Ranges are clipped to `history.json` and `note` says so. Countable and iterable. |
| `convert($amount, $from, $to, date: null, decimals: 2)` | `Conversion` | Between VES, USD, EUR, CNY, TRY and RUB. Cross rates go through the bolivar. |
| `status()` | `Status` | Data freshness. |
| `clearCache()` | `void` | Forget responses held by the built-in in-memory cache. |

Results are immutable objects with `readonly` properties. Calendar days are `"YYYY-MM-DD"` strings, timestamps
(`updatedAt`, `generatedAt`) are `DateTimeImmutable` in UTC, and rates and amounts are decimal strings, so no precision is
lost to floats. Every result also has a one-line English `summary` and the attribution `source`.

### Exact decimals and rounding

`convert()` never uses binary floating point for money: rates are read from their shortest decimal form, amounts can be
strings (`"1234.56"`, `"1_000"`, `"1e3"`), integers or floats (a float is taken from its shortest decimal form, so
`0.1` is exactly `0.1`). The product is exact and divisions keep 28 significant digits, the same as Python's `decimal`
module, so the digits match the Python and JavaScript clients. `result` is then rounded **half-up** (`0.125` -> `0.13`)
to `decimals` places (default 2, 0 to 12; `null` keeps full precision). The arithmetic is pure PHP: neither bcmath nor
gmp is needed.

### Errors

```text
BcvToday\Exception\BcvException (extends RuntimeException)
├── InvalidArgumentException
│   ├── InvalidDateException          bad date, not a real calendar day, bad range or days
│   ├── InvalidCurrencyException      unknown currency code, or from === to
│   └── InvalidAmountException        negative, non-finite or > 1e15 amount; bad decimals
├── DateOutOfRangeException           before 2021-08-02, in the future, not published yet, outside history.json
├── CurrencyNotAvailableException     valid code, but no rate that day
├── NotFoundException                 HTTP 404
└── UpstreamException                 network failure, timeout, HTTP error or invalid JSON ($status holds the HTTP code)
```

Invalid arguments are rejected before any request is made.

### Caching

Responses are cached for `cacheTtl` seconds (default 300; BCV publishes a few times per business day). By default the
cache lives in memory for the current process. To share it across requests, pass any object with PSR-16 style
`get($key)` and `set($key, $value, $ttl)` methods, for example a Symfony or Laravel cache:

```php
$bcv = new Bcv(cache: $psr16Cache, cacheTtl: 600);
```

Only successful responses are cached, as the raw JSON string.

### HTTP

The client sends `User-Agent: bcv-today-php/<version> (+https://bcv.today)` and `Accept: application/json`. It uses
ext-curl when it is loaded and `file_get_contents` with a stream context otherwise. To use your own HTTP stack (or a fake
in tests), pass a callable:

```php
use BcvToday\Http\Response;

$bcv = new Bcv(httpClient: function (string $url, array $headers, float $timeout): Response {
    $r = $myClient->get($url, ['headers' => $headers, 'timeout' => $timeout]);
    return new Response($r->getStatusCode(), (string) $r->getBody());
});
```

Return non-2xx responses as a `Response`; any exception thrown by the callable becomes an `UpstreamException`.

## Laravel

The package is auto-discovered: the service provider registers `BcvToday\Bcv` as a singleton and the `Bcv` facade.
Laravel itself is not a dependency.

```php
use BcvToday\Laravel\Facades\Bcv;

Bcv::latest()->rate('USD');
Bcv::convert('100', 'USD', 'VES')->result;

// or inject it
public function show(\BcvToday\Bcv $bcv) { return $bcv->on('2026-01-04', 'USD')->rate; }
```

Responses are cached in Laravel's default cache store. To change the settings, publish the configuration file:

```bash
php artisan vendor:publish --tag=bcv-config
```

`config/bcv.php` reads `BCV_BASE_URL`, `BCV_TIMEOUT`, `BCV_CACHE_TTL` (seconds, 0 disables) and `BCV_CACHE_STORE`
(a store name such as `redis`; `false` keeps an in-memory cache per request).

## MCP

For AI assistants, connect to the remote BCV Today MCP server instead: `https://mcp.bcv.today/mcp`
(Streamable HTTP, no authentication, nothing to install).

## En español

`grupoclip/bcv-today` es el cliente oficial de PHP para la [API de BCV Today](https://bcv.today/api/): las tasas de
cambio oficiales del Banco Central de Venezuela (USD, EUR, CNY, TRY y RUB contra el bolívar). **Proyecto no oficial, no
afiliado al Banco Central de Venezuela.** Datos bajo [CC BY 4.0](https://bcv.today/licencia/).

```php
$bcv = new BcvToday\Bcv();
$bcv->latest()->rate('USD');                        // bolívares por dólar
$bcv->on('2026-01-04', 'USD')->effectiveDate;       // domingo: rige la tasa con fecha valor 2026-01-03
$bcv->convert('100', 'USD', 'VES')->result;         // "91664.77"
```

Las conversiones usan aritmética decimal exacta en PHP puro (sin bcmath) y, por defecto, redondean a 2 decimales con la
mitad hacia arriba (0,005 → 0,01). En Laravel se registra solo: usa la fachada `Bcv` o inyecta `BcvToday\Bcv`. Más
integraciones (Python, JavaScript, Odoo, MCP, A2A): https://bcv.today/integraciones/

## Links

- API docs: https://bcv.today/api/ · OpenAPI: https://bcv.today/openapi.json · llms.txt: https://bcv.today/llms.txt
- Python library: https://pypi.org/project/bcv/ · JavaScript library: https://www.npmjs.com/package/bcv-today
- Source: https://github.com/grupoclip/bcv-api/tree/main/packages/php (mirrored read-only to
  https://github.com/grupoclip/bcv-today-php for Packagist) · Issues: https://github.com/grupoclip/bcv-api/issues

## License

Code: Apache-2.0. Data: CC BY 4.0, BCV Today, from Banco Central de Venezuela.
