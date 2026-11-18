// BCV Today remote MCP server and A2A agent — Cloudflare Worker on the
// mcp.bcv.today custom domain.
//
// Stateless Streamable HTTP: every POST /mcp builds a fresh McpServer and a
// WebStandardStreamableHTTPServerTransport with no session id and JSON
// responses, so there is no Durable Object, no session storage and no
// long-lived SSE stream (Free-plan friendly). POST /a2a is the A2A
// (Agent2Agent) JSON-RPC endpoint, also stateless (see a2a/handler.ts).
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import serverCard from "../../../site/.well-known/mcp/server-card.json";
import { AGENT_CARD_V1, compatAgentCard, handleA2A, wantsV1 } from "./a2a/handler.js";
import { DataClient } from "./data.js";
import { SERVER_VERSION, buildServer } from "./server.js";
import { type BotDeps, type Update, announce, handleUpdate, telegramClient } from "./telegram/bot.js";

export interface Env {
  DATA_ORIGIN?: string;
  /** Telegram bot (@BCVTodayBot). Secrets, set with `wrangler secret put`. */
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  /** Public channel the daily rate is posted to, e.g. "@bcvtoday". */
  TELEGRAM_CHANNEL?: string;
  TELEGRAM_KV?: KVNamespace;
}

function botDeps(env: Env): BotDeps | undefined {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_KV) return undefined;
  return {
    data: new DataClient(env.DATA_ORIGIN || "https://bcv.today"),
    telegram: telegramClient(env.TELEGRAM_BOT_TOKEN),
    kv: env.TELEGRAM_KV,
    channel: env.TELEGRAM_CHANNEL || "@bcvtoday",
    site: env.DATA_ORIGIN || "https://bcv.today",
  };
}

/** Telegram webhook: verifies the secret header, answers 200 at once and handles the update in the background. */
async function handleTelegram(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const deps = botDeps(env);
  if (!deps || !env.TELEGRAM_WEBHOOK_SECRET) return new Response("Not found\n", { status: 404 });
  if (request.method !== "POST") return new Response("Method not allowed\n", { status: 405, headers: { Allow: "POST" } });
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Forbidden\n", { status: 403 });
  }
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BODY_BYTES) return new Response("Too large\n", { status: 413 });
  let update: Update;
  try {
    update = (await request.json()) as Update;
  } catch {
    return new Response("Bad request\n", { status: 400 });
  }
  ctx.waitUntil(handleUpdate(deps, update).catch((err) => console.error("telegram update failed", err)));
  return new Response("ok\n");
}

const MAX_BODY_BYTES = 64 * 1024;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID, A2A-Version, A2A-Extensions, X-A2A-Extensions",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version, ETag, A2A-Version",
  "Access-Control-Max-Age": "86400",
};

function withCors(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS_HEADERS)) out.headers.set(k, v);
  out.headers.set("X-Content-Type-Options", "nosniff");
  return out;
}

