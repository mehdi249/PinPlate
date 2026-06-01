// PinPlate Service Worker
// Strategy: network-first for our own HTML (always fresh), cache-first for CDN assets (fast + offline)

const APP_CACHE = 'pinplate-app-v1';
const CDN_CACHE = 'pinplate-cdn-v1';
const APP_ORIGIN = 'https://mehdi249.github.io';
const APP_PATH   = '/PinPlate';
const CDN_HOSTS  = ['unpkg.com','cdn.jsdelivr.net','fonts.googleapis.com','fonts.gstatic.com','tile.openstreetmap.org'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Our app HTML — always go to network first so updates land immediately
  if (url.origin === APP_ORIGIN && url.pathname.startsWith(APP_PATH)) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(r => {
          if (r.ok) caches.open(APP_CACHE).then(c => c.put(e.request, r.clone()));
          return r;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // CDN assets (React, Leaflet, Supabase, fonts, map tiles) — cache-first for speed + offline
  if (CDN_HOSTS.some(h => url.hostname.includes(h))) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(r => {
          if (r.ok) caches.open(CDN_CACHE).then(c => c.put(e.request, r.clone()));
          return r;
        });
      })
    );
  }
});
