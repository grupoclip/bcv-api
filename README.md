# bcv-api

Unofficial JSON API for the official exchange rates published by the [Banco Central de Venezuela](https://www.bcv.org.ve/) — USD, EUR, CNY (yuan), TRY (lira), and RUB (rublo). A GitHub Actions workflow scrapes the BCV homepage on a schedule and commits the values back to this repository, so the JSON files are served directly from GitHub.

## Website

A Jekyll site is published via GitHub Pages at:

> https://bcv.today

Pages:

- `/` and `/en/` — dashboard that fetches `api/rate.json` and renders the latest rates.
- `/api/` and `/en/api/` — full API documentation with endpoints, schema, and code examples.

Features:

- **Localization (ES/EN)** — strings live in `_data/i18n.yml`; each page declares `lang` and `alt_url` so the header switcher links to its counterpart.
- **Light/dark mode** — defaults to `prefers-color-scheme`, with a header toggle that persists the user's choice in `localStorage`. A pre-paint script in the layout reads it back to avoid a flash.
- **Code highlighting** — Rouge via kramdown, with a custom token palette in `assets/css/style.css` that adapts to both themes.
- **Logo and favicon** — `assets/logo.svg`, used inline in the header and as a `rel="icon"` link.

The site is built and deployed by `.github/workflows/pages.yml`, using the official Pages Jekyll workflow (`actions/configure-pages`, `actions/upload-pages-artifact`, `actions/deploy-pages`).

To enable it on a fork: **Settings → Pages → Build and deployment** → source **GitHub Actions**. The rate-update workflow triggers the Pages deploy after each commit.

### Local preview

```bash
bundle install
bundle exec jekyll serve --baseurl ""
```

## Endpoints

Files are committed under `api/` and served from the custom domain (or via [jsDelivr](https://www.jsdelivr.com/) for CDN caching).

| Resource           | Path                              | URL                                              |
| ------------------ | --------------------------------- | ------------------------------------------------ |
| Latest rate        | `api/rate.json`                   | https://bcv.today/api/rate.json                  |
| History (per day)  | `api/history/<YYYY-MM-DD>.json`   | https://bcv.today/api/history/2026-05-09.json    |

### Response shape

```json
{
  "USD": 500.4606,
  "EUR": 589.27233807,
  "CNY": 69.4823,
  "TRY": 12.9412,
  "RUB": 5.6231,
  "updated_at": "2026-05-09T16:52:48.996037+00:00",
  "date": "2026-05-09"
}
```

- `USD`, `EUR`, `CNY`, `TRY`, `RUB` — bolívar quote per 1 unit of the foreign currency (US dollar, euro, Chinese yuan, Turkish lira, Russian ruble).
- `updated_at` — ISO 8601 UTC timestamp of the moment the scrape ran.
- `date` — Venezuela local date (`America/Caracas`) the snapshot belongs to. Matches the filename in `api/history/`.

> BCV publishes each day's rate around 16:00 Venezuela time *for the next business day*. The workflow scrapes after the publish window, so the value in `rate.json` is the rate that becomes effective the following business day.

## How it works

1. `main.py` fetches `https://www.bcv.org.ve/` and parses the `#dolar`, `#euro`, `#yuan`, `#lira`, and `#rublo` blocks with BeautifulSoup.
2. The values are written to `api/rate.json` and `api/history/<date>.json`.
3. `.github/workflows/update-rate.yml` runs the script on a cron, then commits and pushes the changes if either file changed.

The history file for a given day is overwritten by later runs that same day — only the latest snapshot of the day is kept.

## Schedule

The workflow runs:

- On a cron — `0 21 * * 1-5` (21:00 UTC = 17:00 Venezuela, Monday–Friday). BCV publishes the next day's rate around 16:00 Venezuela; the cron fires roughly an hour later as a buffer.
- On manual dispatch from the **Actions** tab (`workflow_dispatch`).
- On push to `main` when `main.py`, `requirements.txt`, or the workflow file changes.

## Running locally

Requires Python 3.10+.

```bash
pip install -r requirements.txt
python main.py
```

This writes `api/rate.json` and the corresponding `api/history/<date>.json` and prints the JSON to stdout.

## Repository setup

- **Settings → Actions → General → Workflow permissions** must allow read and write access (the rate-update workflow declares `contents: write` and `actions: write`).
- **Settings → Pages → Build and deployment** → source **GitHub Actions**.

## Disclaimer

This project is not affiliated with the Banco Central de Venezuela. Rates are scraped from the public BCV homepage and provided as-is, without uptime or accuracy guarantees. Verify against the official source before using these values for anything that matters.

## License

See [LICENSE](LICENSE).
