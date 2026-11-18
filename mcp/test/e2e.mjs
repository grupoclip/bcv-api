// End-to-end check with the official MCP client over Streamable HTTP.
// Usage: npx wrangler dev   (in another terminal), then
//        node test/e2e.mjs [http://127.0.0.1:8787/mcp]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = new URL(process.argv[2] ?? "http://127.0.0.1:8787/mcp");
let failures = 0;

function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!cond) failures++;
}

const client = new Client({ name: "bcv-e2e", version: "0.0.0" });
await client.connect(new StreamableHTTPClientTransport(endpoint));
const info = client.getServerVersion();
check("initialize", info?.name === "bcv-today", `${info?.name} ${info?.version}`);
console.log("instructions:", client.getInstructions());

const { tools } = await client.listTools();
console.log("\ntools/list:");
for (const t of tools) {
  console.log(`  ${t.name}(${Object.keys(t.inputSchema.properties ?? {}).join(", ")})  annotations=${JSON.stringify(t.annotations)}`);
}
check(
  "five tools",
  ["convert", "get_history", "get_latest_rates", "get_rate_by_date", "get_status"].every((n) => tools.some((t) => t.name === n)),
);

const { resources } = await client.listResources();
check("resources listed", resources.length === 2, resources.map((r) => r.uri).join(", "));
const llms = await client.readResource({ uri: "https://bcv.today/llms.txt" });
check("read llms.txt resource", llms.contents[0]?.text?.startsWith("# BCV Today"));

async function call(name, args, expectError = false) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? "";
  const summary = text.split("\n\n")[0];
  check(`${name} ${JSON.stringify(args)} -> ${expectError ? "error" : "ok"}`, Boolean(r.isError) === expectError, summary);
  return r;
}

console.log("\ntools/call:");
const latest = await call("get_latest_rates", {});
check("latest has USD", typeof latest.structuredContent?.rates?.USD === "number");

const day = await call("get_rate_by_date", { date: "2026-01-02" });
console.log("   structured:", JSON.stringify(day.structuredContent));
await call("get_rate_by_date", { date: "2026-01-03", currency: "USD" }); // Saturday
await call("get_rate_by_date", { date: "2026-01-04", currency: "EUR" }); // Sunday
await call("get_rate_by_date", { date: "2026-02-30" }, true);
await call("get_rate_by_date", { date: "02/01/2026" }, true);
await call("get_rate_by_date", { date: "2019-05-01" }, true);
await call("get_rate_by_date", { date: "2099-01-01" }, true);
await call("get_rate_by_date", { date: "2021-09-01", currency: "RUB" }, true);
await call("get_rate_by_date", { date: "2026-01-02", currency: "GBP" }, true);

const h = await call("get_history", { currency: "USD", days: 7 });
console.log("   stats:", JSON.stringify({ ...h.structuredContent, series: `[${h.structuredContent?.series?.length} points]` }));
await call("get_history", { currency: "EUR", from: "2026-01-01", to: "2026-01-31" });
await call("get_history", { currency: "USD", days: 0 }, true);
await call("get_history", { currency: "USD", days: 5000 }, true);
await call("get_history", { currency: "USD", from: "2026-02-01", to: "2026-01-01" }, true);

const c = await call("convert", { amount: 100, from: "USD", to: "VES" });
console.log("   structured:", JSON.stringify(c.structuredContent));
await call("convert", { amount: 50000, from: "VES", to: "EUR" });
await call("convert", { amount: 10, from: "EUR", to: "USD", date: "2026-01-03" });
await call("convert", { amount: 1, from: "USD", to: "USD" }, true);
await call("convert", { amount: -5, from: "USD", to: "VES" }, true);
await call("convert", { amount: 1, from: "USD", to: "JPY" }, true);

const s = await call("get_status", {});
console.log("   structured:", JSON.stringify(s.structuredContent));

await client.close();

// Raw HTTP hardening checks
const base = endpoint.origin;
const big = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(70_000) } }),
});
check("POST > 64 KB rejected with 413", big.status === 413, String(big.status));
const del = await fetch(endpoint, { method: "DELETE" });
check("DELETE /mcp -> 405", del.status === 405, String(del.status));
const sse = await fetch(endpoint, { headers: { accept: "text/event-stream" } });
check("GET /mcp (SSE) -> 405", sse.status === 405, String(sse.status));
const opt = await fetch(endpoint, { method: "OPTIONS", headers: { origin: "https://example.com", "access-control-request-method": "POST" } });
check("OPTIONS preflight 204 + CORS", opt.status === 204 && opt.headers.get("access-control-allow-origin") === "*", opt.headers.get("access-control-allow-headers") ?? "");
const home = await fetch(`${base}/`);
check("GET / -> 200 html", home.status === 200 && (home.headers.get("content-type") ?? "").includes("text/html"));
const card = await fetch(`${base}/mcp/server-card`);
const cardJson = await card.json();
check("GET /mcp/server-card", card.status === 200 && cardJson.remotes?.[0]?.url === "https://mcp.bcv.today/mcp", card.headers.get("content-type") ?? "");

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
