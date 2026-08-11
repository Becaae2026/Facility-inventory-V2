/* Facility Inventory — service worker */
const CACHE = 'fac-inv-v3';
const ASSETS = [
  './', './index.html', './config.js', './chart.umd.js', './manifest.json',
  './icon-192.png', './icon-512.png', './BEC_logo.png', './al-ansari-logo-white-100px.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.allSettled(ASSETS.map((a) => c.add(a))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Google Apps Script API and anything cross-origin: straight to network, never cached
  if (url.origin !== location.origin) return;

  const isShellDoc = e.request.mode === 'navigate' ||
    url.pathname.endsWith('/') || url.pathname.endsWith('index.html') ||
    url.pathname.endsWith('config.js');

  if (isShellDoc) {
    // network first so updates arrive; cached copy when offline
    e.respondWith(
      fetch(e.request).then((r) => {
        const cp = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, cp));
        return r;
      }).catch(() => caches.match(e.request))
    );
  } else {
    // static assets: cache first
    e.respondWith(
      caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
        const cp = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, cp));
        return res;
      }))
    );
  }
});
