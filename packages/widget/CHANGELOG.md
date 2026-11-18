# Changelog

All notable changes to the `bcv-today-widget` npm package. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-18

### Added

- `<bcv-rate>` web component: the BCV exchange rate for USD, EUR, CNY, TRY or RUB with
  its effective date and the change from the previous effective rate.
- Variants `card`, `line` (inline pill) and `converter` (amount to bolivars, live).
- Spanish and English (`lang`, or the page language), es-VE and en-US number formats.
- Themes `auto`, `light` and `dark`; CSS custom properties `--bcv-accent`, `--bcv-bg`,
  `--bcv-text`, `--bcv-radius`, `--bcv-font` and `::part()` names.
- One shared request per data origin, 30-minute refresh while visible, last good value
  cached in `localStorage`.
- `hide-source` to hide the attribution link, and `api` to change the data origin.
- Single ESM file with type declarations and no dependencies, also served as
  https://bcv.today/widget/v1.js.

[0.1.0]: https://github.com/grupoclip/bcv-api/tree/main/packages/widget
