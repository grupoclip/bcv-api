import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  BCV,
  BCVError,
  CURRENCIES,
  CurrencyNotAvailable,
  DateOutOfRange,
  DEFAULT_USER_AGENT,
  InvalidAmount,
  InvalidArgument,
  InvalidCurrency,
  InvalidDate,
  NotFound,
  UpstreamError,
  VERSION,
} from "../../dist/index.js";
import { fakeFetch, NOW, PREFIX } from "../helpers.mjs";

const make = (fetch = fakeFetch(), opts = {}) => new BCV({ fetch, now: () => NOW, ...opts });
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

describe("package", () => {
  it("VERSION matches package.json and the default User-Agent", () => {
    assert.equal(VERSION, pkg.version);
    assert.equal(DEFAULT_USER_AGENT, `bcv-today-js/${pkg.version} (+https://bcv.today)`);
    assert.deepEqual([...CURRENCIES], ["USD", "EUR", "CNY", "TRY", "RUB"]);
  });

  it("error hierarchy", () => {
    for (const E of [InvalidDate, InvalidCurrency, InvalidAmount]) {
      assert.ok(new E("x") instanceof InvalidArgument);
    }
    for (const E of [InvalidArgument, DateOutOfRange, CurrencyNotAvailable, NotFound, UpstreamError]) {
      const e = new E("x");
      assert.ok(e instanceof BCVError && e instanceof Error);
      assert.equal(e.name, E.name);
    }
  });
});

describe("latest()", () => {
  it("parses rates, dates and timestamps", async () => {
    const r = await make().latest();
    assert.deepEqual(r.rates, {
      USD: 916.6477,
      EUR: 1007.38665582,
      CNY: 137.52328442,
      TRY: 18.21021713,
      RUB: 11.17192733,
    });
    assert.deepEqual(Object.keys(r.rates), ["USD", "EUR", "CNY", "TRY", "RUB"]);
    assert.equal(r.date, "2026-11-18");
    assert.equal(r.effectiveDate, "2026-11-18");
    assert.ok(r.updatedAt instanceof Date);
    assert.equal(r.updatedAt.toISOString(), "2026-11-18T02:01:03.699Z");
    assert.match(r.source, /bcv\.today/);
    assert.equal(
      r.summary,
      "Official BCV rates (effective 2026-11-18, Bs. per unit): USD 916.6477, EUR 1,007.3867, CNY 137.5233, TRY 18.2102, RUB 11.1719",
    );
  });

  it("sends Accept and the bcv-today-js User-Agent", async () => {
    const f = fakeFetch();
    await make(f).latest();
    assert.deepEqual(f.calls, [`${PREFIX}rate.json`]);
    assert.equal(f.headers[0].accept, "application/json");
    assert.equal(f.headers[0]["user-agent"], `bcv-today-js/${VERSION} (+https://bcv.today)`);
  });

  it("custom base URL and User-Agent", async () => {
    const f = fakeFetch({ "https://example.test/api/v1/rate.json": { body: '{"USD": 1, "date": "2026-01-02"}' } });
    const c = new BCV({ baseUrl: "https://example.test/", userAgent: "me/1", fetch: f });
    assert.equal((await c.latest()).rates.USD, 1);
    assert.equal(f.headers[0]["user-agent"], "me/1");
  });

  it("rejects bad options", () => {
    assert.throws(() => new BCV({ baseUrl: "ftp://x" }), InvalidArgument);
    assert.throws(() => new BCV({ timeoutMs: -1 }), InvalidArgument);
    assert.throws(() => new BCV({ cacheTtlMs: Number.NaN }), InvalidArgument);
  });
});

