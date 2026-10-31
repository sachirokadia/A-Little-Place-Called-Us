// Minimal app-shell service worker. No analytics, no push, no background sync.
// Caches only same-origin GET requests; Supabase / API traffic is never cached here.
//
// IMPORTANT: app code (JS/CSS) is fetched NETWORK-FIRST, never cache-first.
// A previous cache-first version served the first deployment's bundle forever:
// sw.js was byte-identical across deploys, so the browser never updated the
// worker and kept running stale code after redeploys. Bump CACHE whenever
// this file changes so old caches are deleted on activate.
const CACHE = 'our-place-v3';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // Shell pages may come from cache (offline fallback); everything else
  // (JS/CSS/images) goes to the network first so a redeploy takes effect
  // immediately, falling back to cache only when offline.
  if (SHELL.includes(url.pathname)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
    return;
  }
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone();
    if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request)));
});
