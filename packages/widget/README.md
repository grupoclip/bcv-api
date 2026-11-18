# bcv-today-widget

`<bcv-rate>`: an embeddable web component with the official exchange rate published by Banco Central de Venezuela
(BCV) for USD, EUR, CNY, TRY and RUB against the bolivar (VES), from the [BCV Today API](https://bcv.today/api/).

> **Unofficial, not affiliated with Banco Central de Venezuela.** BCV Today republishes the rates that BCV publishes on
> its website. Data: [CC BY 4.0](https://bcv.today/licencia/), attribution "BCV Today (https://bcv.today), data from
> Banco Central de Venezuela".

- One script tag, no dependencies, about 5 KB min+gzip.
- Three variants: a card, an inline pill for sentences, and a live converter to bolivars.
- Spanish and English, light and dark, follows the page language and the system color scheme by default.
- The rate, its effective date ("Fecha valor") and the change from the previous effective rate.
- Shadow DOM: your CSS does not leak in and the widget's CSS does not leak out; theme it with CSS custom properties
  and `::part()`.
- One request for every widget on the page, refreshed every 30 minutes while the page is visible, with the last good
  value kept in `localStorage` for when the API is unreachable.

## Usage

```html
<script type="module" src="https://bcv.today/widget/v1.js"></script>

<bcv-rate currency="USD"></bcv-rate>
<p>The euro is at <bcv-rate currency="EUR" variant="line" lang="en"></bcv-rate> today.</p>
<bcv-rate variant="converter" amount="100"></bcv-rate>
```

`https://bcv.today/widget/v1.js` always serves the latest backward-compatible version. With a bundler, install the
package and import it once; importing defines the element:

```bash
npm install bcv-today-widget
```

```js
import "bcv-today-widget";
```

The module can be imported during server-side rendering (it defines nothing without a DOM). It is also available
from npm CDNs, for example `https://cdn.jsdelivr.net/npm/bcv-today-widget@0.1.0`, if you prefer to pin a version.

## Attributes

| Attribute | Values | Default |
| --- | --- | --- |
| `currency` | `USD`, `EUR`, `CNY`, `TRY`, `RUB` | `USD` |
| `variant` | `card`, `line` (inline pill inside a sentence), `converter` (amount input to bolivars) | `card` |
| `lang` | `es`, `en` | the closest `lang` attribute on the page (`en*` is English), else `es` |
| `theme` | `auto` (follows `prefers-color-scheme`), `light`, `dark` | `auto` |
| `amount` | converter's initial amount, a plain number such as `100` or `1234.5` | `1` |
| `hide-source` | boolean: hides the "Fuente: BCV Today" / "Source: BCV Today" link | shown |
| `api` | data origin, for tests or a mirror | `https://bcv.today` |

All attributes can be changed at any time and the widget updates.

Numbers follow the language: Spanish uses the Venezuelan format (`916,6477`, `1.007,3867`), English the US format
(`916.6477`, `1,007.3867`). Rates have 4 decimals and converted amounts 2. The converter accepts either convention as
typed: `1.234,5` and `1234.5` are both 1234.5. A single separator followed by exactly three digits is read with the
page language's convention: `1.234` is 1234 in Spanish and `1,234` is 1234 in English.

### Attribution and `hide-source`

The data is licensed under [CC BY 4.0](https://bcv.today/licencia/), which requires credit. The widget shows a small
"Fuente: BCV Today" link (to https://bcv.today, opening in a new tab) that satisfies it. If you add `hide-source`,
you must credit the source somewhere else on the same page, for example in your footer: "Tasas: BCV Today
(https://bcv.today), datos del Banco Central de Venezuela".

## Styling

| Custom property | Default (light / dark) |
| --- | --- |
| `--bcv-accent` | `#f2b33d`, the gold of the BCV Today mark (logo and focused input border) |
| `--bcv-bg` | `#fdfbf7` / `#1c1a18` |
| `--bcv-text` | `#1f1b16` / `#efe9de` |
| `--bcv-radius` | `12px` (card and converter); the inline pill is fully rounded unless set |
| `--bcv-font` | system UI font (the `line` variant inherits the surrounding font); numbers are always monospace |

Set them on the element or any ancestor. `--bcv-bg` and `--bcv-text` replace both the light and the dark value, so
choose a pair with enough contrast or set them per theme.

```css
bcv-rate {
  --bcv-radius: 4px;
  --bcv-font: "Inter", sans-serif;
}
bcv-rate::part(value) {
  font-weight: 700;
}
```

Parts: `container`, `label`, `value`, `change`, `date`, `note` (cached notice), `source`, `mark`, `status` (loading
and error text), and for the converter `input` and `result`.

## Behavior

- **Data:** `GET {api}/api/v1/rate.json`, then the day files `{api}/api/v1/history/YYYY-MM-DD.json`, walking back
  from the effective date up to 5 days to find the previous effective rate for the change. Every `<bcv-rate>` with the
  same `api` shares the same requests. While the page is visible, data is refreshed every 30 minutes (one request
  when the effective date has not changed).
- **Offline:** if the API fails, the widget shows the last good value saved in `localStorage` and says it is cached
  ("Dato guardado: no se pudo actualizar."). With nothing saved, it shows a short error text. Storage errors (private
  mode, blocked storage) are ignored.
- **Accessibility:** real text (no images of numbers), `role="group"` with an accessible name such as "Tasa BCV: Dólar
  (USD)", a labeled input and an `aria-live` result in the converter, the change direction spelled out for screen
  readers, visible focus rings, contrast of at least 4.5:1 in both themes, works from 320 px wide, and no animation
  with `prefers-reduced-motion: reduce`.
- **Security:** the markup is built with DOM APIs, never by parsing HTML, so it works with Trusted Types and a strict
  Content Security Policy (`script-src https://bcv.today`, `connect-src https://bcv.today`).

Browsers: current Chrome, Edge, Firefox and Safari (custom elements, Shadow DOM, container queries).

## En español

`<bcv-rate>` es un componente web para mostrar la tasa oficial del Banco Central de Venezuela en cualquier página,
con datos de [BCV Today](https://bcv.today). **Proyecto no oficial, no afiliado al Banco Central de Venezuela.** Datos
bajo [CC BY 4.0](https://bcv.today/licencia/).

```html
<script type="module" src="https://bcv.today/widget/v1.js"></script>
<bcv-rate currency="USD"></bcv-rate>
<p>El dólar está en <bcv-rate variant="line"></bcv-rate> hoy.</p>
<bcv-rate variant="converter" amount="100"></bcv-rate>
```

Muestra la tasa, la fecha valor y la variación frente a la tasa anterior, en español o inglés (según el `lang` de la
página), con tema claro u oscuro. El convertidor acepta montos como `1.234,5` o `1234.5`. Si usas `hide-source` para
ocultar el enlace "Fuente: BCV Today", la licencia CC BY 4.0 te obliga a dar el crédito en otro lugar de la misma
página. Más integraciones (JavaScript, Python, Odoo, MCP): https://bcv.today/integraciones/

## Development

```bash
npm ci
npm run lint && npm run typecheck
npm test              # build + unit tests (Node >= 22.18)
npm run size          # bundle size, fails above 6 KB min+gzip
npm run build:site    # copy the bundle to site/widget/v1.js
PW_NODE_MODULES=/path/to/node_modules npm run test:browser   # Playwright + axe-core, see the test file
```

`demo/index.html` shows every variant in light and dark (open it through a local web server after `npm run build`).

## Links

- API docs: https://bcv.today/api/ · npm client: https://www.npmjs.com/package/bcv-today
- Source: https://github.com/grupoclip/bcv-api/tree/main/packages/widget · Issues: https://github.com/grupoclip/bcv-api/issues

## License

Code: Apache-2.0. Data: CC BY 4.0, BCV Today, from Banco Central de Venezuela.
