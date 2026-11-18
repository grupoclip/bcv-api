---
layout: 
sitemap: false
---

{%- assign v = site.asset_version | default: '' -%}
{%- if v == '' -%}{%- assign v = site.time | date: '%Y%m%d%H%M%S' -%}{%- endif -%}
const CACHE_VERSION = "bcv-today-{{ v }}";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;

const STATIC_URLS = [
  "/",
  "/en/",
  "/offline/",
  "/history/",
  "/en/history/",
  "/api/",
  "/en/api/",
  "/dolar-bcv/",
  "/euro-bcv/",
  "/yuan-bcv/",
  "/lira-bcv/",
  "/rublo-bcv/",
  "/en/bcv-dollar/",
  "/en/bcv-euro/",
  "/en/bcv-yuan/",
  "/en/bcv-lira/",
  "/en/bcv-ruble/",
  "/favicon.ico",
  "/assets/logo.svg",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/css/style.css",
  "/assets/js/dashboard.js",
  "/assets/js/history.js",
  "/assets/js/share-link.js",
  "/assets/js/code-copy.js",
  "/assets/js/webmcp.js",
  "/service-worker.js",
  "/manifest.webmanifest",
  "/en/manifest.webmanifest",
];

const API_URLS = [
  "/api/v1/rate.json",
  "/api/v1/status.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      // cache: "reload" skips the browser HTTP cache, so a new worker never
      // precaches a stale copy of a file.
      caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_URLS.map((u) => new Request(u, { cache: "reload" })))),
      caches.open(API_CACHE).then((cache) => cache.addAll(API_URLS.map((u) => new Request(u, { cache: "reload" })))),
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== API_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

// Versioned assets (?v=<deploy>) never change at a given URL: serve from cache.
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

// Unversioned assets (manifest icons, files linked from outside the layout):
// answer from cache right away, refresh the cached copy in the background.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || refresh;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/v1/")) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request, STATIC_CACHE).catch(() => caches.match("/offline/"))
    );
    return;
  }

  if (
    ["style", "script", "image", "font", "manifest"].includes(
      request.destination
    )
  ) {
    event.respondWith(url.searchParams.has("v") ? cacheFirst(request) : staleWhileRevalidate(request));
  }
});
