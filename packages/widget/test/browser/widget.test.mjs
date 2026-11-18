// Real-browser tests with Playwright (playwright-core + a local Chrome), against local fixtures.
//
//   PW_NODE_MODULES=/path/to/node_modules  (must contain playwright-core and axe-core)
//   CHROME_PATH=/path/to/chrome            (optional; defaults to Playwright's own Chromium)
//   SCREENSHOT_DIR=/path                   (optional; saves demo screenshots, light and dark)
//   npm run test:browser
//
// Skipped (not failed) when playwright-core is not installed.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FIXTURES = join(ROOT, "test/fixtures");
const require = createRequire(import.meta.url);

function resolve(name) {
  try {
    return require.resolve(name, { paths: [process.env.PW_NODE_MODULES ?? "", ROOT] });
  } catch {
    return undefined;
  }
}

const pwPath = resolve("playwright-core");
const axePath = resolve("axe-core/axe.min.js");
const skip = pwPath ? false : "playwright-core not found (set PW_NODE_MODULES)";

/** Static server: the package (dist/, demo/) and, on another port, the fixture API with CORS. */
function serve(handler) {
  const server = createServer(handler);
  return new Promise((r) =>
    server.listen(0, "127.0.0.1", () => r({ server, origin: `http://127.0.0.1:${server.address().port}` })),
  );
}

const TYPES = { ".js": "text/javascript", ".html": "text/html", ".json": "application/json" };
const api = { fail: false, hits: [] };
const pages = new Map();

let site;
let apiServer;
let browser;

async function startServers() {
  site = await serve((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    if (pages.has(path)) {
      res.writeHead(200, { "content-type": "text/html" }).end(pages.get(path));
      return;
    }
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT) || !existsSync(file) || !/\.(js|html)$/.test(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[file.slice(file.lastIndexOf("."))] }).end(readFileSync(file));
  });
  apiServer = await serve((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    api.hits.push(path);
    const headers = { "access-control-allow-origin": "*", "content-type": "application/json" };
    const file = join(FIXTURES, path);
    if (api.fail) res.writeHead(500, headers).end('{"error":"boom"}');
    else if (file.startsWith(FIXTURES) && existsSync(file)) res.writeHead(200, headers).end(readFileSync(file));
    else res.writeHead(404, headers).end("{}");
  });
}

