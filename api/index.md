---
layout: default
title: API
lang: es
alt_url: /en/api/
description: Documentación de la API JSON con las tasas oficiales del BCV.
---

# Documentación de la API

API JSON de solo lectura con las tasas oficiales del Banco Central de Venezuela. Los datos se sirven como archivos estáticos desde GitHub Pages, sin autenticación, sin claves y sin límites de uso impuestos por este proyecto (más allá de los de GitHub Pages).

**Base URL:** `{{ site.url }}{{ site.baseurl }}`

## Endpoints

### Tasa actual

<div class="endpoint">
  <span class="method">GET</span>
  <span class="path">/api/rate.json</span>
</div>

Retorna las últimas tasas publicadas. El archivo se reescribe en cada ejecución del scraper (días hábiles, después de las 16:00 hora de Caracas).

**Ejemplo:**

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
  "date": "2026-05-09",
  "effective_date": "2026-05-11"
}
```

### Histórico por fecha

<div class="endpoint">
  <span class="method">GET</span>
  <span class="path">/api/history/{YYYY-MM-DD}.json</span>
</div>

Retorna el snapshot guardado para una fecha específica (calendario `America/Caracas`). El formato es idéntico al de `rate.json`.

| Parámetro | Tipo | Descripción |
| --- | --- | --- |
| `YYYY-MM-DD` | path | Fecha en formato ISO 8601, ej. `2026-05-09`. |

**Ejemplo:**

```bash
curl -s {{ site.url }}{{ site.baseurl }}/api/history/2026-05-09.json
```

Respuesta `404` si la fecha solicitada no existe en el repositorio.

## Esquema de respuesta

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `USD` | number | Tasa en bolívares por 1 dólar estadounidense. |
| `EUR` | number | Tasa en bolívares por 1 euro. |
| `CNY` | number | Tasa en bolívares por 1 yuan chino. |
| `TRY` | number | Tasa en bolívares por 1 lira turca. |
| `RUB` | number | Tasa en bolívares por 1 rublo ruso. |
| `updated_at` | string (ISO 8601) | Momento en UTC en que el scraper obtuvo el dato. |
| `date` | string (`YYYY-MM-DD`) | Día calendario al que corresponde el archivo. Coincide con el nombre del archivo en `api/history/`. |
| `effective_date` | string (`YYYY-MM-DD`) | Fecha de vigencia oficial publicada por el BCV (`Fecha Valor`). Para días hábiles coincide con `date`; para sábados, domingos y feriados apunta al último día hábil con tasa publicada (la tasa **vigente** ese día). |

> El BCV publica la tasa los días hábiles, alrededor de las **16:30 hora de Caracas**, con vigencia para el **siguiente día hábil**: viernes publica para el lunes; si el lunes es feriado, publica para el siguiente día hábil (martes, etc.).
>
> Sábados, domingos y feriados no hay nueva publicación. El scraper corre todos los días y, además del archivo del día efectivo, rellena los días calendario faltantes. Por eso `api/history/2026-05-09.json` (sábado) y `api/history/2026-05-10.json` (domingo) llevan la tasa con `effective_date = "2026-05-08"` (viernes), porque esa era la tasa oficialmente vigente esos días.

## Ejemplos de uso

### JavaScript (navegador)

```js
const res = await fetch("{{ site.url }}{{ site.baseurl }}/api/rate.json", {
  cache: "no-cache",
});
const { USD, EUR, date } = await res.json();
console.log(`Tasa del ${date}: USD ${USD} · EUR ${EUR}`);
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

## Disponibilidad y caché

- Los archivos se sirven desde **GitHub Pages**, con la caché CDN del servicio.
- Para forzar lectura fresca, usa `cache: "no-cache"` (fetch) o `Cache-Control: no-cache` (cURL).
- Si necesitas un CDN explícito, también puedes consumir los archivos vía
  jsDelivr: `https://cdn.jsdelivr.net/gh/{{ site.repository }}/api/rate.json`.

## Cambios y soporte

El código fuente y el historial de cambios están en
[github.com/{{ site.repository }}](https://github.com/{{ site.repository }}).
Reporta problemas o solicita ajustes vía
[issues](https://github.com/{{ site.repository }}/issues).
