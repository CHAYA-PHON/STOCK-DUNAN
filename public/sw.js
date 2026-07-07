const CACHE_NAME = 'wsm-attendance-v1';
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Gracefully attempt to cache resources, catching individual failures so a single 404 doesn't break installation
      return Promise.allSettled(
        ['./', './index.html', './app_icon.jpg', './manifest.json'].map((url) => {
          return cache.add(url).catch((err) => {
            console.warn('Failed to cache resource during install:', url, err);
          });
        })
      );
    })
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => {
      return res || fetch(e.request);
    })
  );
});
