const AGENT_LINK_HEADER = [
  '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
  '</openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
  '</api/>; rel="service-doc"; type="text/html"',
  '</llms.txt>; rel="describedby"; type="text/plain"',
  '</.well-known/agent-card.json>; rel="describedby"; type="application/json"',
  '</.well-known/agent-skills/index.json>; rel="describedby"; type="application/json"',
].join(", ");

function wantsMarkdown(request) {
  const accept = request.headers.get("Accept") || "";
  return accept.toLowerCase().includes("text/markdown");
}

function isHtml(response) {
  const contentType = response.headers.get("Content-Type") || "";
  return contentType.toLowerCase().includes("text/html");
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(text.trim().split(/\s+/).filter(Boolean).length * 1.33));
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function textFromMeta(html, selector) {
  const pattern = new RegExp(
    `<meta\\s+(?=[^>]*${selector})[^>]*content=["']([^"']*)["'][^>]*>`,
    "i"
  );
  const match = html.match(pattern);
  return match ? decodeEntities(match[1].trim()) : "";
}

function stripAttributes(html) {
  return html.replace(/<([a-z0-9-]+)(?:\s[^>]*)?>/gi, "<$1>");
}

function htmlToMarkdown(html, url) {
  const title =
    textFromMeta(html, `property=["']og:title["']`) ||
    (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [null, ""])[1].trim();
  const description = textFromMeta(html, `name=["']description["']`);

  const jsonLd = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);

  let body = (html.match(/<main[^>]*>([\s\S]*?)<\/main>/i) || html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [null, html])[1];

  body = body
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "");

  body = stripAttributes(body)
    .replace(/<h1>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<h4>([\s\S]*?)<\/h4>/gi, "\n#### $1\n")
    .replace(/<p>([\s\S]*?)<\/p>/gi, "\n$1\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<b>([\s\S]*?)<\/b>/gi, "**$1**")
    .replace(/<em>([\s\S]*?)<\/em>/gi, "_$1_")
    .replace(/<i>([\s\S]*?)<\/i>/gi, "_$1_")
    .replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<pre>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n")
    .replace(/<li>([\s\S]*?)<\/li>/gi, "\n- $1")
    .replace(/<\/?(ul|ol)>/gi, "\n")
    .replace(/<a href=["']([^"']+)["']>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<th>([\s\S]*?)<\/th>/gi, "$1 | ")
    .replace(/<td>([\s\S]*?)<\/td>/gi, "$1 | ")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/?(table|thead|tbody|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  body = decodeEntities(body)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const frontmatter = [
    "---",
    title ? `title: ${JSON.stringify(decodeEntities(title))}` : "",
    description ? `description: ${JSON.stringify(description)}` : "",
    `url: ${JSON.stringify(url)}`,
    "---",
  ].filter(Boolean);

  const parts = [frontmatter.join("\n"), body];
  if (jsonLd.length) {
    parts.push("```json\n" + jsonLd.join("\n") + "\n```");
  }

  return parts.filter(Boolean).join("\n\n") + "\n";
}

async function markdownResponse(request, originResponse) {
  const html = await originResponse.text();
  const markdown = htmlToMarkdown(html, request.url);
  const headers = new Headers(originResponse.headers);
  headers.set("Content-Type", "text/markdown; charset=utf-8");
  headers.set("Vary", "Accept");
  headers.set("X-Markdown-Tokens", String(estimateTokens(markdown)));
  headers.delete("Content-Length");

  const url = new URL(request.url);
  if (url.pathname === "/") {
    headers.set("Link", AGENT_LINK_HEADER);
  }

  return new Response(markdown, {
    status: originResponse.status,
    statusText: originResponse.statusText,
    headers,
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const markdownRequest = wantsMarkdown(request);
    const originRequest =
      markdownRequest && request.method === "HEAD"
        ? new Request(request, { method: "GET" })
        : request;
    const originResponse = await fetch(originRequest);

    if (markdownRequest && isHtml(originResponse)) {
      const response = await markdownResponse(request, originResponse);
      if (request.method === "HEAD") {
        return new Response(null, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
      return response;
    }

    if (url.pathname === "/" && !originResponse.headers.has("Link")) {
      const headers = new Headers(originResponse.headers);
      headers.set("Link", AGENT_LINK_HEADER);
      return new Response(originResponse.body, {
        status: originResponse.status,
        statusText: originResponse.statusText,
        headers,
      });
    }

    return originResponse;
  },
};
