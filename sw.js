/* Trailhead offline support.
   The page itself is fetched fresh when you're online (so updates show up), and falls back to the saved copy offline.
   Everything else (fonts, photos, icons, the two libraries) is served from the saved copy and refreshed in the background.
   Bump VERSION whenever you change the list below. */
const VERSION = "trailhead-v6";
const CORE = [
  "./", "./index.html", "./manifest.webmanifest",
  "./fonts/TAYDumpling-Regular.woff", "./fonts/TAYBreadPan.woff",
  "./photos/waterfall.jpg", "./photos/rock-arch.jpg", "./photos/city-patio.jpg", "./photos/mountain.jpg", "./photos/woodcock.jpg",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/favicon-32.png",
  "./art/bird.webp", "./art/home/photo.webp", "./art/home/lineart.webp", "./art/home/topo.webp", "./art/home/linocut.webp",
  "./videos/waterfall.mp4",
  "https://cdn.jsdelivr.net/npm/ag-psd@31.0.2/dist/bundle.js",
  "https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.min.js"
];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url), same = url.origin === location.origin;
  if (!same && url.hostname !== "cdn.jsdelivr.net") return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put("./index.html", copy)); return res; }).catch(() => caches.match("./index.html").then(r => r || caches.match("./"))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(res => { if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; }).catch(() => hit);
    return hit || net;
  }));
});