describe("on()", () => {
  it("business day is not carried forward", async () => {
    const d = await make().on("2026-01-06");
    assert.equal(d.date, "2026-01-06");
    assert.equal(d.effectiveDate, "2026-01-06");
    assert.equal(d.carriedForward, false);
    assert.equal(d.note, null);
    assert.deepEqual(Object.keys(d.rates), ["USD", "EUR"]);
    assert.equal(d.rate, undefined);
  });

  it("Sunday carries the Saturday rate forward", async () => {
    const d = await make().on("2026-01-04", "usd");
    assert.equal(d.effectiveDate, "2026-01-03");
    assert.equal(d.carriedForward, true);
    assert.equal(d.rate, 304.6796);
    assert.deepEqual(d.rates, { USD: 304.6796 });
    assert.equal(
      d.note,
      "2026-01-04 (Sunday) uses the rate with effective date 2026-01-03 (Saturday): a published BCV rate " +
        "stays in effect until the next publication (weekends and holidays carry it forward).",
    );
    assert.match(d.summary, /carry it forward/);
  });

  it("accepts a Date (UTC calendar day)", async () => {
    assert.equal((await make().on(new Date("2026-01-06"))).date, "2026-01-06");
    assert.equal((await make().on(new Date(Date.UTC(2026, 0, 6, 23, 59)))).date, "2026-01-06");
  });

  it("currency missing on an old day", async () => {
    await assert.rejects(make().on("2021-08-02", "EUR"), (e) => {
      assert.ok(e instanceof CurrencyNotAvailable);
      assert.match(e.message, /No EUR rate in the BCV data for 2021-08-02 .*Available that day: USD/);
      return true;
    });
  });

  for (const bad of ["2026-02-30", "2026-1-4", "04/01/2026", "", "2026-01-04T00:00", "nope"]) {
    it(`invalid date ${JSON.stringify(bad)} throws InvalidDate without a request`, async () => {
      const f = fakeFetch();
      await assert.rejects(make(f).on(bad), (e) => e instanceof InvalidDate && /YYYY-MM-DD/.test(e.message));
      assert.deepEqual(f.calls, []);
    });
  }

  it("invalid Date object and wrong types", async () => {
    await assert.rejects(make().on(new Date("x")), InvalidDate);
    await assert.rejects(make().on(20260104), InvalidDate);
  });

  it("before the first snapshot", async () => {
    await assert.rejects(
      make().on("2021-08-01"),
      (e) => e instanceof DateOutOfRange && /daily snapshots start on 2021-08-02/.test(e.message),
    );
  });

  it("future date", async () => {
    await assert.rejects(
      make().on("2026-11-20"),
      (e) => e instanceof DateOutOfRange && /in the future \(today in Caracas is 2026-11-18\)/.test(e.message),
    );
  });

  it("tomorrow is allowed but not published yet", async () => {
    const f = fakeFetch();
    await assert.rejects(make(f).on("2026-11-19"), (e) => {
      assert.ok(e instanceof DateOutOfRange);
      assert.equal(
        e.message,
        "No BCV rate published yet for 2026-11-19. Daily snapshots are available from 2021-08-02 to 2026-11-18. Use latest() for the rate currently in effect.",
      );
      return true;
    });
    assert.equal(f.calls.at(-1), `${PREFIX}rate.json`);
  });

  it("today is computed in Caracas (UTC-4)", async () => {
    const c = make(fakeFetch(), { now: () => new Date(Date.UTC(2026, 10, 19, 2, 0)) });
    await assert.rejects(c.on("2026-11-20"), /today in Caracas is 2026-11-18/);
  });

  it("invalid currency", async () => {
    await assert.rejects(
      make().on("2026-01-06", "GBP"),
      (e) => e instanceof InvalidCurrency && /use one of USD, EUR, CNY, TRY, RUB/.test(e.message),
    );
  });
});

