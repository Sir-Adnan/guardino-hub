const CACHE_NAME = "guardino-pwa-v4-brand-refresh";
const APP_SHELL = [
  "/manifest.webmanifest",
  "/favicon.ico",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/brand/guardino-mark.png",
  "/brand/guardino-logo.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png"
];

async function networkFirst(request) {
  try {
    const response = await fetch(request, { cache: "no-cache" });
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error("Network request failed and no cache entry is available.");
  }
}

async function freshAsset(request) {
  try {
    const response = await fetch(request, { cache: "reload" });
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error("Asset request failed and no cache entry is available.");
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => null)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (
    url.pathname.startsWith("/api/") ||
    url.pathname === "/openapi.json" ||
    url.pathname === "/docs" ||
    url.pathname === "/redoc" ||
    url.pathname === "/health"
  ) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-cache" }).catch(
        () =>
          new Response("Guardino Hub is offline. Please reconnect and try again.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          })
      )
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/brand/") ||
    url.pathname === "/favicon.ico" ||
    url.pathname === "/favicon-16x16.png" ||
    url.pathname === "/favicon-32x32.png" ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(freshAsset(request));
  }
});
