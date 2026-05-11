# BCV Today

> [bcv.today](https://bcv.today) - official Banco Central de Venezuela exchange rates, served as a static JSON API and dashboard.

BCV Today is an unofficial API and bilingual website for the exchange rates published by the [Banco Central de Venezuela](https://www.bcv.org.ve/). It tracks USD, EUR, CNY, TRY, and RUB against the Venezuelan bolivar, stores daily JSON snapshots, and publishes everything through GitHub Pages.

## Website

The public site is available at:

> https://bcv.today

Pages:

- `/` and `/en/` - latest rates dashboard with rate cards, daily variation, and a currency calculator.
- `/history/` and `/en/history/` - historical chart, current value, daily change, period change, and table view.
- `/api/` and `/en/api/` - API documentation with endpoints, response schema, and examples.

Features:

- **Static JSON API** - files are committed under `api/` and served directly by GitHub Pages.
- **Calendar history** - weekends and holidays are filled with the latest officially effective rate.
- **Bilingual UI** - Spanish and English strings live in `_data/i18n.yml`.
- **Light/dark mode** - follows `prefers-color-scheme` and stores manual selection in `localStorage`.
- **No server runtime** - the site is built with Jekyll; dashboard data is loaded client-side from JSON files.

## API Endpoints

Base URL:

```text
https://bcv.today
```

| Resource | Path | Description |
| --- | --- | --- |
| Latest rate | `/api/rate.json` | Today's current rate entry. |
| History index | `/api/history.json` | Up to the latest 365 daily entries. |
| History by date | `/api/history/YYYY-MM-DD.json` | One calendar-day snapshot. |

Example:

```bash
curl -s https://bcv.today/api/rate.json
```

Current response shape:

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

Fields:

- `USD`, `EUR`, `CNY`, `TRY`, `RUB` - bolivares per 1 unit of the foreign currency.
- `updated_at` - UTC timestamp when the scraper captured the rate.
- `date` - calendar date represented by the file.
- `effective_date` - official BCV validity date. On weekends and holidays this can point to the previous business day whose rate is still in effect.
- `source` - optional field present on some historical backfill entries.

## How The Data Works

`main.py` fetches `https://www.bcv.org.ve/`, parses the published currency blocks, and reads BCV's `Fecha Valor` when available.

On each run it:

1. Writes the canonical snapshot to `api/history/<effective-date>.json`.
2. Rebuilds calendar history from the earliest stored snapshot through today.
3. Fills weekends, holidays, and missing dates with the latest rate whose `effective_date` is less than or equal to that day.
4. Writes `api/rate.json` as today's current rate, filling missing currencies from the latest available source when older backfills only include USD/EUR.
5. Rebuilds `api/history.json` with the latest 365 entries.

BCV usually publishes on business days around 16:30 Caracas time, effective for the following business day. The workflow runs often and commits only when `api/` changes.

## Automation

Two GitHub Actions workflows keep the project updated and deployed:

- `.github/workflows/update-rate.yml`
  - Runs every 30 minutes.
  - Can be run manually with `workflow_dispatch`.
  - Also runs on pushes that change `main.py`, `requirements.txt`, or the workflow itself.
  - Installs Python dependencies, runs `python main.py`, commits changed `api/` files, and triggers the Pages deploy workflow.

- `.github/workflows/pages.yml`
  - Builds the Jekyll site with Ruby 3.3.
  - Deploys to GitHub Pages.
  - Runs on pushes to `main` and manual dispatch.

## Local Development

Install Python dependencies and update the local JSON files:

```bash
pip install -r requirements.txt
python main.py
```

Preview the website locally:

```bash
bundle install
bundle exec jekyll serve --baseurl ""
```

Then open:

```text
http://127.0.0.1:4000
```

## Project Structure

```text
.
api/                  # Published JSON API files
  rate.json
  history.json
  history/
assets/
  css/style.css
  js/dashboard.js
  js/history.js
  logo.svg
_data/i18n.yml        # Spanish and English UI strings
_layouts/default.html # Shared Jekyll layout
index.html            # Spanish dashboard
history.html          # Spanish history page
en/                   # English pages
main.py               # BCV scraper and JSON writer
requirements.txt
```

## Repository Setup

For a fork or new deployment:

1. Enable GitHub Pages with **Settings -> Pages -> Build and deployment -> GitHub Actions**.
2. Allow workflow writes with **Settings -> Actions -> General -> Workflow permissions -> Read and write permissions**.
3. Update `_config.yml` if the domain, base URL, or repository name changes.
4. Update `CNAME` if using a custom domain.

## Disclaimer

This project is not affiliated with the Banco Central de Venezuela. Rates are scraped from the public BCV website and provided as-is, without uptime, accuracy, or financial-use guarantees. Verify against the official BCV source before relying on the data.

## License

See [LICENSE](LICENSE).
