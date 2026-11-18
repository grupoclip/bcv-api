import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fixtureServer } from "../helpers.mjs";

const BIN = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
let server;

function run(...args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, "--base-url", server.origin, ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("bcv-today CLI", () => {
  before(async () => {
    server = await fixtureServer();
  });
  after(() => server.close());

  it("--version and --help", async () => {
    assert.equal((await run("--version")).stdout.trim(), `bcv-today ${pkg.version}`);
    const help = await run("--help");
    assert.equal(help.code, 0);
    assert.match(
      help.stdout,
      /Exit codes: 0 ok, 1 no data for the request, 2 invalid arguments, 3 network\/API error\./,
    );
  });

  it("latest (table)", async () => {
    const r = await run("latest");
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Official BCV rates, effective 2026-11-18 \(Bs\. per unit\)/);
    assert.match(r.stdout, /USD\s+916\.6477/);
    assert.match(r.stdout, /EUR\s+1,007\.3867/);
    assert.match(r.stdout, /Updated 2026-11-18 02:01 UTC\. Source: Banco Central de Venezuela via BCV Today/);
  });

  it("convert 100 USD VES", async () => {
    const r = await run("convert", "100", "USD", "VES");
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^Amount\s+100\.00 USD$/m);
    assert.match(r.stdout, /^Result\s+91,664\.77 VES$/m);
    assert.match(r.stdout, /^Rate\s+1 USD = 916\.647700 VES$/m);
    assert.match(r.stdout, /^BCV USD\s+916\.6477 VES$/m);
  });

  it("convert --json with --decimals and --date (carry-forward)", async () => {
    const r = await run("convert", "10", "usd", "ves", "--date", "2026-01-04", "--decimals", "1", "--json");
    assert.equal(r.code, 0);
    const j = JSON.parse(r.stdout);
    assert.equal(j.result, 3046.8);
    assert.equal(j.result_text, "3046.8");
    assert.equal(j.effective_date, "2026-01-03");
    assert.equal(j.carried_forward, true);
    assert.match(j.note, /carry it forward/);
    assert.equal(j.rates_used.USD, 304.6796);
  });

  it("on with -c and carry-forward note", async () => {
    const r = await run("on", "2026-01-04", "-c", "eur");
    assert.equal(r.code, 0);
    assert.match(r.stdout, /BCV rate in effect on 2026-01-04 \(effective date 2026-01-03, Bs\. per unit\)/);
    assert.match(r.stdout, /Note: 2026-01-04 \(Sunday\) uses the rate with effective date 2026-01-03 \(Saturday\)/);
  });

  it("history range --json", async () => {
    const r = await run("history", "EUR", "--start", "2026-01-01", "--end", "2026-01-06", "--json");
    assert.equal(r.code, 0);
    const j = JSON.parse(r.stdout);
    assert.equal(j.points, 6);
    assert.equal(j.from, "2026-01-01");
    assert.equal(j.to, "2026-01-06");
    assert.equal(j.change, 6.0104);
    assert.equal(j.change_pct, 1.6955);
    assert.deepEqual(j.series[1], { date: "2026-01-02", effective_date: "2026-01-01", rate: 354.4935 });
  });

  it("history table marks carried-forward days", async () => {
    const r = await run("history", "usd", "-n", "3");
    assert.equal(r.code, 0);
    assert.match(r.stdout, /USD\/VES official BCV rate, 2026-11-16 to 2026-11-18 \(3 days\)/);
  });

  it("status", async () => {
    const r = await run("status", "--json");
    assert.equal(r.code, 0);
    const j = JSON.parse(r.stdout);
    assert.equal(j.status, "ok");
    assert.equal(j.updated_at, "2026-11-18T02:01:03.699523+00:00");
    assert.deepEqual(j.supported_currencies, ["USD", "EUR", "CNY", "TRY", "RUB"]);
  });

  it("exit 1: no data (date out of range / currency not available)", async () => {
    const a = await run("on", "2020-01-01");
    assert.equal(a.code, 1);
    assert.match(a.stderr, /bcv-today: error: No BCV data for 2020-01-01: daily snapshots start on 2021-08-02\./);
    const b = await run("on", "2021-08-02", "--currency", "EUR", "--json");
    assert.equal(b.code, 1);
    assert.equal(JSON.parse(b.stdout).error.type, "CurrencyNotAvailable");
  });

  it("exit 2: invalid arguments", async () => {
    for (const args of [
      ["convert", "abc", "USD", "VES"],
      ["convert", "1", "USD", "GBP"],
      ["on", "2026-02-30"],
      ["history", "USD", "--days", "0"],
      ["history", "USD", "--days", "x"],
      ["convert", "1", "USD"],
      ["latest", "--currency", "USD"],
      ["nope"],
      [],
      ["--bogus"],
    ]) {
      const r = await run(...args);
      assert.equal(r.code, 2, `${args.join(" ")} -> ${r.code} ${r.stderr}`);
      assert.match(r.stderr, /bcv-today: error: /);
    }
    const j = await run("convert", "-5", "USD", "VES", "--json");
    assert.equal(j.code, 2);
    assert.deepEqual(JSON.parse(j.stdout).error.type, "InvalidAmount");
  });

  it("exit 3: upstream error", async () => {
    const child = spawn(process.execPath, [BIN, "--base-url", "http://127.0.0.1:9", "latest", "--timeout", "2"]);
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 3);
  });
});