describe("history()", () => {
  it("last N days", async () => {
    const h = await make().history("usd", { days: 7 });
    assert.equal(h.points.length, 7);
    assert.equal(h.end, "2026-11-18");
    assert.equal(h.start, "2026-11-12");
    assert.deepEqual(
      h.points.map((p) => p.date),
      [...h.points.map((p) => p.date)].sort(),
    );
    assert.ok(h.min.rate <= h.first.rate && h.last.rate <= h.max.rate);
    assert.equal(h.note, null);
  });

  it("range, carry flags and stats", async () => {
    const h = await make().history("eur", { start: "2026-01-01", end: new Date("2026-01-06") });
    assert.deepEqual(
      h.points.map((p) => p.date),
      ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06"],
    );
    assert.deepEqual(
      h.points.map((p) => p.carriedForward),
      [false, true, false, true, true, false],
    );
    assert.equal(h.first.rate, 354.4935);
    assert.equal(h.last.rate, 360.5039);
    assert.equal(h.min.date, "2026-01-01");
    assert.equal(h.max.date, "2026-01-06");
    assert.equal(h.changeExact, "6.0104");
    assert.equal(h.change, 6.0104); // exact, no float noise (360.5039 - 354.4935 = 6.010400000000004 in floats)
    assert.equal(h.changePct, 1.6955); // (6.0104 / 354.4935 * 100) half-up to 4 places
  });

  it("clipping notes", async () => {
    const a = await make().history("EUR", { start: "2025-12-01", end: "2026-01-02" });
    assert.equal(a.start, "2026-01-01");
    assert.equal(a.note, "History for EUR starts on 2026-01-01; earlier dates were skipped.");
    const b = await make().history("USD", { start: "2026-11-17", end: "2026-12-31" });
    assert.equal(b.note, "Latest available date is 2026-11-18.");
  });

  it("empty window", async () => {
    await assert.rejects(make().history("USD", { start: "2024-01-01", end: "2024-01-31" }), (e) => {
      assert.ok(e instanceof DateOutOfRange);
      assert.match(
        e.message,
        /^No USD rates between 2024-01-01 and 2024-01-31\. .* For older single days use on\(\)\.$/,
      );
      return true;
    });
  });

  it("bad arguments", async () => {
    await assert.rejects(
      make().history("USD", { start: "2026-01-06", end: "2026-01-01" }),
      (e) => e instanceof InvalidDate && /must be on or before/.test(e.message),
    );
    await assert.rejects(make().history("USD", { days: 0 }), /from 1 to 1830/);
    await assert.rejects(make().history("USD", { days: 1831 }), /from 1 to 1830/);
    await assert.rejects(make().history("USD", { days: 2.5 }), InvalidDate);
    await assert.rejects(make().history("VES"), InvalidCurrency);
  });
});

