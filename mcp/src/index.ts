// BCV Today remote MCP server — Cloudflare Worker on the mcp.bcv.today custom domain.
//
// Stateless Streamable HTTP: every POST /mcp builds a fresh McpServer and a
// WebStandardStreamableHTTPServerTransport with no session id and JSON
// responses, so there is no Durable Object, no session storage and no
// long-lived SSE stream (Free-plan friendly).
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import serverCard from "../../.well-known/mcp/server-card.json";
import { DataClient } from "./data.js";
import { SERVER_VERSION, buildServer } from "./server.js";

export interface Env {
  DATA_ORIGIN?: string;
}

const MAX_BODY_BYTES = 64 * 1024;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version, ETag",
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
<title>BCV Today MCP server</title>
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
<p>Docs: <a href="https://bcv.today/en/api/#mcp-server">bcv.today/en/api</a> ·
<a href="https://bcv.today/api/#servidor-mcp">bcv.today/api (español)</a> ·
<a href="/mcp/server-card">server card</a> ·
<a href="https://bcv.today/llms.txt">llms.txt</a></p>
<p class="muted">Unofficial project, not affiliated with Banco Central de Venezuela.</p>
</main>
</body>
</html>`;

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
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    try {
      if (path === "/mcp") return withCors(await handleMcp(request, env));

      if (request.method !== "GET" && request.method !== "HEAD") {
        return withCors(new Response("Method not allowed\n", { status: 405, headers: { Allow: "GET, HEAD, OPTIONS" } }));
      }
      if (path === "/mcp/server-card" || path === "/.well-known/mcp/server-card.json") {
        return withCors(serveCard());
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
        new Response("Not found. MCP endpoint: https://mcp.bcv.today/mcp\n", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
      );
    } catch (err) {
      console.error("unhandled", err);
      return withCors(jsonRpcError(500, "Internal server error."));
    }
  },
} satisfies ExportedHandler<Env>;
