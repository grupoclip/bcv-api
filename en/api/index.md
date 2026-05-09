---
layout: default
title: API
lang: en
permalink: /en/api/
alt_url: /api/
description: Reference for the JSON API serving Banco Central de Venezuela exchange rates.
---

# API reference

A read-only JSON API with the official exchange rates published by Banco Central de Venezuela. Files are served as static assets from GitHub Pages — no authentication, no API keys, no rate limits beyond GitHub Pages' own.

**Base URL:** `{{ site.url }}{{ site.baseurl }}`

## Endpoints

### Latest rate

<div class="endpoint">
  <span class="method">GET</span>
  <span class="path">/api/rate.json</span>
</div>

Returns the most recent rates. The file is rewritten on every scraper run (weekdays, after 16:00 Caracas time).

**Example:**

```bash
curl -s {{ site.url }}{{ site.baseurl }}/api/rate.json
```

```json
{
  "USD": 500.4606,
  "EUR": 589.27233807,
  "CNY": 69.4823,
  "TRY": 12.9412,
  "RUB": 5.6231,
  "updated_at": "2026-05-09T21:00:13.996037+00:00",
  "date": "2026-05-09"
}
```

### History by date

<div class="endpoint">
  <span class="method">GET</span>
  <span class="path">/api/history/{YYYY-MM-DD}.json</span>
</div>

Returns the snapshot stored for a specific date (`America/Caracas` calendar). The format matches `rate.json`.

| Parameter | Type | Description |
| --- | --- | --- |
| `YYYY-MM-DD` | path | ISO 8601 date, e.g. `2026-05-09`. |

**Example:**

```bash
curl -s {{ site.url }}{{ site.baseurl }}/api/history/2026-05-09.json
```

Responds with `404` if the requested date is not committed in the repository.

## Response schema

| Field | Type | Description |
| --- | --- | --- |
| `USD` | number | Bolívares per 1 US dollar. |
| `EUR` | number | Bolívares per 1 euro. |
| `CNY` | number | Bolívares per 1 Chinese yuan. |
| `TRY` | number | Bolívares per 1 Turkish lira. |
| `RUB` | number | Bolívares per 1 Russian ruble. |
| `updated_at` | string (ISO 8601) | UTC timestamp of when the scrape ran. |
| `date` | string (`YYYY-MM-DD`) | Local Venezuela date the snapshot belongs to. Matches the filename in `api/history/`. |

> BCV publishes each day's rate around 16:00 Caracas time, **for the next business day**. The scraper runs about an hour after that publish window, so the value in `rate.json` is the rate effective the following business day.

## Usage examples

### JavaScript (browser)

```js
const res = await fetch("{{ site.url }}{{ site.baseurl }}/api/rate.json", {
  cache: "no-cache",
});
const { USD, EUR, date } = await res.json();
console.log(`Rate for ${date}: USD ${USD} · EUR ${EUR}`);
```

### Python

```python
import requests

data = requests.get(
    "{{ site.url }}{{ site.baseurl }}/api/rate.json",
    timeout=10,
).json()

print(f"USD: {data['USD']}  EUR: {data['EUR']}  ({data['date']})")
```

### cURL + jq

```bash
curl -s {{ site.url }}{{ site.baseurl }}/api/rate.json | jq '.USD'
```

## Availability and caching

- Files are served by **GitHub Pages**, behind the service's CDN cache.
- To force a fresh read, use `cache: "no-cache"` (fetch) or `Cache-Control: no-cache` (cURL).
- For an explicit CDN, you can also consume the files via
  jsDelivr: `https://cdn.jsdelivr.net/gh/{{ site.repository }}/api/rate.json`.

## Changes and support

Source code and changelog live at
[github.com/{{ site.repository }}](https://github.com/{{ site.repository }}).
Open an [issue](https://github.com/{{ site.repository }}/issues) for bugs or
requests.
