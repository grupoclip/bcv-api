---
layout: default
title: API
seo_title: "BCV API | Dólar BCV USD/VES JSON gratis"
lang: es
alt_url: /en/api/
description: "API BCV gratis en JSON para consultar dólar BCV USD/VES, euro y tasas oficiales del Banco Central de Venezuela, con histórico diario y sin clave de acceso."
keywords:
  - API BCV
  - dolar bcv API
  - dólar BCV JSON
  - USD VES API
  - Banco Central de Venezuela API
copy_code: true
---

# Documentación de la API

API BCV gratuita en JSON, de solo lectura, con las tasas oficiales del Banco Central de Venezuela. Los datos se sirven como archivos estáticos desde GitHub Pages, sin autenticación, sin claves y sin límites de uso impuestos por este proyecto más allá de los de GitHub Pages.

**Base URL:** `{{ site.url }}{{ site.baseurl }}`

**API v1 root:** `{{ site.url }}{{ site.baseurl }}/api/v1`

## Descubrimiento para agentes

| Recurso | URL | Uso |
| --- | --- | --- |
| OpenAPI | `/openapi.json` | Descripción machine-readable de los endpoints. |
| API catalog | `/.well-known/api-catalog` | Catálogo RFC-style con docs, estado y OpenAPI. |
| Agent card | `/.well-known/agent-card.json` | Capacidades de acceso a datos para agentes. |
| LLM index | `/llms.txt` | Resumen corto para agentes y LLMs. |
| LLM full context | `/llms-full.txt` | Contexto completo en Markdown/texto. |

## Endpoints

### Tasa actual

<div class="endpoint">
  <span class="method">GET</span>
  <span class="path">/api/v1/rate.json</span>
</div>

Retorna la tasa vigente para el día actual. El archivo se reconstruye en cada ejecución del scraper y solo se confirma un cambio cuando los archivos generados en `api/v1/` cambian.

**Ejemplo:**

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

### Índice histórico

<div class="endpoint">
  <span class="method">GET</span>
  <span class="path">/api/v1/history.json</span>
</div>

Retorna hasta las últimas 1830 entradas diarias, ordenadas de la más antigua a la más reciente. Este archivo alimenta la gráfica y la tabla del histórico en el sitio.

**Ejemplo:**

```bash
curl -s {{ site.url }}{{ site.baseurl }}/api/v1/history.json
```

### Estado de la API

<div class="endpoint">
  <span class="method">GET</span>
  <span class="path">/api/v1/status.json</span>
</div>

Retorna el estado del dataset publicado, la fecha de vigencia, la hora de generación y las monedas disponibles.

**Ejemplo:**

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

### Histórico por fecha

<div class="endpoint">
  <span class="method">GET</span>
  <span class="path">/api/v1/history/{YYYY-MM-DD}.json</span>
</div>

Retorna el snapshot guardado para una fecha específica del calendario `America/Caracas`. Los snapshots históricos usan el mismo formato base que `rate.json`, pero las entradas antiguas pueden omitir monedas que no estaban disponibles en la fuente original.

| Parámetro | Tipo | Descripción |
| --- | --- | --- |
| `YYYY-MM-DD` | path | Fecha en formato ISO 8601, por ejemplo `2026-05-11`. |

**Ejemplo:**

```bash
curl -s {{ site.url }}{{ site.baseurl }}/api/v1/history/2026-05-11.json
```

Retorna `404` si la fecha solicitada no existe en el repositorio.

## Esquema de respuesta

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `USD` | number | Tasa en bolívares por 1 dólar estadounidense. |
| `EUR` | number | Tasa en bolívares por 1 euro. Siempre presente en `rate.json`; puede estar omitido en históricos antiguos si no estaba disponible en la fuente. |
| `CNY` | number | Tasa en bolívares por 1 yuan chino. Siempre presente en `rate.json`; puede estar omitido en históricos antiguos si no estaba disponible en la fuente. |
| `TRY` | number | Tasa en bolívares por 1 lira turca. Siempre presente en `rate.json`; puede estar omitido en históricos antiguos si no estaba disponible en la fuente. |
| `RUB` | number | Tasa en bolívares por 1 rublo ruso. Siempre presente en `rate.json`; puede estar omitido en históricos antiguos si no estaba disponible en la fuente. |
| `updated_at` | string (ISO 8601) | Momento en UTC en que el scraper obtuvo el dato. |
| `date` | string (`YYYY-MM-DD`) | Día calendario representado por el archivo. En los archivos históricos por día coincide con el nombre del archivo. |
| `effective_date` | string (`YYYY-MM-DD`) | Fecha de vigencia oficial publicada por el BCV (`Fecha Valor`). En fines de semana y feriados puede apuntar al día hábil anterior cuya tasa sigue vigente. |
| `source` | string | Campo opcional presente en algunas entradas históricas importadas. |

> El BCV suele publicar la tasa los días hábiles alrededor de las **16:30 hora de Caracas**, con vigencia para el **siguiente día hábil**. La publicación del viernes normalmente aplica para el lunes; si el lunes es feriado, aplica para el siguiente día hábil.
>
> Sábados, domingos y feriados normalmente no tienen una nueva publicación del BCV. El scraper rellena los días calendario faltantes con la tasa más reciente cuyo `effective_date` sea menor o igual a ese día.

## Ejemplos de uso

### Insignias

Puedes mostrar el estado del API o la tasa USD en un README, dashboard interno
o documentación pública.

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
console.log(`Tasa del ${date}: USD ${USD} - EUR ${EUR}`);
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

### Conversión rápida

```js
function convert(amount, from, to, rate) {
  const toBs = from === "VES" ? amount : amount * rate[from];
  return to === "VES" ? toBs : toBs / rate[to];
}

const rate = await fetch("{{ site.url }}{{ site.baseurl }}/api/v1/rate.json").then((r) => r.json());

console.log(convert(100, "USD", "VES", rate));
console.log(convert(1000, "VES", "USD", rate));
```

## Disponibilidad y caché

- Los archivos se sirven desde **GitHub Pages**, detrás de la caché CDN de GitHub.
- Para forzar una lectura fresca, usa `cache: "no-cache"` con `fetch` o envía `Cache-Control: no-cache` con cURL.
- También puedes consumir los archivos vía jsDelivr:
  `https://cdn.jsdelivr.net/gh/{{ site.repository }}/api/v1/rate.json`.

## Cambios y soporte

El código fuente y el historial de cambios están en [github.com/{{ site.repository }}](https://github.com/{{ site.repository }}).

Reporta errores o solicita ajustes en [issues](https://github.com/{{ site.repository }}/issues).
