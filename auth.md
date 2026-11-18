# bcv.today auth.md

This file tells AI agents, scripts and other automated clients how to authenticate to BCV Today. The short answer: you don't. There is nothing to register for and nothing to authenticate.

BCV Today (https://bcv.today) is an unofficial website and a free, public, read-only JSON API with the official exchange rates published by Banco Central de Venezuela (USD, EUR, CNY, TRY and RUB against the bolívar). It is not affiliated with the bank.

## Audience

- AI agents acting for a user who wants Venezuelan official exchange rates.
- Scripts, bots, spreadsheets and apps that read the rates on a schedule.
- Developers evaluating the API.

## Authentication

- No authentication of any kind. Access is anonymous and read-only.
- No registration, account, API key, client ID, client secret, bearer token, cookie or session is needed or accepted.
- Do not send an `Authorization` header. It is ignored.
- Every endpoint is a static JSON file served over HTTPS by GitHub Pages behind Cloudflare, with `Access-Control-Allow-Origin: *`.

## Registration, claim and revocation

There are no registration, provisioning, claim or revocation endpoints, by design. Because no credentials are ever issued, there is nothing to obtain, claim, rotate or revoke.

Agents must not attempt:

- OAuth 2.0 or OpenID Connect discovery (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/.well-known/openid-configuration`). These documents do not exist.
- Dynamic client registration.
- Token exchange, identity assertion (ID-JAG) or any other credential flow.
- Requests to `POST /agent/auth` or similar registration endpoints. They do not exist.

## Using the API

Base URL: `https://bcv.today`

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/v1/rate.json` | The rate currently in effect |
| GET | `/api/v1/history.json` | Index of recent daily entries |
| GET | `/api/v1/history/{YYYY-MM-DD}.json` | Snapshot for one calendar day |
| GET | `/api/v1/status.json` | Freshness, effective date and supported currencies |

Example:

```sh
curl -s https://bcv.today/api/v1/rate.json
```

Only `GET` (and `HEAD`) make sense; the files are static and nothing can be written.

## Caching

- The bank publishes new rates on business days, so the rates change at most once per business day. Polling more often than that gains nothing.
- Responses pass through the GitHub Pages and Cloudflare caches. For a fresh read, send `Cache-Control: no-cache` (or use `cache: "no-cache"` with `fetch`).
- `effective_date` is the official validity date; `updated_at` is the UTC capture time. On weekends and holidays the previous business day's rate may remain in effect.

## Courtesy

Not required, but appreciated: send a descriptive `User-Agent` that names your agent or app and a way to reach you, and cache responses on your side.

## More information

- [llms.txt](https://bcv.today/llms.txt): agent index for the site
- [OpenAPI description](https://bcv.today/openapi.json): machine-readable description of the endpoints
- [Agent card](https://bcv.today/.well-known/agent-card.json): A2A AgentCard of the rates agent at https://mcp.bcv.today/a2a (no authentication: empty `securitySchemes` and `securityRequirements`)
- [API catalog](https://bcv.today/.well-known/api-catalog): RFC 9727 linkset
- [API documentation](https://bcv.today/api/) ([English](https://bcv.today/en/api/), [Markdown](https://bcv.today/api/index.md))
- [Source code](https://github.com/grupoclip/bcv-api): report problems in the repository's issues
