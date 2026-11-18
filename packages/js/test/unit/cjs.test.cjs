// The CommonJS build exposes the same API as the ESM build.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const bcv = require("../../dist/index.cjs");

describe("CommonJS build", () => {
  it("exports the client, errors and constants", () => {
    assert.equal(typeof bcv.BCV, "function");
    assert.ok(new bcv.InvalidDate("x") instanceof bcv.BCVError);
    assert.equal(bcv.EARLIEST_SNAPSHOT, "2021-08-02");
    assert.equal(bcv.MAX_HISTORY_DAYS, 1830);
    assert.equal(bcv.VERSION, require("../../package.json").version);
  });

  it("converts with a custom fetch", async () => {
    const fetch = async () => new Response('{"USD": 916.6477, "date": "2026-11-18"}');
    const c = await new bcv.BCV({ fetch }).convert(100, "USD", "VES");
    assert.equal(c.resultText, "91664.77");
  });
});
