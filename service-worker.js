const CACHE_VERSION = "bcv-today-v3";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;

const STATIC_URLS = [
  "/",
  "/offline/",
  "/assets/logo.svg",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/css/style.css",
  "/assets/js/share-link.js",
  "/assets/js/webmcp.js",
  "/assets/js/code-copy.js",
  "/assets/js/dashboard.js",
  "/assets/js/history.js",
  "/service-worker.js",
  "/manifest.webmanifest",
];

const API_URLS = [
  "/api/v1/rate.json",
  "/api/v1/status.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_URLS)),
      caches.open(API_CACHE).then((cache) => cache.addAll(API_URLS)),
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
    event.respondWith(cacheFirst(request));
  }
});
