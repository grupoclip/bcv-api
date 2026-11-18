# Accessibility

BCV Today publishes the official Banco Central de Venezuela exchange rates for
anyone who needs them: people checking today's dollar rate on a phone, people
using a screen reader or only a keyboard, and developers or AI agents reading
the API. Everyone should be able to get the rate, convert an amount and read
the history, and everyone should be able to contribute.

This document covers what we aim for, what we check, the limitations we know
about and how to report a barrier. If something on [bcv.today](https://bcv.today)
or in one of the packages gets in your way, please
[tell us](#reporting-accessibility-issues): it is a bug.

_En español: si algo del sitio o de las librerías te impide usarlo, abre un
[reporte de accesibilidad](https://github.com/grupoclip/bcv-api/issues/new?template=accessibility.md).
Puedes escribir en español o en inglés._

## Priorities

Our target is the [Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/)
at level AA. This is a goal, not a conformance claim: the site has not had a
formal audit.

In practice we prioritize the main tasks, in this order:

1. Reading today's rates and their effective date.
2. Converting an amount between bolívars and another currency.
3. Reading the history, both the chart and the table with the same data.
4. Using the API documentation, including copying code examples.

What the site does today:

- Every page has a "skip to content" link, a logical heading order and the
  correct language (`es` or `en`).
- Everything works with a keyboard, with a visible focus indicator. Tabs
  follow the WAI-ARIA tabs pattern.
- The history chart has a text description and the same data in a table with
  a caption.
- Copy and share buttons announce their result to screen readers.
- Light and dark themes follow the system setting and can be switched by hand.
  Text colors are chosen to reach at least 4.5:1 contrast.
- With "reduce motion" or data saver on, the decorative glass effect on the
  header is not loaded.
- Every page has a plain Markdown version (request it with
  `Accept: text/markdown`, or add `index.md` to the URL), and the rates are
  available as plain JSON. Some people find these easier to read with
  assistive technology.
- The Python and JavaScript command-line tools print plain text, or JSON
  with `--json`, with no color codes or animations.

## Contributor expectations

Changes to the website should keep the main tasks above working for
everyone. Before opening a pull request that changes the interface:

- Go through the change with the keyboard only (Tab, Shift+Tab, Enter,
  Space, arrow keys where relevant).
- Check it in both the light and the dark theme, and at 200% zoom or a
  narrow (phone) window.
- Run an automated checker such as [axe DevTools](https://www.deque.com/axe/devtools/)
  or Lighthouse on the pages you changed.
- Give images, icons and buttons a text alternative, or hide them from
  assistive technology when they are decorative.
- Update both the Spanish and the English pages.

The pull request template asks you to confirm these checks. Automated tools
find only part of the problems, so describe what you checked by hand.

## Reporting accessibility issues

Open an [accessibility report](https://github.com/grupoclip/bcv-api/issues/new?template=accessibility.md)
on GitHub. It helps to include:

- What you were trying to do (for example "convert 100 dollars").
- The page address.
- What happened, and what you expected.
- Your browser, operating system and any assistive technology (for example
  NVDA, VoiceOver, TalkBack, screen magnification, voice control).

Screenshots or recordings are welcome but never required. You don't need to
know which guideline is involved.

### Severity

- **Critical:** you can't complete one of the main tasks (for example, a
  screen reader doesn't read the rate, or the converter can't be used with a
  keyboard).
- **High:** you can complete the task, but only with a lot of effort or a
  workaround.
- **Medium:** a part of the site is hard to use, but the main tasks work.
- **Low:** a minor problem that doesn't block anything.

### How we respond

BCV Today is maintained by a small team of volunteers. We aim to:

- Acknowledge a report within 7 days.
- Fix critical and high severity issues first, ahead of new features.
- Suggest a workaround when one exists (for example the Markdown or JSON
  version of a page).
- Ask you to confirm the fix when it is published, if you want to.

### Resolution expectations

We don't commit to fixed deadlines. Critical issues are worked on as soon as
they are confirmed. If a fix will take longer, we say so in the issue and keep
it updated.

## Ownership and maintenance

The maintainers of [grupoclip/bcv-api](https://github.com/grupoclip/bcv-api)
are responsible for accessibility in this repository: the website, the API
documentation and the Python, JavaScript and MCP packages.

### Responsibilities

- Triage accessibility reports and assign a severity.
- Review pull requests that change the interface with the checks above.
- Keep this document up to date. We review it at least once a year and
  whenever the site's design changes.

## Supported environments

The site is built for current versions of Chrome, Edge, Firefox and Safari,
on desktop and on phones. What has been tested:

- Chromium at desktop and phone widths, with automated browser tests of the
  theme switch, the skip link, the tabs, the copy and share buttons and the
  absence of horizontal scrolling.
- Keyboard-only navigation of those same features.
- Automated checks with axe-core (WCAG 2.2 A and AA rules, plus best
  practices) on the main pages, in both themes.

Firefox and Safari are supported but not tested on every change.

We haven't yet tested systematically with screen readers (NVDA, JAWS,
VoiceOver, TalkBack) or voice control. Reports from people who use them are
especially welcome.

## Known limitations

- The history chart shows trends visually. The exact values are in the
  table below it, which is the best way to read them with a screen reader.
- The glass effect on the header uses WebGL. It is purely decorative and is
  skipped when "reduce motion" or data saver is on, but on older devices it
  may make scrolling less smooth.
- The source data comes from the Banco Central de Venezuela website, which
  we don't control. The bank's own pages may have barriers that we can't fix.

There are no open accessibility issues right now. Known issues are tracked
with the `accessibility` label.

## Feedback

Suggestions to improve this document or how we work on accessibility are
welcome in a [GitHub issue](https://github.com/grupoclip/bcv-api/issues) or a
pull request. To report a barrier you are facing, please use the
[accessibility report](#reporting-accessibility-issues) instead, so it gets
triaged.
