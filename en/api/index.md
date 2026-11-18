---
title: API
permalink: "/en/api/"
layout: default
seo_title: BCV API | Free USD/VES exchange rate JSON
lang: en
alt_url: "/api/"
description: Free BCV JSON API for the BCV dollar USD/VES rate, euro and official
  Banco Central de Venezuela exchange rates, with daily history and no API key required.
keywords:
- BCV API
- BCV exchange rate API
- USD VES API
- BCV dollar API
- Banco Central de Venezuela API
copy_code: true
---

# API reference

A free read-only JSON BCV API for the official exchange rates published by Banco Central de Venezuela. Data is served as static files from GitHub Pages, with no authentication, no API keys, and no project-level rate limits beyond GitHub Pages itself.

**Base URL:** `{{ site.url }}{{ site.baseurl }}`

**API v1 root:** `{{ site.url }}{{ site.baseurl }}/api/v1`

Other ways to use the same data (Python and JavaScript libraries, Odoo module, MCP server, A2A agent): [all integrations]({{ '/en/integrations/' | relative_url }}).

## Agent discovery

| Resource | URL | Use |
| --- | --- | --- |
| OpenAPI | `/openapi.json` | Machine-readable endpoint description. |
| API catalog | `/.well-known/api-catalog` | RFC-style catalog with docs, status and OpenAPI. |
| Agent card | `/.well-known/agent-card.json` | A2A agent card of the rates agent (`https://mcp.bcv.today/a2a`). |
| LLM index | `/llms.txt` | Short summary for agents and LLMs. |
| LLM full context | `/llms-full.txt` | Full Markdown/text context. |
| MCP server card | `/.well-known/mcp/server-card.json` | MCP server card (endpoint, transport and tools). |

## MCP server

