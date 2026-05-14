// BLOGY service worker — makes the app installable and work offline.
// Bump CACHE_VERSION whenever index.html / app.js / styles change so users get fresh files.
const CACHE_VERSION = "blogy-v52";
const APP_SHELL = [
  "./",
  "./index.html",
  "./app.js?v=52",
  "./styles.css?v=52",
  "./manifest.webmanifest",
  "./assets/blogy-title.png",
  "./assets/blogy-title-mark.png",
  "./assets/blogy-icon-64.png",
  "./assets/blogy-icon-192.png",
  "./assets/blogy-icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Only manage same-origin files. Gemini API and CDN fonts always go to the network.
  if (url.origin !== self.location.origin) return;

  // Navigations: network first so updates show immediately, fall back to cached shell offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("./index.html"))
    );
    return;
  }

  if (/\.(?:css|js|html|webmanifest)$/i.test(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Static assets: serve from cache fast, refresh the copy in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
