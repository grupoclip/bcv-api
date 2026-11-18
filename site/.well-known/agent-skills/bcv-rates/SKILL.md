---
name: bcv-rates
description: Use BCV Today to retrieve official Banco Central de Venezuela exchange
  rates for USD, EUR, CNY, TRY, and RUB against VES.
---

# BCV Today Rates

Use this skill when a user asks for official Banco Central de Venezuela exchange rates, BCV dollar data, or historical VES exchange-rate data.

## Sources

- Latest rates: `https://bcv.today/api/v1/rate.json`
- Recent history: `https://bcv.today/api/v1/history.json` (up to 1830 daily entries)
- Dated snapshot: `https://bcv.today/api/v1/history/{YYYY-MM-DD}.json`
- API status: `https://bcv.today/api/v1/status.json`
- OpenAPI description: `https://bcv.today/openapi.json`
- Human documentation: `https://bcv.today/api/`

## Usage Rules

- No authentication is required. Do not look for OAuth/OIDC discovery metadata or request tokens.
- Treat values as official BCV-published rates mirrored by an unofficial project.
- Prefer `effective_date` when explaining when a rate applies.
- Use `updated_at` only to describe when BCV Today captured or published the data.
- Explain that weekend or holiday rates may remain in effect from the previous business day.
- Older historical entries may omit currencies that were unavailable in the source data; currency fields are numeric when present.
- Do not invent currencies outside `USD`, `EUR`, `CNY`, `TRY`, `RUB`, and `VES`.
- Do not present BCV Today as affiliated with Banco Central de Venezuela.

## Common Tasks

For the current BCV dollar rate, fetch `rate.json` and read `USD`.

For recent trends, fetch `history.json`, filter entries with numeric values for the target currency, and compare dates in ascending order.

For a specific date, fetch `history/{YYYY-MM-DD}.json`. If it returns 404, explain that no snapshot is available for that calendar day.
