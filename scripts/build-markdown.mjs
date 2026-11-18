#!/usr/bin/env node
// Markdown for agents, generated at build time.
//
// For every `index.html` in the built site this writes an `index.md` next to it.
// A Cloudflare URL Rewrite Rule serves that file when a request to a page asks for
// `Accept: text/markdown`, so agents keep getting Markdown at the same URL without
// a Worker running on every request (see the "Markdown for agents" step in
// .github/workflows/pages.yml).
//
// Usage: node scripts/build-markdown.mjs <site-dir> <site-url>
//   e.g. node scripts/build-markdown.mjs _site https://bcv.today

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [siteDir = "_site", siteUrl = "https://bcv.today"] = process.argv.slice(2);

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
  // Keep href on links so they survive as Markdown links.
  return html.replace(/<([a-z0-9-]+)(\s[^>]*)?>/gi, (tag, name, attrs = "") => {
    if (name.toLowerCase() === "a") {
      const href = attrs.match(/\shref=["']([^"']+)["']/i);
      return href ? `<a href="${href[1]}">` : "<a>";
    }
    return `<${name}>`;
  });
}

// Same conversion the former Cloudflare Worker (workers/markdown-for-agents.js) used.
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
    .replace(/<a href=["']([^"']+)["']>([\s\S]*?)<\/a>/gi, (_, href, text) => {
      let target = href;
      try {
        target = new URL(decodeEntities(href), url).href;
      } catch {}
      return `[${text}](${target})`;
    })
    .replace(/<th>([\s\S]*?)<\/th>/gi, "$1 | ")
    .replace(/<td>([\s\S]*?)<\/td>/gi, "$1 | ")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/?(table|thead|tbody|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  // Trim indentation left by the HTML source, except inside fenced code blocks.
  let inFence = false;
  body = decodeEntities(body)
    .split("\n")
    .map((line) => {
      if (line.trim().startsWith("```")) {
        inFence = !inFence;
        return line.trim();
      }
      return inFence ? line : line.trim();
    })
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const draft = [body, jsonLd.length ? "```json\n" + jsonLd.join("\n") + "\n```" : ""]
    .filter(Boolean)
    .join("\n\n");

  const frontmatter = [
    "---",
    title ? `title: ${JSON.stringify(decodeEntities(title))}` : "",
    description ? `description: ${JSON.stringify(description)}` : "",
    `url: ${JSON.stringify(url)}`,
    // Was the X-Markdown-Tokens response header when a Worker served this.
    `tokens: ${estimateTokens(draft)}`,
    "---",
  ].filter(Boolean);

  return [frontmatter.join("\n"), draft].filter(Boolean).join("\n\n") + "\n";
}

async function* indexPages(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* indexPages(full);
    else if (entry.name === "index.html") yield full;
  }
}

let count = 0;
for await (const file of indexPages(siteDir)) {
  const rel = path.relative(siteDir, path.dirname(file)).split(path.sep).join("/");
  const url = siteUrl.replace(/\/$/, "") + "/" + (rel ? rel + "/" : "");
  const html = await readFile(file, "utf8");
  await writeFile(path.join(path.dirname(file), "index.md"), htmlToMarkdown(html, url));
  count += 1;
}
console.log(`build-markdown: wrote ${count} index.md files`);
