/* =========================================================================
   MH TRACKER — SERVICE WORKER
   App Shell & Static Asset Caching with Strict Privacy Protection
   ========================================================================= */

const CACHE_VERSION = 'mh-tracker-v1.0.0';
const STATIC_CACHE_NAME = `mh-static-${CACHE_VERSION}`;
const RUNTIME_CACHE_NAME = `mh-runtime-${CACHE_VERSION}`;

// Pre-cached App Shell resources
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/icon.svg'
];

// Install Event: Cache App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Non-fatal precache error:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: Clean up outdated caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('mh-') && name !== STATIC_CACHE_NAME && name !== RUNTIME_CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Helper: Check if request is private / sensitive API
function isSensitiveRequest(url, request) {
  // Never cache Supabase database/auth/storage API calls
  if (url.hostname.includes('supabase.co')) {
    return true;
  }
  // Never cache non-GET requests (mutations)
  if (request.method !== 'GET') {
    return true;
  }
  // Never cache endpoints containing private data
  const pathname = url.pathname.toLowerCase();
  if (
    pathname.includes('/rest/v1/') ||
    pathname.includes('/auth/v1/') ||
    pathname.includes('/storage/v1/') ||
    pathname.includes('/api/')
  ) {
    return true;
  }
  return false;
}

// Fetch Event
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Never intercept or cache sensitive backend / API requests
  if (isSensitiveRequest(url, request)) {
    return; // Allow standard network fetch without SW caching
  }

  // 2. Navigation requests (App Shell HTML): Network-First with Cache Fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(STATIC_CACHE_NAME).then((cache) => {
              cache.put('/index.html', responseClone);
            });
          }
          return response;
        })
        .catch(async () => {
          const cachedResponse = await caches.match('/index.html');
          if (cachedResponse) {
            return cachedResponse;
          }
          return caches.match('/');
        })
    );
    return;
  }

  // 3. Static Assets (JS, CSS, Fonts, Images, Icons): Cache-First / Stale-While-Revalidate
  const isStaticAsset =
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/assets/') ||
     url.pathname.startsWith('/icons/') ||
     url.pathname.endsWith('.js') ||
     url.pathname.endsWith('.css') ||
     url.pathname.endsWith('.woff2') ||
     url.pathname.endsWith('.woff') ||
     url.pathname.endsWith('.png') ||
     url.pathname.endsWith('.svg') ||
     url.pathname.endsWith('.ico') ||
     url.pathname.endsWith('.webmanifest'));

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          // Return cached and update cache in background (Stale-While-Revalidate)
          fetch(request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(RUNTIME_CACHE_NAME).then((cache) => {
                cache.put(request, networkResponse);
              });
            }
          }).catch(() => {/* Offline: silence */});
          return cachedResponse;
        }

        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(RUNTIME_CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // 4. Default: Network with Cache Fallback for other GET requests
  event.respondWith(
    fetch(request)
      .then((response) => {
        return response;
      })
      .catch(() => {
        return caches.match(request);
      })
  );
});
