/* TArrow service worker: offline app shell + cache-first for on-device OCR assets. */
const VERSION = "tarrow-v1";
const SHELL = ["/offline", "/icons/icon-192.png", "/manifest.webmanifest"];
const ASSET_CACHE = "tarrow-ocr-assets-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== ASSET_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // OCR models, ONNX runtime, Tesseract: cache-first so auto-fill works offline after first use.
  if (/^\/(models|ort|tesseract)\//.test(url.pathname)) {
    e.respondWith(
      caches.open(ASSET_CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }
  // Static build assets: stale-while-revalidate.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    e.respondWith(
      caches.open(VERSION).then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      }),
    );
    return;
  }
  // Pages: network first, offline page when there's no connection. Never cache API/data.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/offline")));
  }
});
