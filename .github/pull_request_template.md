## What and why

<!-- A short summary of the change and the problem it solves. Link the issue if there is one (Fixes #123). -->

## Area

<!-- Check all that apply. -->

- [ ] Website (`site/`)
- [ ] API data or scraper (`scraper/`, `site/api/v1/`)
- [ ] Python package (`packages/python/`)
- [ ] npm package (`packages/js/`)
- [ ] MCP / A2A Worker (`packages/mcp/`)
- [ ] Workflows or docs

## Checks

- [ ] The change is focused; unrelated rate data refreshes are not included.
- [ ] Tests and linters for the touched package pass (see its README).
- [ ] The public API `/api/v1/` keeps its fields and paths, or `openapi.json`, the API docs and `llms.txt` are updated.
- [ ] Spanish and English versions are both updated (if the change has text).

### Accessibility (for interface changes)

See [ACCESSIBILITY.md](../ACCESSIBILITY.md#contributor-expectations).

- [ ] Works with the keyboard only, with a visible focus indicator.
- [ ] Checked in light and dark theme, and at 200% zoom or a phone-width window.
- [ ] An automated checker (axe DevTools or Lighthouse) reports no new problems.
- [ ] Images, icons and buttons have a text alternative, or are hidden when decorative.

## How it was tested

<!-- Commands you ran and what you checked by hand. Screenshots for visible UI changes help. -->
