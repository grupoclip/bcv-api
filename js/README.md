# bcv-today

Official JavaScript/TypeScript client for the [BCV Today API](https://bcv.today/api/): the exchange rates published by
Banco Central de Venezuela (BCV) for USD, EUR, CNY, TRY and RUB against the bolivar (VES).

> **Unofficial, not affiliated with Banco Central de Venezuela.** BCV Today republishes the rates that BCV publishes on
> its website. Data: [CC BY 4.0](https://bcv.today/licencia/), attribution "BCV Today (https://bcv.today), data from
> Banco Central de Venezuela".

- Zero runtime dependencies, uses the global `fetch`: Node.js 18+, Deno, Bun, browsers and Cloudflare Workers.
- ESM and CommonJS builds with TypeScript types.
- Exact decimal conversions (no floating-point drift), rounded half-up.
- Weekend and holiday carry-forward, the same rules as the BCV Today MCP server, A2A agent and Python library.
- In-memory cache, typed errors and a `bcv-today` command.

```bash
npm install bcv-today
```

## Usage

```ts
import { BCV } from "bcv-today";

const bcv = new BCV();

const latest = await bcv.latest();
latest.rates.USD;          // 916.6477 (bolivars per dollar)
latest.effectiveDate;      // "2026-11-18" (official BCV value date)

const sunday = await bcv.on("2026-01-04", "USD");
sunday.effectiveDate;      // "2026-01-03": the Saturday rate stays in effect
sunday.carriedForward;     // true
sunday.note;               // explains the carry-forward

const c = await bcv.convert(100, "USD", "VES");
c.result;                  // 91664.77 (number)
c.resultText;              // "91664.77" (exactly `decimals` places)
c.resultExact;             // unrounded exact decimal string

const h = await bcv.history("EUR", { days: 30 });   // or { start: "2026-01-01", end: "2026-01-31" }
h.min; h.max; h.first; h.last; h.change; h.changePct;

const s = await bcv.status();
s.stale;                   // true if no capture for more than 96 h
```

CommonJS: `const { BCV } = require("bcv-today");`

### API

| Method | Returns | Notes |
| --- | --- | --- |
| `new BCV({ baseUrl, timeoutMs, cacheTtlMs, fetch, userAgent })` | client | Defaults: `https://bcv.today`, 10000 ms, 300000 ms cache (0 disables), global `fetch`. |
| `latest()` | `Rates` | Rates currently in effect (`/api/v1/rate.json`). |
| `on(date, currency?)` | `DayRate` | `date` is `"YYYY-MM-DD"` or a `Date` (UTC calendar day). From 2021-08-02 up to tomorrow in Caracas. |
| `history(currency, { days } \| { start, end })` | `History` | Last N days (1 to 1830, default 30) or an inclusive range, oldest first, with `min`, `max`, `first`, `last`, `change`, `changePct`. Ranges are clipped to `history.json` and `note` says so. |
| `convert(amount, from, to, { date?, decimals? })` | `Conversion` | Between VES, USD, EUR, CNY, TRY and RUB. Cross rates go through the bolivar. |
| `status()` | `Status` | Data freshness. |
| `clearCache()` | `void` | Forget cached responses. |

Calendar days are ISO strings; timestamps (`updatedAt`, `generatedAt`) are `Date` objects. Every result also has a
one-line English `summary` and the attribution `source`.

### Exact decimals and rounding

`convert()` never uses binary floating point for money: amounts and rates are read as decimals (a number is taken from
its shortest decimal form, so `0.1` is exactly `0.1`; pass a string such as `"1234.56"` for amounts beyond float
precision), multiplied exactly and divided with 28 significant digits, the same as Python's `decimal` module.
`result` and `resultText` are then rounded **half-up** (`0.125` -> `0.13`) to `decimals` places (default 2, 0 to 12;
`null` keeps full precision). `resultExact`, `rateExact` and `amountExact` are the exact values as strings.

### Errors

```text
BCVError
├── InvalidArgument
│   ├── InvalidDate          bad date, not a real calendar day, bad range or days
│   ├── InvalidCurrency      unknown currency code, or from === to
│   └── InvalidAmount        negative, non-finite or > 1e15 amount; bad decimals
├── DateOutOfRange           before 2021-08-02, in the future, not published yet, outside history.json
├── CurrencyNotAvailable     valid code, but no rate that day
├── NotFound                 HTTP 404
└── UpstreamError            network failure, timeout, HTTP error or invalid JSON (`status` holds the HTTP code)
```

Invalid arguments are rejected before any request is made.

### Runtimes

The `User-Agent` header (`bcv-today-js/<version> (+https://bcv.today)`) is sent in Node.js, Deno, Bun and Cloudflare
Workers. Browsers do not allow it (it would also force a CORS preflight), so there it is omitted. The API sends
`Access-Control-Allow-Origin: *`.

## Command line

```bash
npx bcv-today latest
npx bcv-today on 2026-01-04 --currency USD
npx bcv-today convert 100 USD VES [--date 2026-01-02] [--decimals 4]
npx bcv-today history EUR --days 30        # or --start 2026-01-01 --end 2026-01-31
npx bcv-today status
npx bcv-today convert 100 USD VES --json   # machine-readable
```

Options: `--json`, `--base-url URL`, `--timeout SECONDS`, `--version`, `--help`.
Exit codes: `0` ok, `1` no data for the request, `2` invalid arguments, `3` network or API error.

## MCP

For AI assistants, connect to the remote BCV Today MCP server instead: `https://mcp.bcv.today/mcp`
(Streamable HTTP, no authentication, nothing to install).

## En español

`bcv-today` es el cliente oficial de JavaScript/TypeScript para la [API de BCV Today](https://bcv.today/api/): las
tasas de cambio oficiales del Banco Central de Venezuela (USD, EUR, CNY, TRY y RUB contra el bolívar). **Proyecto no
oficial, no afiliado al Banco Central de Venezuela.** Datos bajo [CC BY 4.0](https://bcv.today/licencia/).

```ts
import { BCV } from "bcv-today";
const bcv = new BCV();
(await bcv.latest()).rates.USD;                  // bolívares por dólar
(await bcv.on("2026-01-04", "USD")).effectiveDate; // domingo: usa la tasa con fecha valor 2026-01-03
(await bcv.convert(100, "USD", "VES")).resultText; // "91664.77"
```

Las conversiones usan aritmética decimal exacta y redondeo half-up a 2 decimales por defecto. En la terminal:
`npx bcv-today convert 100 USD VES`. Más integraciones (Python, Odoo, MCP, A2A): https://bcv.today/integraciones/

## Links

- API docs: https://bcv.today/api/ · OpenAPI: https://bcv.today/openapi.json · llms.txt: https://bcv.today/llms.txt
- Python library: https://pypi.org/project/bcv/
- Source: https://github.com/grupoclip/bcv-api/tree/main/js · Issues: https://github.com/grupoclip/bcv-api/issues

## License

Code: Apache-2.0. Data: CC BY 4.0, BCV Today, from Banco Central de Venezuela.