A remote [Model Context Protocol](https://modelcontextprotocol.io) server for AI assistants and agents (Claude, ChatGPT, Cursor, VS Code and others). It is free, read-only, stateless and needs no authentication; it uses the same data as this API.

**Endpoint (Streamable HTTP):** `https://mcp.bcv.today/mcp`

| Tool | What it does |
| --- | --- |
| `get_latest_rates` | Official rates in effect (USD, EUR, CNY, TRY, RUB) with the effective date. |
| `get_rate_by_date` | Rate in effect on a day (`YYYY-MM-DD`); explains weekend and holiday carry-forward. |
| `get_history` | Daily series for one currency (last N days or a `from`/`to` range) with min, max and % change. |
| `convert` | Converts an amount between VES, USD, EUR, CNY, TRY and RUB at the latest rate or a given day's rate. |
| `get_status` | Data freshness: last capture, effective date and available currencies. |

Claude Code:

```bash
claude mcp add --transport http bcv-today https://mcp.bcv.today/mcp
```

Claude Desktop / claude.ai: **Settings → Connectors → Add custom connector** with the URL `https://mcp.bcv.today/mcp`.

Other clients (Cursor, VS Code, Windsurf…), in their MCP configuration file:

```json
{
  "mcpServers": {
    "bcv-today": {
      "type": "http",
      "url": "https://mcp.bcv.today/mcp"
    }
  }
}
```

Clients that only speak stdio can use the bridge `npx -y mcp-remote https://mcp.bcv.today/mcp`.

## Python library

Official client on [PyPI](https://pypi.org/project/bcv/): zero dependencies (Python 3.9+), caching, `Decimal` money math, weekend carry-forward and a command line (`bcv latest`, `bcv convert 100 USD VES`). Unofficial project: not affiliated with Banco Central de Venezuela.

```bash
pip install bcv
```

```python
from bcv import BCV

client = BCV()
print(client.latest()["USD"])                  # bolivars per dollar
print(client.on("2026-01-04", "USD"))          # Sunday: uses the rate effective 2026-01-03
print(client.convert(100, "USD", "VES"))
```

Code and docs: [python/ on GitHub](https://github.com/{{ site.repository }}/tree/main/python).

## JavaScript / TypeScript {#javascript}

Official client on [npm](https://www.npmjs.com/package/bcv-today) (`bcv-today`): zero dependencies, TypeScript types, ESM and CommonJS, caching, exact decimal conversions (half-up rounding), weekend carry-forward, a command line (`npx bcv-today convert 100 USD VES`) and a local MCP server (`bcv-today mcp`). Runs on Node.js 18+, Deno, Bun, browsers and Cloudflare Workers. Unofficial project: not affiliated with Banco Central de Venezuela.

```bash
npm install bcv-today
```

```js
import { BCV } from "bcv-today";

const bcv = new BCV();
console.log((await bcv.latest()).rates.USD);                  // bolivars per dollar
console.log((await bcv.on("2026-01-04", "USD")).effectiveDate); // Sunday: "2026-01-03"
console.log((await bcv.convert(100, "USD", "VES")).resultText); // "91664.77"
```

Code and docs: [js/ on GitHub](https://github.com/{{ site.repository }}/tree/main/js).

## Odoo module {#odoo}

Free module [`l10n_ve_bcv_rate`](https://apps.odoo.com/apps/modules/20.0/l10n_ve_bcv_rate) that updates every company's currency rates in Odoo daily with the official BCV rate read from this API (USD, EUR, CNY, TRY and RUB), dated with the value date. It works with companies in bolivars or in foreign currency, can backfill history from 2021-08-02 and needs no API key or extra Python packages.

- **Versions:** Odoo 16.0, 17.0, 18.0, 19.0 and 20.0, Community and Enterprise, on Odoo.sh or on-premise.
- **Not available on Odoo Online** (SaaS), which does not allow third-party modules.
- **Install:** copy `l10n_ve_bcv_rate/` (from the branch for your version) into your addons path, update the apps list and install it from *Apps*; then enable it in *Settings › Accounting › Currencies*.

Download: [Odoo Apps](https://apps.odoo.com/apps/modules/20.0/l10n_ve_bcv_rate) · Code: [grupoclip/odoo-bcv-rate on GitHub](https://github.com/grupoclip/odoo-bcv-rate) (branches `16.0` to `20.0`).

## A2A agent

An [Agent2Agent (A2A)](https://a2a-protocol.org) agent so other agents can query the rates. It is deterministic (no LLM), free, stateless and needs no authentication, and it runs the same logic as the MCP server.

**Endpoint (JSON-RPC 2.0, A2A 1.0 and 0.3):** `https://mcp.bcv.today/a2a`

**Agent card:** [`/.well-known/agent-card.json`]({{ site.url }}{{ site.baseurl }}/.well-known/agent-card.json) (also at `https://mcp.bcv.today/.well-known/agent-card.json`)

| Skill | Text example | DataPart |
| --- | --- | --- |
| `latest-rates` | "What is the official BCV dollar rate today?" | `{"skill":"latest-rates","currency":"USD"}` |
| `rate-on-date` | "USD rate on 2026-01-04" | `{"skill":"rate-on-date","date":"2026-01-04"}` |
| `convert` | "convert 50000 VES to EUR" | `{"skill":"convert","amount":100,"from":"USD","to":"VES"}` |
| `history` | "USD history for the last 30 days" | `{"skill":"history","currency":"USD","days":30}` |
| `status` | "when was the rate last updated?" | `{"skill":"status"}` |

It understands Spanish and English. Answers are a completed task (`TASK_STATE_COMPLETED`) whose artifact holds a short text summary and a DataPart with the structured JSON; when it cannot understand a request it replies with a message listing what it can do. There is no streaming and no push notifications, and tasks are not stored (`GetTask` answers `TaskNotFound`).

```bash
curl -s https://mcp.bcv.today/a2a \
  -H 'Content-Type: application/json' -H 'A2A-Version: 1.0' \
  -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"role":"ROLE_USER","messageId":"1","parts":[{"text":"USD rate on 2026-01-04"}]}}}'
```

A2A 0.3 clients can use `message/send` (without the `A2A-Version` header).

## Endpoints

### Latest rate

<div class="endpoint">
  <span class="method">GET</span>
  <span class="path">/api/v1/rate.json</span>
</div>

Returns today's current rate entry. The file is rebuilt every time the scraper runs and commits only when the generated files in `api/v1/` change.

**Example:**

```bash
curl -s {{ site.url }}{{ site.baseurl }}/api/v1/rate.json
```

```json
{
  "USD": 500.4606,
  "EUR": 589.27233807,
  "CNY": 73.59606476,
  "TRY": 11.03277068,
  "RUB": 6.71398712,
  "updated_at": "2026-05-11T13:28:27.091112+00:00",
  "effective_date": "2026-05-11",
  "date": "2026-05-11"
}
```

### History index

<div class="endpoint">
  <span class="method">GET</span>
  <span class="path">/api/v1/history.json</span>
</div>

Returns up to the latest 1830 daily entries, ordered from oldest to newest. This file powers the history chart and table on the website.

**Example:**

```bash
curl -s {{ site.url }}{{ site.baseurl }}/api/v1/history.json
```

### API status

<div class="endpoint">
  <span class="method">GET</span>
  <span class="path">/api/v1/status.json</span>
</div>

Returns the status of the published dataset, the effective date, generation time, and available currencies.

**Example:**

```bash
curl -s {{ site.url }}{{ site.baseurl }}/api/v1/status.json
```

```json
{
  "status": "ok",
  "updated_at": "2026-05-11T15:39:01.127606+00:00",
  "generated_at": "2026-05-11T15:39:01.127606+00:00",
  "date": "2026-05-11",
  "effective_date": "2026-05-11",
  "timezone": "America/Caracas",
  "api_version": "v1",
  "supported_currencies": ["USD", "EUR", "CNY", "TRY", "RUB"]
}
```

### History by date

<div class="endpoint">
  <span class="method">GET</span>
  <span class="path">/api/v1/history/{YYYY-MM-DD}.json</span>
</div>

Returns the snapshot stored for a specific `America/Caracas` calendar date. Historical snapshots use the same base format as `rate.json`, but older entries may omit currencies that were unavailable in the original source data.

| Parameter | Type | Description |
| --- | --- | --- |
| `YYYY-MM-DD` | path | ISO 8601 date, for example `2026-05-11`. |

**Example:**

```bash
curl -s {{ site.url }}{{ site.baseurl }}/api/v1/history/2026-05-11.json
```

Returns `404` if the requested date does not exist in the repository.

## Response schema

| Field | Type | Description |
| --- | --- | --- |
| `USD` | number | Bolívares per 1 US dollar. |
| `EUR` | number | Bolívares per 1 euro. Always present in `rate.json`; may be omitted from older history entries if unavailable in the source. |
| `CNY` | number | Bolívares per 1 Chinese yuan. Always present in `rate.json`; may be omitted from older history entries if unavailable in the source. |
| `TRY` | number | Bolívares per 1 Turkish lira. Always present in `rate.json`; may be omitted from older history entries if unavailable in the source. |
| `RUB` | number | Bolívares per 1 Russian ruble. Always present in `rate.json`; may be omitted from older history entries if unavailable in the source. |
| `updated_at` | string (ISO 8601) | UTC timestamp when the scraper captured the rate. |
| `date` | string (`YYYY-MM-DD`) | Calendar date represented by the file. For per-day history files, this matches the filename. |
| `effective_date` | string (`YYYY-MM-DD`) | Official BCV validity date (`Fecha Valor`). On weekends and holidays this can point to the previous business day whose rate is still officially in effect. |
| `source` | string | Optional field present on some imported historical entries. |

> BCV usually publishes rates on business days around **16:30 Caracas time**, effective for the **next business day**. Friday's publication normally applies to Monday; if Monday is a holiday, it applies to the next business day.
>
> Saturdays, Sundays, and holidays do not usually have a new BCV publication. The scraper fills missing calendar days with the latest rate whose `effective_date` is less than or equal to that day.

## Usage examples

### Badges

You can show API availability or the latest USD rate in a README, internal
dashboard, or public docs.

**Markdown:**

```md
![BCV Today](https://img.shields.io/badge/BCV%20Today-API%20online-187a3b)
![USD BCV](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fbcv.today%2Fapi%2Fv1%2Frate.json&query=$.USD&label=USD%20BCV&suffix=%20Bs)
```

**HTML:**

```html
<img
  alt="BCV Today API online"
  src="https://img.shields.io/badge/BCV%20Today-API%20online-187a3b"
/>
<img
  alt="USD BCV"
  src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fbcv.today%2Fapi%2Fv1%2Frate.json&query=$.USD&label=USD%20BCV&suffix=%20Bs"
/>
```

### JavaScript

```js
const res = await fetch("{{ site.url }}{{ site.baseurl }}/api/v1/rate.json", {
  cache: "no-cache",
});
const { USD, EUR, date } = await res.json();
console.log(`Rate for ${date}: USD ${USD} - EUR ${EUR}`);
```

### Node.js

```js
const res = await fetch("{{ site.url }}{{ site.baseurl }}/api/v1/rate.json");
if (!res.ok) throw new Error(`BCV API ${res.status}`);

const rate = await res.json();
const ves = 100 * rate.USD;

console.log(`100 USD = ${ves.toFixed(2)} Bs. (${rate.date})`);
```

### Python

```python
import requests

data = requests.get(
    "{{ site.url }}{{ site.baseurl }}/api/v1/rate.json",
    timeout=10,
).json()

print(f"USD: {data['USD']}  EUR: {data['EUR']}  ({data['date']})")
```

### PHP

```php
<?php
$json = file_get_contents("{{ site.url }}{{ site.baseurl }}/api/v1/rate.json");
$rate = json_decode($json, true, flags: JSON_THROW_ON_ERROR);

$ves = 100 * $rate["USD"];
echo "100 USD = " . number_format($ves, 2) . " Bs. ({$rate['date']})";
```

### cURL + jq

```bash
curl -s {{ site.url }}{{ site.baseurl }}/api/v1/rate.json | jq '.USD'
```

### Quick conversion

```js
function convert(amount, from, to, rate) {
  const toBs = from === "VES" ? amount : amount * rate[from];
  return to === "VES" ? toBs : toBs / rate[to];
}

const rate = await fetch("{{ site.url }}{{ site.baseurl }}/api/v1/rate.json").then((r) => r.json());

console.log(convert(100, "USD", "VES", rate));
console.log(convert(1000, "VES", "USD", rate));
```

## Availability and caching

- Files are served by **GitHub Pages** behind GitHub's CDN cache.
- To force a fresh read, use `cache: "no-cache"` with `fetch` or send `Cache-Control: no-cache` with cURL.
- You can also consume the files through jsDelivr:
  `https://cdn.jsdelivr.net/gh/{{ site.repository }}/api/v1/rate.json`.

## Web Bot Auth {#web-bot-auth}

The data is fetched from the public page at `https://www.bcv.org.ve/` every 30 minutes, with the User-Agent `python-requests/<version> (BCVTodayBot; +https://bcv.today/api/#web-bot-auth)`.

Every request is signed with [Web Bot Auth](https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/) (HTTP Message Signatures, RFC 9421, Ed25519) and carries the headers `Signature-Agent: "https://bcv.today"`, `Signature-Input` and `Signature`.

- Key directory: [`/.well-known/http-message-signatures-directory`](/.well-known/http-message-signatures-directory)
- `keyid`: `JkYyrLLVt1MPLEk4CLTRkklkKSqbqoWL_dyy6JRy3vc`

## Changes and support

Source code and change history are available at [github.com/{{ site.repository }}](https://github.com/{{ site.repository }}).

Open an [issue](https://github.com/{{ site.repository }}/issues) for bugs or requests.
