---
title: API
layout: default
seo_title: BCV API | Dólar BCV USD/VES JSON gratis
lang: es
alt_url: "/en/api/"
description: API BCV gratis en JSON para consultar dólar BCV USD/VES, euro y tasas
  oficiales del Banco Central de Venezuela, con histórico diario y sin clave de acceso.
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

**URL base:** `{{ site.url }}{{ site.baseurl }}`

**Raíz de la API v1:** `{{ site.url }}{{ site.baseurl }}/api/v1`

Otras formas de usar los mismos datos (bibliotecas de Python y JavaScript, módulo de Odoo, servidor MCP, agente A2A): [todas las integraciones]({{ '/integraciones/' | relative_url }}).

## Descubrimiento para agentes

| Recurso | URL | Uso |
| --- | --- | --- |
| OpenAPI | `/openapi.json` | Descripción de las rutas de la API, legible por máquinas. |
| Catálogo de la API | `/.well-known/api-catalog` | Catálogo según el RFC 9727, con enlaces a la documentación, el estado y OpenAPI. |
| Tarjeta del agente | `/.well-known/agent-card.json` | Tarjeta A2A (*agent card*) del agente de tasas (`https://mcp.bcv.today/a2a`). |
| Índice para LLM | `/llms.txt` | Resumen corto para agentes y LLMs. |
| Contexto completo para LLM | `/llms-full.txt` | Toda la documentación en un solo archivo de texto. |
| Tarjeta del servidor MCP | `/.well-known/mcp/server-card.json` | Tarjeta del servidor MCP (dirección, transporte y herramientas). |

### WebMCP en el navegador {#webmcp}

