# Security Policy

## Supported Project

Security reports are accepted for the current `main` branch of BCV Today.

BCV Today is a static JSON API and website published through GitHub Pages. The
public API currently lives under:

- `https://bcv.today/api/v1/rate.json`
- `https://bcv.today/api/v1/history.json`
- `https://bcv.today/api/v1/history/YYYY-MM-DD.json`
- `https://bcv.today/api/v1/status.json`

Older unversioned JSON paths are not supported as public API endpoints.

## Reporting a Vulnerability

Please report security issues privately through GitHub Security Advisories:

1. Open the repository on GitHub.
2. Go to **Security**.
3. Select **Report a vulnerability**.
4. Include enough detail to reproduce and assess the issue.

If GitHub Security Advisories are unavailable, open a minimal public issue that
states you need a private security contact, but do not include exploit details.

## What To Include

Helpful reports include:

- Affected URL, file, workflow, or dependency.
- Steps to reproduce.
- Expected impact.
- Any proof of concept, logs, screenshots, or request/response samples.
- Whether the issue is actively exploitable.

## Scope

In scope:

- Vulnerabilities in the static website or JSON API files.
- Vulnerabilities in the BCV scraper, data generation, or GitHub Actions
  workflows.
- Supply-chain issues in dependencies used to build or publish the project.
- Exposure of secrets, tokens, or repository automation credentials.
- Cross-site scripting, content injection, or unsafe generated content.

Out of scope:

- Issues in the official Banco Central de Venezuela website.
- Rate accuracy disputes unless caused by a security or integrity flaw in this
  project.
- Denial-of-service tests against GitHub Pages, GitHub Actions, Cloudflare, or
  third-party infrastructure.
- Social engineering, phishing, or physical attacks.
- Automated scanner findings without a practical impact explanation.

## Safe Harbor

Good-faith security research is welcome when it:

- Avoids privacy violations and data destruction.
- Does not degrade service availability.
- Does not access, modify, or exfiltrate data that is not necessary to prove the
  issue.
- Gives the maintainers reasonable time to investigate and fix the issue before
  public disclosure.

## Response Expectations

The maintainers aim to acknowledge valid reports within 7 days and provide an
initial assessment or follow-up questions as soon as practical.

Fix timelines depend on severity and availability. Critical issues affecting
published data integrity, deployment credentials, or user-facing script
execution will be prioritized.

## Public Disclosure

Please do not publicly disclose a vulnerability until a fix is released or the
maintainers have agreed on a disclosure timeline.

After a fix is available, disclosure may include:

- A GitHub Security Advisory.
- A changelog or release note.
- A public issue or pull request reference when appropriate.
