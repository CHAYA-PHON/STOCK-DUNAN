const CACHE_NAME = 'wsm-attendance-v2';
const PRECACHE_ASSETS = ['./', './index.html', './app_icon.jpg', './manifest.json'];

self.addEventListener('install', (e) => {
  self.skipWaiting(); // Force active immediately
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        PRECACHE_ASSETS.map((url) => {
          return cache.add(url).catch((err) => {
            console.warn('Failed to cache resource during install:', url, err);
          });
        })
      );
    })
  );
});

// Clean up old caches on activation
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('Removing old service worker cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => {
      return self.clients.claim(); // Claim all clients immediately
    })
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Skip caching for external APIs, server APIs, and non-GET requests
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api') || !url.protocol.startsWith('http')) {
    return;
  }

  // Network-First strategy for index.html / root path to prevent stale bundle references
  const isHTML = e.request.headers.get('accept')?.includes('text/html') || 
                 url.pathname === '/' || 
                 url.pathname.endsWith('index.html');

  if (isHTML) {
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
          }
          return response;
        })
        .catch(() => {
          return caches.match(e.request);
        })
    );
    return;
  }

  // Cache-First (with network fallback) for static assets, images, icons, etc.
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request).then((networkResponse) => {
        if (networkResponse.ok) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
        }
        return networkResponse;
      });
    })
  );
});
