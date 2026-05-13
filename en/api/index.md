---
layout: default
title: API
lang: en
permalink: /en/api/
alt_url: /api/
description: Reference for the JSON API serving Banco Central de Venezuela exchange rates.
copy_code: true
---

# API reference

A free read-only JSON BCV API for the official exchange rates published by Banco Central de Venezuela. Data is served as static files from GitHub Pages, with no authentication, no API keys, and no project-level rate limits beyond GitHub Pages itself.

**Base URL:** `{{ site.url }}{{ site.baseurl }}`

**API v1 root:** `{{ site.url }}{{ site.baseurl }}/api/v1`

## Agent discovery

| Resource | URL | Use |
| --- | --- | --- |
| OpenAPI | `/openapi.json` | Machine-readable endpoint description. |
| API catalog | `/.well-known/api-catalog` | RFC-style catalog with docs, status and OpenAPI. |
| Agent card | `/.well-known/agent-card.json` | Data-access capabilities for agents. |
| LLM index | `/llms.txt` | Short summary for agents and LLMs. |
| LLM full context | `/llms-full.txt` | Full Markdown/text context. |

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

## Changes and support

Source code and change history are available at [github.com/{{ site.repository }}](https://github.com/{{ site.repository }}).

Open an [issue](https://github.com/{{ site.repository }}/issues) for bugs or requests.