describe("convert()", () => {
  it("USD -> VES at the latest rate", async () => {
    const c = await make().convert(100, "USD", "VES");
    assert.equal(c.result, 91664.77);
    assert.equal(c.resultText, "91664.77");
    assert.equal(c.resultExact, "91664.77");
    assert.equal(c.rate, 916.6477);
    assert.deepEqual(c.ratesUsed, { USD: 916.6477 });
    assert.equal(c.effectiveDate, "2026-11-18");
    assert.equal(c.carriedForward, false);
    assert.equal(c.note, null);
    assert.equal(c.decimals, 2);
    assert.ok(c.summary.startsWith("100.00 USD = 91,664.77 VES at the official BCV rate"));
  });

  it("VES -> USD rounds half-up and keeps the trailing zero in resultText", async () => {
    const c = await make().convert("1000", "ves", "usd");
    assert.equal(c.resultText, "1.09");
    assert.equal(c.resultExact, "1.090931663276960166921271935"); // = Python Decimal (prec 28, ROUND_HALF_UP)
    const d = await make().convert("1008.3125", "VES", "USD");
    assert.equal(d.resultText, "1.10"); // 1.1000... -> "1.10"
  });

  it("cross rate through VES (same digits as Python's decimal module)", async () => {
    const c = await make().convert("50", "EUR", "USD", { decimals: null });
    assert.equal(c.rateExact, "1.098989999996727205010169119");
    assert.equal(c.resultExact, "54.94949999983636025050845597");
    assert.equal(c.resultText, c.resultExact);
    assert.deepEqual(Object.keys(c.ratesUsed), ["EUR", "USD"]);
    const d = await make().convert(0.1, "EUR", "CNY");
    assert.equal(d.resultExact, "0.7325207946193407238579097339");
    const e = await make().convert("123456.789", "CNY", "RUB", { decimals: 4 });
    assert.equal(e.resultExact, "1519718.362438267612684158052");
    assert.equal(e.resultText, "1519718.3624");
  });

  it("rounding half-up on exact ties", async () => {
    const f = fakeFetch({ [`${PREFIX}rate.json`]: { body: '{"USD": 2.5, "date": "2026-11-18"}' } });
    const c = make(f);
    assert.equal((await c.convert("0.001", "USD", "VES")).resultText, "0.00"); // 0.0025 -> 0.00
    assert.equal((await c.convert("0.003", "USD", "VES")).resultText, "0.01"); // 0.0075 -> 0.01
    const t = await c.convert("0.005", "USD", "VES");
    assert.equal(t.resultExact, "0.0125");
    assert.equal(t.resultText, "0.01");
    assert.equal((await c.convert("0.001", "USD", "VES", { decimals: 3 })).resultText, "0.003"); // 0.0025 -> 0.003
    assert.equal((await c.convert(1, "USD", "VES", { decimals: 0 })).resultText, "3"); // 2.5 -> 3
    assert.equal((await c.convert("0.3", "VES", "USD", { decimals: 1 })).resultText, "0.1"); // 0.12 -> 0.1
    assert.equal((await c.convert("0.375", "VES", "USD")).resultText, "0.15"); // 0.15 exactly
    assert.equal((await c.convert("0.0125", "VES", "USD", { decimals: 3 })).resultText, "0.005");
  });

  it("no binary floating-point noise", async () => {
    const f = fakeFetch({ [`${PREFIX}rate.json`]: { body: '{"USD": 0.1, "EUR": 0.3, "date": "2026-11-18"}' } });
    const c = make(f);
    const a = await c.convert(0.1, "USD", "VES", { decimals: null });
    assert.equal(a.amountExact, "0.1");
    assert.equal(a.resultExact, "0.01"); // 0.1 * 0.1 is 0.010000000000000002 in floats
    const b = await c.convert(3, "USD", "EUR", { decimals: null });
    assert.equal(b.resultExact, "1"); // 3 * 0.1 / 0.3
    assert.equal(b.rateExact, "0.3333333333333333333333333333");
    const big = await c.convert("999999999999999.99", "VES", "USD", { decimals: 2 });
    assert.equal(big.resultText, "9999999999999999.90");
    assert.equal((await c.convert(1n, "USD", "VES")).resultText, "0.10");
    assert.equal((await c.convert("1_000", "USD", "VES")).resultText, "100.00");
    assert.equal((await c.convert("1e3", "USD", "VES")).resultText, "100.00");
  });

  it("on a date, with carry-forward", async () => {
    const c = await make().convert(10, "USD", "VES", { date: "2026-01-04" });
    assert.equal(c.resultText, "3046.80");
    assert.equal(c.result, 3046.8);
    assert.equal(c.date, "2026-01-04");
    assert.equal(c.effectiveDate, "2026-01-03");
    assert.equal(c.carriedForward, true);
    assert.ok(c.note);
  });

  it("currency missing that day", async () => {
    await assert.rejects(make().convert(1, "USD", "EUR", { date: "2021-08-02" }), (e) => {
      assert.ok(e instanceof CurrencyNotAvailable);
      assert.match(e.message, /No BCV rate for EUR on 2021-08-02 .*Available: USD\./);
      return true;
    });
  });

  const invalid = [
    [[1, "USD", "USD"], InvalidCurrency, /both USD/],
    [[1, "USD", "GBP"], InvalidCurrency, /Unsupported currency/],
    [[-1, "USD", "VES"], InvalidAmount, /zero or positive/],
    [["-0.5", "USD", "VES"], InvalidAmount, /zero or positive/],
    [["abc", "USD", "VES"], InvalidAmount, /expected a number/],
    [["", "USD", "VES"], InvalidAmount, /expected a number/],
    [[Number.POSITIVE_INFINITY, "USD", "VES"], InvalidAmount, /finite/],
    [[Number.NaN, "USD", "VES"], InvalidAmount, /finite/],
    [["Infinity", "USD", "VES"], InvalidAmount, /finite/],
    [["1e16", "USD", "VES"], InvalidAmount, /1e15/],
    [[true, "USD", "VES"], InvalidAmount, /expected a number/],
    [[null, "USD", "VES"], InvalidAmount, /expected a number/],
  ];
  for (const [args, E, msg] of invalid) {
    it(`invalid ${JSON.stringify(args.map(String))} -> ${E.name} without a request`, async () => {
      const f = fakeFetch();
      await assert.rejects(make(f).convert(...args), (e) => e instanceof E && msg.test(e.message));
      assert.deepEqual(f.calls, []);
    });
  }

  it("1e15 is the maximum and VEF is accepted as VES", async () => {
    assert.equal((await make().convert(1e15, "vef", "USD")).from, "VES");
  });

  it("bad decimals", async () => {
    for (const decimals of [-1, 13, 1.5, "2"]) {
      await assert.rejects(
        make().convert(1, "USD", "VES", { decimals }),
        (e) => e instanceof InvalidAmount && /decimals/.test(e.message),
      );
    }
  });
});

