---
layout: default
title: API
lang: en
permalink: /en/api/
alt_url: /api/
description: Reference for the JSON API serving Banco Central de Venezuela exchange rates.
---

# API reference

A read-only JSON API for the official exchange rates published by Banco Central de Venezuela. Data is served as static files from GitHub Pages, with no authentication, no API keys, and no project-level rate limits beyond GitHub Pages itself.

**Base URL:** `{{ site.url }}{{ site.baseurl }}`

## Endpoints

### Latest rate

<div class="endpoint">
  <span class="method">GET</span>
  <span class="path">/api/rate.json</span>
</div>

Returns today's current rate entry. The file is rebuilt every time the scraper runs and commits only when the generated files in `api/` change.

**Example:**

```bash
curl -s {{ site.url }}{{ site.baseurl }}/api/rate.json
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
  <span class="path">/api/history.json</span>
</div>

Returns up to the latest 365 daily entries, ordered from oldest to newest. This file powers the history chart and table on the website.

**Example:**

```bash
curl -s {{ site.url }}{{ site.baseurl }}/api/history.json
```

### History by date

<div class="endpoint">
  <span class="method">GET</span>
  <span class="path">/api/history/{YYYY-MM-DD}.json</span>
</div>

Returns the snapshot stored for a specific `America/Caracas` calendar date. The response format matches `rate.json`.

| Parameter | Type | Description |
| --- | --- | --- |
| `YYYY-MM-DD` | path | ISO 8601 date, for example `2026-05-11`. |

**Example:**

```bash
curl -s {{ site.url }}{{ site.baseurl }}/api/history/2026-05-11.json
```

Returns `404` if the requested date does not exist in the repository.

## Response schema

| Field | Type | Description |
| --- | --- | --- |
| `USD` | number | Bolívares per 1 US dollar. |
| `EUR` | number | Bolívares per 1 euro. |
| `CNY` | number | Bolívares per 1 Chinese yuan. |
| `TRY` | number | Bolívares per 1 Turkish lira. |
| `RUB` | number | Bolívares per 1 Russian ruble. |
| `updated_at` | string (ISO 8601) | UTC timestamp when the scraper captured the rate. |
| `date` | string (`YYYY-MM-DD`) | Calendar date represented by the file. For per-day history files, this matches the filename. |
| `effective_date` | string (`YYYY-MM-DD`) | Official BCV validity date (`Fecha Valor`). On weekends and holidays this can point to the previous business day whose rate is still officially in effect. |
| `source` | string | Optional field present on some imported historical entries. |

> BCV usually publishes rates on business days around **16:30 Caracas time**, effective for the **next business day**. Friday's publication normally applies to Monday; if Monday is a holiday, it applies to the next business day.
>
> Saturdays, Sundays, and holidays do not usually have a new BCV publication. The scraper fills missing calendar days with the latest rate whose `effective_date` is less than or equal to that day.

## Usage examples

### JavaScript

```js
const res = await fetch("{{ site.url }}{{ site.baseurl }}/api/rate.json", {
  cache: "no-cache",
});
const { USD, EUR, date } = await res.json();
console.log(`Rate for ${date}: USD ${USD} - EUR ${EUR}`);
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

- Files are served by **GitHub Pages** behind GitHub's CDN cache.
- To force a fresh read, use `cache: "no-cache"` with `fetch` or send `Cache-Control: no-cache` with cURL.
- You can also consume the files through jsDelivr:
  `https://cdn.jsdelivr.net/gh/{{ site.repository }}/api/rate.json`.

## Changes and support

Source code and change history are available at [github.com/{{ site.repository }}](https://github.com/{{ site.repository }}).

Open an [issue](https://github.com/{{ site.repository }}/issues) for bugs or requests.
