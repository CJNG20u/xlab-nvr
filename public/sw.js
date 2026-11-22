const CACHE_VERSION = 'v2';
const SHELL_CACHE = `xlab-nvr-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `xlab-nvr-assets-${CACHE_VERSION}`;
const ACTIVE_CACHES = new Set([SHELL_CACHE, ASSET_CACHE]);

const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

const BYPASS_PREFIXES = ['/api', '/go2rtc', '/recordings'];
const STATIC_ASSET_EXT = /\.(?:js|mjs|css|svg|png|jpg|jpeg|webp|ico|woff2?|ttf|webmanifest)$/i;

function shouldBypassRequest(request, url) {
  if (request.method !== 'GET') return true;
  if (url.origin !== self.location.origin) return true;

  // Never intercept byte-range media requests (MP4 seeking / HTTP 206)
  if (request.headers.has('range')) return true;

  // Never intercept Server-Sent Events or WebSocket upgrades
  const accept = (request.headers.get('accept') || '').toLowerCase();
  if (accept.includes('text/event-stream')) return true;
  if ((request.headers.get('upgrade') || '').toLowerCase() === 'websocket') return true;

  // Strictly bypass NVR APIs, go2rtc proxy endpoints, and NAS recordings
  for (const prefix of BYPASS_PREFIXES) {
    if (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) {
      return true;
    }
  }

  return false;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        Promise.allSettled(
          PRECACHE_URLS.map((assetUrl) =>
            cache.add(new Request(assetUrl, { cache: 'reload' }))
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !ACTIVE_CACHES.has(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Explicit no-op bypass for streams, APIs, recordings, Range requests, and non-GETs
  if (shouldBypassRequest(request, url)) {
    return;
  }

  // Network-first for HTML document navigations so container rebuild updates apply immediately
  const isNavigation =
    request.mode === 'navigate' ||
    (request.headers.get('accept') || '').toLowerCase().includes('text/html');

  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok && response.status === 200) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy)).catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match('/') || (await caches.match(request));
          if (cached) return cached;
          return new Response('xlab-nvr is offline. Waiting for NVR server connection.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        })
    );
    return;
  }

  // Stale-while-revalidate for static frontend app shell assets
  const isStaticAsset =
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    STATIC_ASSET_EXT.test(url.pathname);

  if (isStaticAsset) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((response) => {
            if (response && response.ok && response.status === 200) {
              cache.put(request, response.clone()).catch(() => {});
            }
            return response;
          })
          .catch(() => null);

        if (cached) {
          event.waitUntil(networkPromise);
          return cached;
        }

        const networkResponse = await networkPromise;
        if (networkResponse) return networkResponse;

        return new Response('', { status: 504 });
      })
    );
  }
});