En los navegadores con WebMCP (`navigator.modelContext`), cada página de bcv.today registra cinco herramientas de solo lectura para el agente que navega contigo: `get_latest_bcv_rates`, `get_bcv_api_status`, `get_bcv_rate_history`, `get_bcv_rate_by_date` y `open_bcv_api_docs`. Leen la misma API pública y no hay que configurar nada; los navegadores sin WebMCP ni siquiera cargan el script. Código: [`site/assets/js/webmcp.js`](https://github.com/{{ site.repository }}/blob/main/site/assets/js/webmcp.js). Especificación: [WebMCP](https://webmachinelearning.github.io/webmcp/).

## Servidor MCP

Servidor remoto [Model Context Protocol](https://modelcontextprotocol.io) para asistentes y agentes de IA (Claude, ChatGPT, Cursor, VS Code y otros). Es gratuito, de solo lectura, sin estado y sin autenticación; usa los mismos datos de esta API.

**Dirección (Streamable HTTP):** `https://mcp.bcv.today/mcp`

| Herramienta | Qué hace |
| --- | --- |
| `get_latest_rates` | Tasas oficiales vigentes (USD, EUR, CNY, TRY, RUB) con fecha valor. |
| `get_rate_by_date` | Tasa vigente en un día (`YYYY-MM-DD`); explica el arrastre de fines de semana y feriados. |
| `get_history` | Serie diaria de una moneda (últimos N días o rango `from`/`to`) con mínimo, máximo y variación %. |
| `convert` | Convierte un monto entre VES, USD, EUR, CNY, TRY y RUB, con la tasa actual o la de una fecha. |
| `get_status` | Actualidad de los datos: última captura, fecha valor y monedas disponibles. |

Claude Code:

```bash
claude mcp add --transport http bcv-today https://mcp.bcv.today/mcp
```

Claude Desktop / claude.ai: **Ajustes → Conectores → Añadir conector personalizado** con la URL `https://mcp.bcv.today/mcp`.

Otros clientes (Cursor, VS Code, Windsurf…), en su archivo de configuración MCP:

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

Los clientes que solo admiten stdio pueden usar el puente `npx -y mcp-remote https://mcp.bcv.today/mcp`.

## Biblioteca de Python

Cliente oficial en [PyPI](https://pypi.org/project/bcv/), sin dependencias (Python 3.9+), con caché, `Decimal`, arrastre de fines de semana y línea de comandos (`bcv latest`, `bcv convert 100 USD VES`). Proyecto no oficial: no está afiliado al Banco Central de Venezuela.

```bash
pip install bcv
```

```python
from bcv import BCV

client = BCV()
print(client.latest()["USD"])                  # Bs. por dólar
print(client.on("2026-01-04", "USD"))          # domingo: usa la tasa con fecha valor 2026-01-03
print(client.convert(100, "USD", "VES"))
```

Código y documentación: [packages/python en GitHub](https://github.com/{{ site.repository }}/tree/main/packages/python).

## JavaScript / TypeScript {#javascript}

Cliente oficial en [npm](https://www.npmjs.com/package/bcv-today) (`bcv-today`), sin dependencias, con tipos de TypeScript, módulos ESM y CommonJS, caché, conversiones con aritmética decimal exacta (redondeo de la mitad hacia arriba), arrastre de fines de semana y línea de comandos (`npx bcv-today convert 100 USD VES`). Funciona en Node.js 18+, Deno, Bun, navegadores y Cloudflare Workers. Proyecto no oficial: no está afiliado al Banco Central de Venezuela.

```bash
npm install bcv-today
```

```js
import { BCV } from "bcv-today";

const bcv = new BCV();
console.log((await bcv.latest()).rates.USD);                  // Bs. por dólar
console.log((await bcv.on("2026-01-04", "USD")).effectiveDate); // domingo: "2026-01-03"
console.log((await bcv.convert(100, "USD", "VES")).resultText); // "91664.77"
```

Código y documentación: [packages/js en GitHub](https://github.com/{{ site.repository }}/tree/main/packages/js).

## Módulo de Odoo {#odoo}

Módulo [`l10n_ve_bcv_rate`](https://apps.odoo.com/apps/modules/l10n_ve_bcv_rate), gratuito, que actualiza a diario las tasas de cada compañía en Odoo con la tasa oficial del BCV leída de esta API (USD, EUR, CNY, TRY y RUB), con la fecha valor como fecha de la tasa. Funciona con compañías en bolívares o en divisas, permite cargar el histórico desde 2021-08-02 y no necesita claves ni paquetes Python adicionales.

- **Versiones:** Odoo 16.0, 17.0, 18.0, 19.0 y 20.0, Community y Enterprise, en Odoo.sh o servidor propio.
- **No disponible en Odoo Online** (SaaS), que no admite módulos de terceros.
- **Instalación:** copia `l10n_ve_bcv_rate/` (de la rama de tu versión) en tu carpeta de addons, actualiza la lista de aplicaciones e instálalo desde *Aplicaciones*; luego actívalo en *Ajustes › Contabilidad › Monedas*.

Descarga: [Odoo Apps](https://apps.odoo.com/apps/modules/l10n_ve_bcv_rate) · Código: [grupoclip/odoo-bcv-rate en GitHub](https://github.com/grupoclip/odoo-bcv-rate) (ramas `16.0` a `20.0`).

## Agente A2A

Agente [Agent2Agent (A2A)](https://a2a-protocol.org) para que otros agentes consulten las tasas. Es determinista (sin LLM), gratuito, sin estado y sin autenticación, y usa la misma lógica que el servidor MCP.

**Dirección (JSON-RPC 2.0, A2A 1.0 y 0.3):** `https://mcp.bcv.today/a2a`

**Tarjeta del agente (*agent card*):** [`/.well-known/agent-card.json`]({{ site.url }}{{ site.baseurl }}/.well-known/agent-card.json) (también en `https://mcp.bcv.today/.well-known/agent-card.json`)

| Habilidad | Ejemplo en texto | Ejemplo con DataPart |
| --- | --- | --- |
| `latest-rates` | «¿Cuál es la tasa del dólar BCV hoy?» | `{"skill":"latest-rates","currency":"USD"}` |
| `rate-on-date` | «tasa del 2026-01-04» | `{"skill":"rate-on-date","date":"2026-01-04"}` |
| `convert` | «convertir 100 USD a VES», «100 dólares en bolívares» | `{"skill":"convert","amount":100,"from":"USD","to":"VES"}` |
| `history` | «historial del dólar últimos 7 días» | `{"skill":"history","currency":"USD","days":7}` |
| `status` | «estado de los datos» | `{"skill":"status"}` |

Entiende español e inglés. Las respuestas son una tarea completada (`TASK_STATE_COMPLETED`) con un artefacto que trae un resumen en texto y un DataPart con el JSON estructurado; si no entiende la consulta, responde con un mensaje que explica lo que sabe hacer. No envía respuestas parciales (*streaming*) ni notificaciones push, y las tareas no se guardan (`GetTask` responde `TaskNotFound`).

```bash
curl -s https://mcp.bcv.today/a2a \
  -H 'Content-Type: application/json' -H 'A2A-Version: 1.0' \
  -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"role":"ROLE_USER","messageId":"1","parts":[{"text":"convertir 100 USD a VES"}]}}}'
```

Los clientes A2A 0.3 pueden usar `message/send` (sin la cabecera `A2A-Version`).

## Rutas

### Tasa actual

<div class="endpoint">
  <span class="method">GET</span>
  <span class="path">/api/v1/rate.json</span>
</div>

Devuelve la tasa vigente para el día actual. El archivo se regenera cada vez que corre el script de captura, y el repositorio solo se actualiza cuando cambian los archivos de `api/v1/`.

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

Devuelve hasta las últimas 1830 entradas diarias, ordenadas de la más antigua a la más reciente. Este archivo alimenta la gráfica y la tabla del histórico en el sitio.

**Ejemplo:**

```bash
curl -s {{ site.url }}{{ site.baseurl }}/api/v1/history.json
```

### Estado de la API

<div class="endpoint">
  <span class="method">GET</span>
  <span class="path">/api/v1/status.json</span>
</div>

Devuelve el estado de los datos publicados, la fecha de vigencia, la hora de generación y las monedas disponibles.

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

Devuelve la copia guardada de una fecha del calendario de Caracas (`America/Caracas`). Las copias diarias usan el mismo formato base que `rate.json`, pero las entradas antiguas pueden omitir monedas que no estaban disponibles en la fuente original.

| Parámetro | Tipo | Descripción |
| --- | --- | --- |
| `YYYY-MM-DD` | ruta | Fecha en formato ISO 8601, por ejemplo `2026-05-11`. |

**Ejemplo:**

```bash
curl -s {{ site.url }}{{ site.baseurl }}/api/v1/history/2026-05-11.json
```

Devuelve `404` si la fecha solicitada no existe en el repositorio.

## Esquema de respuesta

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `USD` | número | Tasa en bolívares por 1 dólar estadounidense. |
| `EUR` | número | Tasa en bolívares por 1 euro. Siempre presente en `rate.json`; puede estar omitido en históricos antiguos si no estaba disponible en la fuente. |
| `CNY` | número | Tasa en bolívares por 1 yuan chino. Siempre presente en `rate.json`; puede estar omitido en históricos antiguos si no estaba disponible en la fuente. |
| `TRY` | número | Tasa en bolívares por 1 lira turca. Siempre presente en `rate.json`; puede estar omitido en históricos antiguos si no estaba disponible en la fuente. |
| `RUB` | número | Tasa en bolívares por 1 rublo ruso. Siempre presente en `rate.json`; puede estar omitido en históricos antiguos si no estaba disponible en la fuente. |
| `updated_at` | texto (ISO 8601) | Momento en UTC en que el script de captura obtuvo el dato. |
| `date` | texto (`YYYY-MM-DD`) | Día calendario representado por el archivo. En los archivos históricos por día coincide con el nombre del archivo. |
| `effective_date` | texto (`YYYY-MM-DD`) | Fecha de vigencia oficial publicada por el BCV (`Fecha Valor`). En fines de semana y feriados puede apuntar al día hábil anterior cuya tasa sigue vigente. |
| `source` | texto | Campo opcional presente en algunas entradas históricas importadas. |

> El BCV suele publicar la tasa los días hábiles alrededor de las **16:30 hora de Caracas**, con vigencia para el **siguiente día hábil**. La publicación del viernes normalmente aplica para el lunes; si el lunes es feriado, aplica para el siguiente día hábil.
>
> Sábados, domingos y feriados normalmente no tienen una nueva publicación del BCV. El script de captura rellena los días calendario faltantes con la tasa más reciente cuyo `effective_date` sea menor o igual a ese día.

## Ejemplos de uso

### Insignias

Puedes mostrar el estado de la API o la tasa USD en un README, panel interno
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
- Para obtener siempre la versión más reciente, usa `cache: "no-cache"` con `fetch` o envía `Cache-Control: no-cache` con cURL.
- También puedes leer los archivos a través de jsDelivr:
  `https://cdn.jsdelivr.net/gh/{{ site.repository }}/site/api/v1/rate.json`.

## Identificación del bot {#web-bot-auth}

Los datos se obtienen de la página pública de `https://www.bcv.org.ve/`, cada 30 minutos, identificándose con el agente de usuario (`User-Agent`) `python-requests/<versión> (BCVTodayBot; +https://bcv.today/api/#web-bot-auth)`.

Cada solicitud va firmada con [Web Bot Auth](https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/) (HTTP Message Signatures, RFC 9421, Ed25519) e incluye las cabeceras `Signature-Agent: "https://bcv.today"`, `Signature-Input` y `Signature`.

- Directorio de claves: [`/.well-known/http-message-signatures-directory`](/.well-known/http-message-signatures-directory)
- `keyid`: `JkYyrLLVt1MPLEk4CLTRkklkKSqbqoWL_dyy6JRy3vc`

## Cambios y soporte

El código fuente y el historial de cambios están en [github.com/{{ site.repository }}](https://github.com/{{ site.repository }}).

Reporta errores o pide cambios en [GitHub](https://github.com/{{ site.repository }}/issues).
