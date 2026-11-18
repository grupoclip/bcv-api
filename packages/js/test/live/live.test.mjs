// Live tests against https://bcv.today. Skipped unless BCV_LIVE=1.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BCV, DateOutOfRange } from "../../dist/index.js";

const live = process.env.BCV_LIVE === "1";
const bcv = new BCV();

describe("live API", { skip: live ? false : "set BCV_LIVE=1 to run" }, () => {
  it("latest", async () => {
    const r = await bcv.latest();
    assert.ok(r.rates.USD > 0);
    assert.match(r.effectiveDate, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("weekend carry-forward on 2026-01-04", async () => {
    const d = await bcv.on("2026-01-04", "USD");
    assert.equal(d.effectiveDate, "2026-01-03");
    assert.equal(d.carriedForward, true);
  });

  it("history and convert", async () => {
    const h = await bcv.history("EUR", { days: 14 });
    assert.ok(h.points.length >= 1 && h.points.length <= 14);
    const c = await bcv.convert(100, "USD", "VES");
    assert.ok(c.result > 0);
    assert.match(c.resultText, /^\d+\.\d{2}$/);
  });

  it("status", async () => {
    const s = await bcv.status();
    assert.equal(typeof s.stale, "boolean");
    assert.deepEqual(s.supportedCurrencies.slice(0, 2), ["USD", "EUR"]);
  });

  it("out of range", async () => {
    await assert.rejects(bcv.on("2099-01-01"), DateOutOfRange);
  });
});
