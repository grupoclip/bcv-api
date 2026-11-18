// End-to-end check of the A2A agent: agent card (validated with ajv against the
// official A2A JSON Schema), raw JSON-RPC requests (A2A 1.0 and 0.3), and the
// official @a2a-js/sdk client (1.0 and 0.3 compat transports).
// Usage: npx wrangler dev   (in another terminal), then
//        node test/a2a-e2e.mjs [http://127.0.0.1:8787]
import { readFileSync } from "node:fs";
import { Message } from "@a2a-js/sdk";
import { ClientFactory, DefaultAgentCardResolver, JsonRpcTransportFactory } from "@a2a-js/sdk/client";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const base = (process.argv[2] ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const endpoint = `${base}/a2a`;
const PUBLIC = "https://mcp.bcv.today";
const SCHEMA_URL = "https://a2a-protocol.org/latest/spec/a2a.json";
let failures = 0;

function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!cond) failures++;
}

// ------------------------------------------------------------- agent card
const siteCard = JSON.parse(readFileSync(new URL("../../../site/.well-known/agent-card.json", import.meta.url), "utf8"));

let validateCard;
try {
  const schema = await (await fetch(SCHEMA_URL)).json();
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(schema, "a2a");
  validateCard = ajv.getSchema("a2a#/$defs/AgentCard");
  console.log(`schema: ${SCHEMA_URL} (${schema.version ?? "?"})`);
} catch (err) {
  console.log(`WARN  could not load the A2A JSON Schema (${err.message}); schema checks skipped`);
}
function schemaCheck(label, card) {
  if (!validateCard) return;
  const ok = validateCard(card);
  check(label, ok, ok ? "" : ajvErrors());
}
const ajvErrors = () => (validateCard.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message} ${JSON.stringify(e.params)}`).join("; ");

const REQUIRED = ["name", "description", "supportedInterfaces", "version", "capabilities", "defaultInputModes", "defaultOutputModes", "skills"];
check("site card has every required AgentCard field", REQUIRED.every((k) => siteCard[k] !== undefined && siteCard[k] !== "" && (!Array.isArray(siteCard[k]) || siteCard[k].length > 0)));
check(
  "site card supportedInterfaces -> https://mcp.bcv.today/a2a (JSONRPC 1.0 first, 0.3)",
  siteCard.supportedInterfaces[0]?.url === `${PUBLIC}/a2a` &&
    siteCard.supportedInterfaces[0]?.protocolBinding === "JSONRPC" &&
    siteCard.supportedInterfaces[0]?.protocolVersion === "1.0" &&
    siteCard.supportedInterfaces.some((i) => i.protocolVersion === "0.3"),
);
check("site card skills have id/name/description/tags", siteCard.skills.every((s) => s.id && s.name && s.description && s.tags?.length));
schemaCheck("site card valid against official AgentCard schema", siteCard);

const v1Res = await fetch(`${base}/.well-known/agent-card.json`, { headers: { "A2A-Version": "1.0" } });
const v1Card = await v1Res.json();
check("Worker card (A2A-Version: 1.0) == site card", v1Res.status === 200 && JSON.stringify(v1Card) === JSON.stringify(siteCard), v1Res.headers.get("content-type") ?? "");
schemaCheck("Worker 1.0 card valid against official AgentCard schema", v1Card);

const compatRes = await fetch(`${base}/.well-known/agent-card.json`);
const compat = await compatRes.json();
check(
  "Worker card (no header) = 0.3 compat shape + supportedInterfaces",
  compat.url === `${PUBLIC}/a2a` && compat.preferredTransport === "JSONRPC" && compat.protocolVersion === "0.3" && compat.supportedInterfaces?.length === 2,
  `vary=${compatRes.headers.get("vary")} cors=${compatRes.headers.get("access-control-allow-origin")}`,
);
{
  const { url, preferredTransport, protocolVersion, supportsAuthenticatedExtendedCard, security, ...rest } = compat;
  schemaCheck("compat card minus documented 0.3 fields valid against schema", rest);
}

// ------------------------------------------------------------- raw JSON-RPC
async function rpc(body, headers = {}) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text, res };
}
const v1msg = (parts, metadata) => ({ role: "ROLE_USER", messageId: crypto.randomUUID(), parts, ...(metadata ? { metadata } : {}) });
const send1 = (parts, id, extra = {}) => rpc({ jsonrpc: "2.0", id, method: "SendMessage", params: { message: v1msg(parts), ...extra } }, { "A2A-Version": "1.0" });
const textOf = (task) => task?.artifacts?.[0]?.parts?.find((p) => typeof p.text === "string")?.text ?? "";
const dataOf = (task) => task?.artifacts?.[0]?.parts?.find((p) => p.data !== undefined)?.data;

console.log("\nA2A 1.0 JSON-RPC (SendMessage):");
const cases = [
  ["ES latest", "¿Cuál es la tasa del dólar BCV hoy?", "latest-rates", (d) => typeof d.result.rates.USD === "number"],
  ["ES rate on date", "tasa del 2026-01-04", "rate-on-date", (d) => d.result.carried_forward === true],
  ["EN rate on date", "USD rate on 2026-01-04", "rate-on-date", (d) => d.arguments.currency === "USD"],
  ["ES date words", "¿cuál fue el euro BCV el 2 de enero de 2026?", "rate-on-date", (d) => d.arguments.date === "2026-01-02" && d.arguments.currency === "EUR"],
  ["ES convert", "convertir 100 USD a VES", "convert", (d) => d.arguments.from === "USD" && d.arguments.to === "VES" && d.result.result > 0],
  ["ES convert words", "100 dólares en bolívares", "convert", (d) => d.arguments.from === "USD" && d.arguments.to === "VES"],
  ["ES convert reverse", "¿cuántos dólares son 5.000 bolívares?", "convert", (d) => d.arguments.amount === 5000 && d.arguments.from === "VES" && d.arguments.to === "USD"],
  ["EN convert", "convert 50000 VES to EUR", "convert", (d) => d.arguments.amount === 50000 && d.arguments.from === "VES" && d.arguments.to === "EUR"],
  ["EN convert on date", "how much is 20 euros in bolivars on 2026-01-02?", "convert", (d) => d.arguments.date === "2026-01-02" && d.arguments.from === "EUR"],
  ["ES history", "historial del dólar últimos 7 días", "history", (d) => d.arguments.days === 7 && d.result.points >= 1],
  ["ES history range", "historial del euro desde 2026-01-01 hasta 2026-01-31", "history", (d) => d.arguments.from === "2026-01-01" && d.arguments.to === "2026-01-31"],
  ["EN history", "EUR trend over the past 2 weeks", "history", (d) => d.arguments.currency === "EUR" && d.arguments.days === 14],
  ["ES status", "estado de los datos", "status", (d) => typeof d.result.stale === "boolean"],
  ["EN status", "when was the rate last updated?", "status", (d) => typeof d.result.updated_at === "string"],
];
let i = 10;
for (const [label, text, skill, extra] of cases) {
  const r = await send1([{ text }], i++);
  const task = r.json?.result?.task;
  const d = dataOf(task);
  const ok = r.status === 200 && task?.status?.state === "TASK_STATE_COMPLETED" && d?.skill === skill && extra(d);
  check(`${label}: "${text}" -> ${skill}`, ok, textOf(task).slice(0, 140) || r.text.slice(0, 200));
}

{
  const r = await send1([{ data: { skill: "convert", amount: 100, from: "USD", to: "VES" }, mediaType: "application/json" }], 40);
  const task = r.json?.result?.task;
  const d = dataOf(task);
  check("DataPart convert -> completed task with TextPart + DataPart", task?.status?.state === "TASK_STATE_COMPLETED" && d?.result?.from === "USD" && textOf(task).includes("USD"), textOf(task));
  const r2 = await rpc({ jsonrpc: "2.0", id: 41, method: "SendMessage", params: { message: v1msg([{ data: { skill: "history", currency: "eur", days: "5" } }]), configuration: { acceptedOutputModes: ["application/json"] } } }, { "A2A-Version": "1.0" });
  const t2 = r2.json?.result?.task;
  check("DataPart history + acceptedOutputModes=[application/json] -> data only", t2?.artifacts?.[0]?.parts?.length === 1 && dataOf(t2)?.result?.currency === "EUR");
  const r3 = await send1([{ data: { skill: "convert", amount: -5, from: "USD", to: "JPY" } }], 42);
  const m3 = r3.json?.result?.message;
  check("DataPart invalid args -> agent message (not JSON-RPC error)", m3?.role === "ROLE_AGENT" && m3.parts.some((p) => p.data?.code === "invalid_arguments"), m3?.parts?.[0]?.text);
  const r4 = await send1([{ text: "tasa del 2099-01-01" }], 43);
  const m4 = r4.json?.result?.message;
  check("future date -> agent message explaining it", m4?.role === "ROLE_AGENT" && /futur/i.test(m4.parts[0].text), m4?.parts?.[0]?.text);
}

{
  const r = await send1([{ text: "cuéntame un chiste sobre gatos" }], 50);
  const m = r.json?.result?.message;
  check("unknown request (ES) -> help message listing skills", r.status === 200 && m?.role === "ROLE_AGENT" && /Puedo/.test(m.parts[0].text) && m.parts[1]?.data?.type === "help", m?.parts?.[0]?.text?.split("\n")[0]);
  const r2 = await send1([{ text: "write me a poem about the weather" }], 51);
  const m2 = r2.json?.result?.message;
  check("unknown request (EN) -> help message", m2?.role === "ROLE_AGENT" && /I can do/.test(m2.parts[0].text), m2?.parts?.[0]?.text?.split("\n")[0]);
}

console.log("\nJSON-RPC errors:");
{
  const r = await rpc("{not json", { "A2A-Version": "1.0" });
  check("invalid JSON -> -32700", r.json?.error?.code === -32700 && r.json.id === null, JSON.stringify(r.json));
  const r2 = await rpc({ jsonrpc: "2.0", id: 60, method: "SendMessage" }, { "A2A-Version": "1.0" });
  check("missing params -> -32602/-32600", [-32602, -32600].includes(r2.json?.error?.code), JSON.stringify(r2.json?.error));
  const r3 = await rpc({ id: 61, method: "SendMessage", params: {} }, { "A2A-Version": "1.0" });
  check("no jsonrpc member -> -32600", r3.json?.error?.code === -32600, JSON.stringify(r3.json?.error));
  const r4 = await rpc({ jsonrpc: "2.0", id: 62, method: "DoMagic", params: {} }, { "A2A-Version": "1.0" });
  check("unknown method -> -32601", r4.json?.error?.code === -32601 && r4.json.id === 62, JSON.stringify(r4.json?.error));
  const r5 = await rpc({ jsonrpc: "2.0", id: 63, method: "SendStreamingMessage", params: { message: v1msg([{ text: "hola" }]) } }, { "A2A-Version": "1.0" });
  check("SendStreamingMessage -> UnsupportedOperation -32004", r5.json?.error?.code === -32004, JSON.stringify(r5.json?.error));
  const r6 = await rpc({ jsonrpc: "2.0", id: 64, method: "GetTask", params: { id: "does-not-exist" } }, { "A2A-Version": "1.0" });
  check("GetTask (stateless) -> TaskNotFound -32001", r6.json?.error?.code === -32001, JSON.stringify(r6.json?.error));
  const r7 = await rpc({ jsonrpc: "2.0", id: 65, method: "CreateTaskPushNotificationConfig", params: { taskId: "x", url: "https://example.com/hook" } }, { "A2A-Version": "1.0" });
  check("push config -> PushNotificationNotSupported -32003 (or -32004)", [-32003, -32004].includes(r7.json?.error?.code), JSON.stringify(r7.json?.error));
  const r8 = await rpc({ jsonrpc: "2.0", id: 66, method: "SendMessage", params: { message: v1msg([{ text: "hola" }]) } }, { "A2A-Version": "9.9" });
  check("A2A-Version: 9.9 -> VersionNotSupported -32009", r8.json?.error?.code === -32009, JSON.stringify(r8.json?.error));
  const r9 = await send1([{ raw: "aGVsbG8=", mediaType: "image/png", filename: "x.png" }], 67);
  check("file part -> ContentTypeNotSupported -32005", r9.json?.error?.code === -32005, JSON.stringify(r9.json?.error));
  const r10 = await rpc({ jsonrpc: "2.0", id: 68, method: "SendMessage", params: { message: { role: "ROLE_USER", parts: [{ text: "hola" }] } } }, { "A2A-Version": "1.0" });
  check("missing messageId -> invalid params", r10.json?.error !== undefined, JSON.stringify(r10.json?.error));
}

console.log("\nA2A 0.3 JSON-RPC (message/send, no A2A-Version header):");
{
  const msg = (parts) => ({ kind: "message", role: "user", messageId: crypto.randomUUID(), parts });
  const r = await rpc({ jsonrpc: "2.0", id: 70, method: "message/send", params: { message: msg([{ kind: "text", text: "convertir 100 USD a VES" }]) } });
  const t = r.json?.result;
  check("0.3 message/send -> kind=task, state=completed", t?.kind === "task" && t.status?.state === "completed" && t.artifacts?.[0]?.parts?.some((p) => p.kind === "data"), t?.artifacts?.[0]?.parts?.[0]?.text);
  const r2 = await rpc({ jsonrpc: "2.0", id: 71, method: "message/send", params: { message: msg([{ kind: "data", data: { skill: "status" } }]) } });
  check("0.3 DataPart status", r2.json?.result?.status?.state === "completed");
  const r3 = await rpc({ jsonrpc: "2.0", id: 72, method: "message/stream", params: { message: msg([{ kind: "text", text: "hola" }]) } });
  check("0.3 message/stream -> -32004 unsupported", r3.json?.error?.code === -32004, JSON.stringify(r3.json?.error));
  const r4 = await rpc({ jsonrpc: "2.0", id: 73, method: "tasks/get", params: { id: "nope" } });
  check("0.3 tasks/get -> -32001", r4.json?.error?.code === -32001, JSON.stringify(r4.json?.error));
  const r5 = await rpc({ jsonrpc: "2.0", id: 74, method: "SendMessage", params: { message: v1msg([{ text: "status" }]) } });
  check("1.0 method without header -> served as 1.0", r5.json?.result?.task?.status?.state === "TASK_STATE_COMPLETED");
}

console.log("\nHTTP hardening:");
{
  const big = await rpc({ jsonrpc: "2.0", id: 80, method: "SendMessage", params: { message: v1msg([{ text: "x".repeat(70_000) }]) } }, { "A2A-Version": "1.0" });
  check("POST > 64 KB -> 413", big.status === 413, String(big.status));
  const get = await fetch(endpoint);
  check("GET /a2a (json) -> 405", get.status === 405, String(get.status));
  const opt = await fetch(endpoint, { method: "OPTIONS", headers: { origin: "https://example.com", "access-control-request-method": "POST", "access-control-request-headers": "a2a-version,content-type" } });
  check("OPTIONS /a2a preflight 204 + CORS incl. A2A-Version", opt.status === 204 && opt.headers.get("access-control-allow-origin") === "*" && /A2A-Version/.test(opt.headers.get("access-control-allow-headers") ?? ""));
  const post = await send1([{ text: "status" }], 81);
  check("POST /a2a response has CORS", post.res.headers.get("access-control-allow-origin") === "*");
}

// ------------------------------------------------------------- official SDK client
// The card points at https://mcp.bcv.today; route those requests to the local Worker.
const localFetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return fetch(url.replace(PUBLIC, base), init);
};

console.log("\nofficial @a2a-js/sdk client:");
{
  const factory = new ClientFactory({
    transports: [new JsonRpcTransportFactory({ fetchImpl: localFetch, legacyCompat: { enabled: true } })],
    cardResolver: new DefaultAgentCardResolver({ fetchImpl: localFetch, legacyCompat: { enabled: true } }),
  });
  const client = await factory.createFromUrl(PUBLIC);
  const card = await client.getAgentCard();
  check("SDK client discovered card via /.well-known/agent-card.json", card.name === siteCard.name && card.supportedInterfaces.length === 2, card.supportedInterfaces.map((s) => `${s.protocolBinding}@${s.protocolVersion}`).join(", "));

  const ask = (text) => client.sendMessage({ message: Message.fromJSON({ role: "ROLE_USER", messageId: crypto.randomUUID(), parts: [{ text }] }) });
  const res = await ask("100 dólares en bolívares");
  const task = "status" in res ? res : undefined;
  const parts = task?.artifacts?.[0]?.parts ?? [];
  const txt = parts.find((p) => p.content?.$case === "text")?.content.value;
  const dat = parts.find((p) => p.content?.$case === "data")?.content.value;
  check("SDK client sendMessage (1.0) -> completed task", task?.status?.state === 3 && dat?.skill === "convert", txt);

  const help = await client.sendMessage({ message: Message.fromJSON({ role: "ROLE_USER", messageId: crypto.randomUUID(), parts: [{ text: "???" }] }) });
  check("SDK client unknown request -> Message", "parts" in help && help.role === 2);

  let notFound = "";
  try {
    await client.getTask({ id: task?.id ?? "x", historyLength: 0, tenant: "" });
  } catch (err) {
    notFound = `${err.constructor.name}: ${err.message}`;
  }
  check("SDK client getTask -> TaskNotFoundError (stateless)", /TaskNotFound/i.test(notFound), notFound);

  // Force the 0.3 interface to exercise the SDK's legacy transport end to end.
  const legacyCard = { ...card, supportedInterfaces: card.supportedInterfaces.filter((s) => s.protocolVersion === "0.3") };
  const legacyClient = await factory.createFromAgentCard(legacyCard);
  const lres = await legacyClient.sendMessage({ message: Message.fromJSON({ role: "ROLE_USER", messageId: crypto.randomUUID(), parts: [{ text: "USD rate on 2026-01-04" }] }) });
  const lparts = lres.artifacts?.[0]?.parts ?? [];
  check("SDK client via 0.3 legacy transport -> completed task", lres.status?.state === 3 && lparts.some((p) => p.content?.$case === "data"), lparts.find((p) => p.content?.$case === "text")?.content.value?.slice(0, 120));
}

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