/** Register a test page with the bundle loaded; elements get api= pointing at the fixture API. */
function page(name, body, { lang = "es", head = "" } = {}) {
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,">${head}<title>${name}</title></head>
<body>${body.replaceAll("<bcv-rate", `<bcv-rate api="${apiServer.origin}"`)}
<script type="module" src="/dist/bcv-rate.js"></script></body></html>`;
  pages.set(`/t/${name}`, html);
  return `${site.origin}/t/${name}`;
}

/** Open a page in a fresh context; records console errors and page errors. */
async function open(url, options = {}) {
  const context = options.context ?? (await browser.newContext(options.contextOptions));
  const p = await context.newPage();
  const errors = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(url);
  return { p, context, errors };
}

// Text content with no-break spaces (used to keep "▲ +0,10 %" together) read as plain spaces.
const text = async (p, selector) => (await p.locator(selector).first().textContent()).replace(/\u00a0/g, " ");

async function waitLoaded(p) {
  await p.waitForFunction(() =>
    [...document.querySelectorAll("bcv-rate")].every((el) =>
      el.shadowRoot?.querySelector("[part=value],[part=status].err"),
    ),
  );
}

async function axe(p) {
  await p.addScriptTag({ content: readFileSync(axePath, "utf8") });
  return p.evaluate(async () => {
    const r = await globalThis.axe.run(document, { resultTypes: ["violations"] });
    return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  });
}

describe("<bcv-rate> in Chrome", { skip }, () => {
  before(async () => {
    await startServers();
    const pw = await import(pathToFileURL(pwPath).href);
    const chromium = pw.chromium ?? pw.default.chromium;
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  });

  after(async () => {
    await browser?.close();
    site?.server.close();
    apiServer?.server.close();
  });

  test("card: rate, effective date and change, es and en", async () => {
    const url = page(
      "card",
      `<bcv-rate id="usd" currency="USD"></bcv-rate>
       <bcv-rate id="eur" currency="EUR" lang="en"></bcv-rate>
       <div lang="en-US"><bcv-rate id="inherit" currency="usd"></bcv-rate></div>`,
    );
    const { p, context, errors } = await open(url);
    await waitLoaded(p);
    assert.equal(await text(p, "#usd [part=value]"), "916,6477 Bs.");
    assert.equal(await text(p, "#usd [part=date]"), "Fecha valor 18/11/2026");
    assert.equal(await text(p, "#usd [part=change]"), "Variación frente a la tasa anterior: ▲ +0,9001 (+0,10 %)");
    assert.equal(await text(p, "#usd [part=label]"), "Dólar · USD");
    assert.equal(await text(p, "#eur [part=value]"), "1,007.3867 Bs.");
    assert.equal(await text(p, "#eur [part=date]"), "Effective 2026-11-18");
    assert.equal(await text(p, "#eur [part=change]"), "Change from the previous rate: ▼ -0.9247 (-0.09%)");
    // lang comes from the closest [lang] ancestor.
    assert.equal(await text(p, "#inherit [part=value]"), "916.6477 Bs.");
    // Accessible group name, attribution link.
    const group = p.locator("#usd [part=container]");
    assert.equal(await group.getAttribute("role"), "group");
    assert.equal(await group.getAttribute("aria-label"), "Tasa BCV: Dólar (USD)");
    assert.equal(await p.locator("#eur [part=container]").getAttribute("aria-label"), "BCV rate: Euro (EUR)");
    const link = p.locator("#usd [part=source]");
    assert.equal(await link.getAttribute("href"), "https://bcv.today");
    assert.equal(await link.getAttribute("target"), "_blank");
    assert.equal(await link.getAttribute("rel"), "noopener");
    assert.equal(await text(p, "#usd .src"), "Fuente: BCV Today");
    assert.equal(await text(p, "#eur .src"), "Source: BCV Today");
    assert.deepEqual(errors, []);
    await context.close();
  });

  test("line: inline pill inside a sentence", async () => {
    const url = page(
      "line",
      `<p>El dólar está en <bcv-rate id="l1" variant="line"></bcv-rate> hoy.</p>
       <p lang="en">The ruble is <bcv-rate id="l2" variant="line" currency="RUB"></bcv-rate> today.</p>`,
    );
    const { p, context, errors } = await open(url);
    await waitLoaded(p);
    const l1 = (await text(p, "#l1 [part=container]")).replace(/\s+/g, " ").trim();
    assert.equal(
      l1,
      "USD 916,6477 Bs. Variación frente a la tasa anterior: ▲ +0,10 % Fecha valor 18/11/2026 BCV Today",
    );
    const l2 = (await text(p, "#l2 [part=container]")).replace(/\s+/g, " ").trim();
    assert.equal(l2, "RUB 11.1719 Bs. Change from the previous rate: ▲ +0.72% Effective 2026-11-18 BCV Today");
    // Inline: the host flows with the text (display inline) and fits on one line at desktop width.
    assert.equal(await p.locator("#l1").evaluate((el) => getComputedStyle(el).display), "inline");
    assert.deepEqual(errors, []);
    await context.close();
  });

  test("converter: live math, both number conventions, invalid input, live region", async () => {
    const url = page(
      "converter",
      `<bcv-rate id="c1" variant="converter" amount="100"></bcv-rate>
       <bcv-rate id="c2" variant="converter" currency="EUR" lang="en" amount="2.5"></bcv-rate>`,
    );
    const { p, context, errors } = await open(url);
    await waitLoaded(p);
    const out = p.locator("#c1 [part=result]");
    const input = p.locator("#c1 [part=input]");
    assert.equal(await out.textContent(), "91.664,77 Bs.");
    assert.equal(await out.getAttribute("aria-live"), "polite");
    assert.equal(await input.inputValue(), "100");
    // The input has a visible label.
    assert.equal(await p.locator("#c1 label").textContent(), "Monto en USD");
    await input.fill("1.234,5");
    assert.equal(await out.textContent(), "1.131.601,59 Bs.");
    await input.fill("1234.5");
    assert.equal(await out.textContent(), "1.131.601,59 Bs.");
    await input.fill("abc");
    assert.equal(await out.textContent(), "Monto no válido");
    assert.equal(await input.getAttribute("aria-invalid"), "true");
    await input.fill("0,5");
    assert.equal(await out.textContent(), "458,32 Bs.");
    assert.equal(await input.getAttribute("aria-invalid"), "false");
    // English, EUR, amount attribute with a decimal point.
    const out2 = p.locator("#c2 [part=result]");
    assert.equal(await p.locator("#c2 [part=input]").inputValue(), "2.5");
    assert.equal(await out2.textContent(), "2,518.47 Bs.");
    await p.locator("#c2 [part=input]").fill("1,234.5");
    assert.equal(await out2.textContent(), "1,243,618.83 Bs.");
    assert.equal(await text(p, "#c2 [part=value]"), "1 EUR = 1,007.3867 Bs.");
    // Visible focus ring on the input.
    await p.locator("#c1 [part=input]").focus();
    const outline = await p.locator("#c1 [part=input]").evaluate((el) => getComputedStyle(el).outlineStyle);
    assert.equal(outline, "solid");
    // Changing the amount attribute updates the converter.
    await p.locator("#c1").evaluate((el) => el.setAttribute("amount", "10"));
    assert.equal(await out.textContent(), "9.166,48 Bs.");
    assert.deepEqual(errors, []);
    await context.close();
  });

  test("hide-source removes the attribution link", async () => {
    const url = page(
      "hide",
      `<bcv-rate id="a" hide-source></bcv-rate><bcv-rate id="b" variant="line" hide-source></bcv-rate>
       <bcv-rate id="c" variant="converter" hide-source></bcv-rate><bcv-rate id="d"></bcv-rate>`,
    );
    const { p, context } = await open(url);
    await waitLoaded(p);
    for (const id of ["a", "b", "c"]) assert.equal(await p.locator(`#${id} [part=source]`).count(), 0, id);
    assert.equal(await p.locator("#d [part=source]").count(), 1);
    await p.locator("#d").evaluate((el) => el.setAttribute("hide-source", ""));
    assert.equal(await p.locator("#d [part=source]").count(), 0);
    await context.close();
  });

  test("themes: auto follows prefers-color-scheme, light and dark force it, switching is live", async () => {
    const url = page(
      "theme",
      `<bcv-rate id="auto"></bcv-rate><bcv-rate id="light" theme="light"></bcv-rate>
       <bcv-rate id="dark" theme="dark"></bcv-rate>`,
    );
    const { p, context } = await open(url);
    await waitLoaded(p);
    const bg = (id) => p.locator(`#${id} [part=container]`).evaluate((el) => getComputedStyle(el).backgroundColor);
    const LIGHT = "rgb(253, 251, 247)";
    const DARK = "rgb(28, 26, 24)";
    await p.emulateMedia({ colorScheme: "light" });
    assert.deepEqual([await bg("auto"), await bg("light"), await bg("dark")], [LIGHT, LIGHT, DARK]);
    await p.emulateMedia({ colorScheme: "dark" });
    assert.deepEqual([await bg("auto"), await bg("light"), await bg("dark")], [DARK, LIGHT, DARK]);
    await p.locator("#light").evaluate((el) => el.setAttribute("theme", "dark"));
    assert.equal(await bg("light"), DARK);
    // Custom properties from the host page cross the shadow boundary; ::part() styles internals.
    await p.addStyleTag({
      content: "#auto{--bcv-bg:rgb(1, 2, 3);--bcv-radius:0px} #auto::part(value){color:rgb(4, 5, 6)}",
    });
    assert.equal(await bg("auto"), "rgb(1, 2, 3)");
    const radius = await p.locator("#auto [part=container]").evaluate((el) => getComputedStyle(el).borderRadius);
    assert.equal(radius, "0px");
    const color = await p.locator("#auto [part=value]").evaluate((el) => getComputedStyle(el).color);
    assert.equal(color, "rgb(4, 5, 6)");
    // Host page CSS does not leak in.
    await p.addStyleTag({ content: "p, span, a { color: red !important; font-size: 50px !important }" });
    const fs = await p.locator("#dark [part=value]").evaluate((el) => getComputedStyle(el).fontSize);
    assert.equal(fs, "32px");
    await context.close();
  });

  test("strict CSP with Trusted Types: renders and styles without inline styles or HTML parsing", async () => {
    const csp = `default-src 'none'; script-src 'self'; connect-src ${apiServer.origin}; style-src 'none'; img-src data:; require-trusted-types-for 'script'`;
    const url = page("csp", '<bcv-rate id="a"></bcv-rate><bcv-rate id="b" variant="converter"></bcv-rate>', {
      head: `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    });
    const { p, context, errors } = await open(url);
    await waitLoaded(p);
    assert.equal(await text(p, "#a [part=value]"), "916,6477 Bs.");
    assert.equal(await text(p, "#b [part=result]"), "916,65 Bs.");
    // The shadow stylesheet applied (constructable stylesheet, allowed under style-src 'none').
    const fs = await p.locator("#a [part=value]").evaluate((el) => getComputedStyle(el).fontFamily);
    assert.match(fs, /monospace/);
    assert.deepEqual(errors, []);
    await context.close();
  });

  test("one fetch for many elements", async () => {
    api.hits = [];
    const url = page("many", '<bcv-rate></bcv-rate><bcv-rate variant="line"></bcv-rate>'.repeat(4));
    const { p, context } = await open(url);
    await waitLoaded(p);
    assert.equal(api.hits.filter((h) => h.endsWith("/rate.json")).length, 1);
    assert.equal(api.hits.filter((h) => h.includes("/history/")).length, 1);
    await context.close();
  });

  test("API failure: last good value from localStorage, marked as cached; error text without cache", async () => {
    const url = page("cache", '<bcv-rate id="a"></bcv-rate><bcv-rate id="b" variant="line" lang="en"></bcv-rate>');
    const context = await browser.newContext();
    api.fail = false;
    const first = await open(url, { context });
    await waitLoaded(first.p);
    await first.p.close();
    api.fail = true;
    try {
      const { p } = await open(url, { context });
      await waitLoaded(p);
      assert.equal(await text(p, "#a [part=value]"), "916,6477 Bs.");
      assert.equal(await text(p, "#a [part=note]"), "Dato guardado: no se pudo actualizar.");
      assert.equal(await text(p, "#a [part=change]"), "Variación frente a la tasa anterior: ▲ +0,9001 (+0,10 %)");
      assert.equal(await text(p, "#b [part=note]"), "(Cached value: couldn't refresh.)");
      // A fresh browser profile has no cache: short error text.
      const fresh = await open(url);
      await waitLoaded(fresh.p);
      assert.equal(await text(fresh.p, "#a [part=status]"), "No se pudo cargar la tasa BCV.");
      assert.equal(await text(fresh.p, "#b [part=status]"), "Couldn't load the BCV rate.");
      // Only the failed requests are logged (by the browser), no script errors.
      assert.deepEqual(
        fresh.errors.filter((e) => !/Failed to load resource/.test(e)),
        [],
      );
      await fresh.context.close();
    } finally {
      api.fail = false;
      await context.close();
    }
  });

  test("320 px wide: no horizontal overflow; reduced motion: no animation", async () => {
    const { p, context } = await open(`${site.origin}/demo/index.html?api=${apiServer.origin}`, {
      contextOptions: { viewport: { width: 320, height: 800 }, reducedMotion: "reduce" },
    });
    await waitLoaded(p);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `overflows by ${overflow}px`);
    const animations = await p.evaluate(
      () => [...document.querySelectorAll("bcv-rate")].flatMap((el) => el.shadowRoot.getAnimations()).length,
    );
    assert.equal(animations, 0);
    await context.close();
  });

  for (const scheme of ["light", "dark"]) {
    test(`demo (${scheme}): renders, axe-core finds no violations, no console errors`, async () => {
      const { p, context, errors } = await open(`${site.origin}/demo/index.html?api=${apiServer.origin}`, {
        contextOptions: { colorScheme: scheme, viewport: { width: 1180, height: 900 }, reducedMotion: "reduce" },
      });
      await waitLoaded(p);
      assert.equal(await p.locator("bcv-rate [part=value]").count(), 17);
      if (axePath) assert.deepEqual(await axe(p), []);
      if (process.env.SCREENSHOT_DIR) {
        await p.screenshot({ path: join(process.env.SCREENSHOT_DIR, `bcv-rate-demo-${scheme}.png`), fullPage: true });
      }
      assert.deepEqual(errors, []);
      await context.close();
    });
  }
});
