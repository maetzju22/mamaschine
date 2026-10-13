/* Mamaschine service worker: makes the app installable and usable with bad reception in the Waschkeller. */
const VERSION = "mm-v1";
const CORE = [
  "/", "/index.html", "/style.css", "/app.js", "/install.js",
  "/werben.html", "/impressum.html", "/datenschutz.html",
  "/favicon.svg", "/manifest.webmanifest",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png",
  "/fonts/anton-latin-400-normal.woff2",
  "/fonts/archivo-latin-400-normal.woff2", "/fonts/archivo-latin-600-normal.woff2", "/fonts/archivo-latin-800-normal.woff2",
  "/fonts/jetbrains-mono-latin-500-normal.woff2", "/fonts/jetbrains-mono-latin-700-normal.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  // Pages: network first, cached copy when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then((r) => r || caches.match("/")))
    );
    return;
  }

  // Assets: serve from cache, refresh in the background.
  e.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req)
        .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