describe("status()", () => {
  it("fresh data", async () => {
    const s = await make().status();
    assert.equal(s.status, "ok");
    assert.equal(s.stale, false);
    assert.equal(s.ageHours, 13); // 02:01 UTC -> 15:00 UTC
    assert.deepEqual(s.supportedCurrencies, ["USD", "EUR", "CNY", "TRY", "RUB"]);
    assert.equal(s.effectiveDate, "2026-11-18");
    assert.equal(s.timezone, "America/Caracas");
    assert.equal(s.apiVersion, "v1");
    assert.equal(s.currencies.USD, true);
    assert.ok(s.generatedAt instanceof Date);
  });

  it("stale after 96 hours", async () => {
    const s = await make(fakeFetch(), { now: () => Date.UTC(2026, 10, 22, 3, 0) }).status();
    assert.equal(s.ageHours, 97);
    assert.equal(s.stale, true);
    assert.match(s.summary, /STALE/);
  });
});

describe("upstream errors", () => {
  it("HTTP error", async () => {
    const f = fakeFetch({ [`${PREFIX}rate.json`]: { status: 503, body: "down" } });
    await assert.rejects(make(f).latest(), (e) => {
      assert.ok(e instanceof UpstreamError);
      assert.equal(e.message, "The BCV Today data API answered HTTP 503 for /api/v1/rate.json. Try again in a moment.");
      assert.equal(e.status, 503);
      return true;
    });
  });

  it("invalid JSON", async () => {
    const f = fakeFetch({ [`${PREFIX}rate.json`]: { body: "<html>" } });
    await assert.rejects(make(f).latest(), /invalid JSON for \/api\/v1\/rate\.json/);
  });

  it("wrong shapes", async () => {
    const f = fakeFetch({ [`${PREFIX}history.json`]: { body: "{}" }, [`${PREFIX}rate.json`]: { body: "[]" } });
    await assert.rejects(
      make(f).history("USD"),
      (e) => e instanceof UpstreamError && /expected an array/.test(e.message),
    );
    await assert.rejects(make(f).latest(), (e) => e instanceof UpstreamError && /expected an object/.test(e.message));
  });

  it("network failure", async () => {
    const boom = async () => {
      throw new TypeError("connection refused");
    };
    await assert.rejects(make(boom).latest(), (e) => {
      assert.ok(e instanceof UpstreamError);
      assert.equal(e.message, "Could not reach the BCV Today data API (connection refused). Try again in a moment.");
      assert.ok(e.cause instanceof TypeError);
      return true;
    });
  });

  it("timeout", async () => {
    const hang = (_url, init) =>
      new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    await assert.rejects(
      make(hang, { timeoutMs: 20 }).latest(),
      /Could not reach the BCV Today data API \(timed out after 20 ms\)/,
    );
  });

  it("history snapshot 404 maps to DateOutOfRange; latest() failure is tolerated", async () => {
    const f = fakeFetch({ [`${PREFIX}rate.json`]: { status: 500, body: "x" } });
    await assert.rejects(
      make(f).on("2026-11-19"),
      (e) => e instanceof DateOutOfRange && /to the latest business day\./.test(e.message),
    );
  });
});

describe("cache", () => {
  it("TTL, in-flight de-duplication and clearCache()", async () => {
    let t = NOW;
    const f = fakeFetch();
    const c = new BCV({ fetch: f, now: () => t, cacheTtlMs: 1000 });
    await Promise.all([c.latest(), c.latest(), c.convert(1, "USD", "VES")]);
    assert.equal(f.calls.length, 1);
    t += 999;
    await c.latest();
    assert.equal(f.calls.length, 1);
    t += 2;
    await c.latest();
    assert.equal(f.calls.length, 2);
    c.clearCache();
    await c.latest();
    assert.equal(f.calls.length, 3);
  });

  it("disabled with cacheTtlMs: 0", async () => {
    const f = fakeFetch();
    const c = make(f, { cacheTtlMs: 0 });
    await c.latest();
    await c.latest();
    assert.equal(f.calls.length, 2);
  });

  it("errors are not cached", async () => {
    let n = 0;
    const flaky = async () =>
      n++ === 0 ? new Response("x", { status: 502 }) : new Response('{"USD": 1, "date": "2026-11-18"}');
    const c = make(flaky);
    await assert.rejects(c.latest(), UpstreamError);
    assert.equal((await c.latest()).rates.USD, 1);
    assert.equal(n, 2);
  });
});