function jsonRpcError(status: number, message: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

const HOME_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BCV Today MCP server and A2A agent</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--muted:#5c5c5c;--code:#f2f2f2}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#ececec;--muted:#a8a8a8;--code:#222}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,sans-serif}
main{max-width:42rem;margin:0 auto;padding:2rem 1rem}
code,pre{background:var(--code);border-radius:6px;font-size:.9em}
code{padding:.1em .3em}pre{padding:.8rem;overflow-x:auto}
p.muted{color:var(--muted)}
</style>
</head>
<body>
<main>
<h1>BCV Today MCP server</h1>
<p>Remote <a href="https://modelcontextprotocol.io">Model Context Protocol</a> server with the official
Banco Central de Venezuela exchange rates (USD, EUR, CNY, TRY and RUB against the bolívar).
Free, public, read-only, no authentication.</p>
<p>Endpoint (Streamable HTTP): <code>https://mcp.bcv.today/mcp</code></p>
<pre>{
  "mcpServers": {
    "bcv-today": { "type": "http", "url": "https://mcp.bcv.today/mcp" }
  }
}</pre>
<p>Tools: <code>get_latest_rates</code>, <code>get_rate_by_date</code>, <code>get_history</code>,
<code>convert</code>, <code>get_status</code>.</p>
<h2>A2A agent</h2>
<p><a href="https://a2a-protocol.org">Agent2Agent (A2A)</a> endpoint (JSON-RPC, A2A 1.0 and 0.3):
<code>https://mcp.bcv.today/a2a</code> · <a href="/.well-known/agent-card.json">agent card</a>.
Ask in Spanish or English (“convertir 100 USD a VES”, “USD rate on 2026-01-04”) or send a DataPart
such as <code>{"skill":"convert","amount":100,"from":"USD","to":"VES"}</code>.</p>
<p>Docs: <a href="https://bcv.today/en/api/#mcp-server">bcv.today/en/api</a> ·
<a href="https://bcv.today/api/#servidor-mcp">bcv.today/api (español)</a> ·
<a href="/mcp/server-card">server card</a> ·
<a href="https://bcv.today/llms.txt">llms.txt</a></p>
<p class="muted">Unofficial project, not affiliated with Banco Central de Venezuela.</p>
</main>
</body>
</html>`;

function serveAgentCard(request: Request): Response {
  const v1 = wantsV1(request);
  return new Response(JSON.stringify(v1 ? AGENT_CARD_V1 : compatAgentCard(), null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      Vary: "A2A-Version",
    },
  });
}

function serveCard(): Response {
  return new Response(JSON.stringify(serverCard, null, 2), {
    headers: {
      "Content-Type": "application/mcp-server-card+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    // Stateless server: no standalone SSE stream (spec allows 405 here).
    const accept = request.headers.get("Accept") ?? "";
    if (!accept.includes("text/event-stream") && accept.includes("text/html")) {
      return new Response(HOME_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return jsonRpcError(405, "Method not allowed: this stateless server only accepts POST on /mcp.", {
      Allow: "POST, OPTIONS",
    });
  }
  if (request.method !== "POST") {
    return jsonRpcError(405, "Method not allowed.", { Allow: "GET, POST, OPTIONS" });
  }

  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return jsonRpcError(413, `Request body too large (max ${MAX_BODY_BYTES} bytes).`);
  }

  const data = new DataClient(env.DATA_ORIGIN || "https://bcv.today");
  const server = buildServer(data);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_BODY_BYTES,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // Telegram webhook: server-to-server, no CORS.
    if (path === "/telegram") return handleTelegram(request, env, ctx);

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    try {
      if (path === "/mcp") return withCors(await handleMcp(request, env));
      if (path === "/a2a") {
        if (request.method === "GET" && (request.headers.get("Accept") ?? "").includes("text/html")) {
          return withCors(new Response(HOME_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } }));
        }
        const data = new DataClient(env.DATA_ORIGIN || "https://bcv.today");
        return withCors(await handleA2A(request, data, MAX_BODY_BYTES));
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        return withCors(new Response("Method not allowed\n", { status: 405, headers: { Allow: "GET, HEAD, OPTIONS" } }));
      }
      if (path === "/mcp/server-card" || path === "/.well-known/mcp/server-card.json") {
        return withCors(serveCard());
      }
      if (path === "/.well-known/agent-card.json" || path === "/.well-known/agent.json" || path === "/a2a/agent-card") {
        return withCors(serveAgentCard(request));
      }
      if (path === "/") {
        return withCors(
          new Response(HOME_HTML, {
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" },
          }),
        );
      }
      if (path === "/health") {
        return withCors(Response.json({ ok: true, version: SERVER_VERSION }));
      }
      return withCors(
        new Response("Not found. MCP endpoint: https://mcp.bcv.today/mcp · A2A endpoint: https://mcp.bcv.today/a2a\n", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
      );
    } catch (err) {
      console.error("unhandled", err);
      return withCors(jsonRpcError(500, "Internal server error."));
    }
  },

  /** Cron trigger (wrangler.toml): post a newly published BCV rate to the channel and subscribers. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const deps = botDeps(env);
    if (!deps) return;
    ctx.waitUntil(
      announce(deps)
        .then((r) => console.log("telegram announce", JSON.stringify(r)))
        .catch((err) => console.error("telegram announce failed", err)),
    );
  },
} satisfies ExportedHandler<Env>;
