// `bcv-today mcp`: the local stdio MCP server, driven by the official MCP client.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fixtureServer } from "../helpers.mjs";

const BIN = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
let server;
let client;

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { ...r, text: r.content?.[0]?.text ?? "" };
};

describe("bcv-today mcp (stdio)", () => {
  before(async () => {
    server = await fixtureServer();
    client = new Client({ name: "bcv-today-test", version: "0.0.0" });
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [BIN, "--base-url", server.origin, "mcp"] }),
    );
  });
  after(async () => {
    await client?.close();
    await server?.close();
  });

  it("initialize: name, version and instructions", () => {
    assert.equal(client.getServerVersion().name, "bcv-today");
    assert.match(
      client.getInstructions(),
      /^BCV Today: official exchange rates published by Banco Central de Venezuela/,
    );
  });

  it("lists the same five read-only tools as the remote server", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "convert",
      "get_history",
      "get_latest_rates",
      "get_rate_by_date",
      "get_status",
    ]);
    for (const t of tools) {
      assert.equal(t.annotations.readOnlyHint, true);
      assert.equal(t.inputSchema.type, "object");
      assert.ok(t.outputSchema);
    }
    const convert = tools.find((t) => t.name === "convert");
    assert.deepEqual(convert.inputSchema.required, ["amount", "from", "to"]);
  });

  it("get_latest_rates", async () => {
    const r = await call("get_latest_rates");
    assert.equal(r.isError, undefined);
    assert.equal(r.structuredContent.rates.USD, 916.6477);
    assert.match(r.text, /^Official BCV rates \(effective 2026-11-18, Bs\. per unit\): USD 916\.6477, EUR 1,007\.3867/);
  });

  it("get_rate_by_date carries the weekend forward", async () => {
    const r = await call("get_rate_by_date", { date: "2026-01-04", currency: "USD" });
    assert.equal(r.structuredContent.carried_forward, true);
    assert.equal(r.structuredContent.effective_date, "2026-01-03");
  });

  it("convert and get_history", async () => {
    const c = await call("convert", { amount: 100, from: "USD", to: "VES" });
    assert.equal(c.structuredContent.result, 91664.77);
    assert.match(c.text, /^100\.00 USD = 91,664\.77 VES at the official BCV rate/);
    const h = await call("get_history", { currency: "EUR", from: "2026-01-01", to: "2026-01-06" });
    assert.equal(h.structuredContent.points, 6);
  });

  it("errors: tool messages and input validation", async () => {
    const a = await call("get_rate_by_date", { date: "2019-05-01" });
    assert.equal(a.isError, true);
    assert.equal(a.text, "No BCV data for 2019-05-01: daily snapshots start on 2021-08-02.");
    const b = await call("convert", { amount: 1, from: "USD", to: "USD" });
    assert.equal(b.text, '"from" and "to" are both USD; choose two different currencies.');
    const c = await call("convert", { amount: -5, from: "USD", to: "JPY" });
    assert.equal(c.isError, true);
    assert.match(c.text, /Input validation error/);
    const d = await call("get_history", { currency: "USD", days: 0 });
    assert.equal(d.isError, true);
  });

  it("get_status and resources", async () => {
    const s = await call("get_status");
    assert.equal(s.structuredContent.status, "ok");
    const { resources } = await client.listResources();
    assert.deepEqual(
      resources.map((r) => r.uri),
      ["https://bcv.today/llms.txt", "https://bcv.today/openapi.json"],
    );
    const llms = await client.readResource({ uri: "https://bcv.today/llms.txt" });
    assert.match(llms.contents[0].text, /^# BCV Today/);
  });
});
