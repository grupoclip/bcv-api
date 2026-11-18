// Offline test helpers: recorded API responses shared with the Python library
// (python/tests/fixtures), a fake fetch and a local HTTP server serving them.
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

export const FIXTURES = fileURLToPath(new URL("../../python/tests/fixtures/", import.meta.url));
export const PREFIX = "https://bcv.today/api/v1/";
/** Frozen "now": 2026-11-18 11:00 in Caracas (the fixtures were recorded that day). */
export const NOW = Date.UTC(2026, 10, 18, 15, 0);

function fixture(rel) {
  const path = FIXTURES + rel;
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/**
 * fetch() replacement serving fixtures by URL; `overrides` maps a URL to
 * `{ status, body }` or to a function that throws. Records calls and headers.
 */
export function fakeFetch(overrides = {}) {
  const calls = [];
  const headers = [];
  const fn = async (url, init = {}) => {
    calls.push(url);
    headers.push(init.headers ?? {});
    const o = overrides[url];
    if (typeof o === "function") return o(url, init);
    if (o) return new Response(o.body, { status: o.status ?? 200 });
    if (!url.startsWith(PREFIX)) throw new Error(`unexpected URL ${url}`);
    const body = fixture(url.slice(PREFIX.length));
    return body === undefined ? new Response("<html>404</html>", { status: 404 }) : new Response(body, { status: 200 });
  };
  fn.calls = calls;
  fn.headers = headers;
  return fn;
}

/** Local HTTP server with the fixtures under /api/v1/; resolves to its origin. */
export async function fixtureServer() {
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    const body = path.startsWith("/api/v1/") ? fixture(path.slice("/api/v1/".length)) : undefined;
    if (path === "/llms.txt") {
      res.writeHead(200, { "content-type": "text/plain" }).end("# BCV Today (fixture)\n");
      return;
    }
    if (body === undefined) {
      res.writeHead(404, { "content-type": "text/html" }).end("<html>404</html>");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}
