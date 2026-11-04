// Minimal app-shell service worker. No analytics, no push, no background sync.
// Caches only same-origin GET requests; Supabase / API traffic is never cached here.
//
// IMPORTANT: EVERYTHING same-origin is NETWORK-FIRST, including the shell
// ('/', '/index.html'). v3 kept the shell cache-first, and that blanked the
// page for returning visitors: a cached shell from an older deploy points
// at JS/CSS hashes Vercel no longer serves (old hashes 404), so React never
// mounts and the page stays white forever. Network-first for the shell too
// removes that failure mode entirely; the cache is only an offline fallback.
// Bump CACHE whenever this file changes so old caches are deleted on activate.
const CACHE = 'our-place-v4';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone();
    if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request)));
});
