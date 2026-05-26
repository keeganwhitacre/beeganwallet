const CACHE_NAME = 'beeganwallet-v4';

// Core assets to cache immediately
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './fonts/Saans-TRIAL-Regular.woff2',
    './fonts/Saans-TRIAL-Medium.woff2',
    './fonts/Saans-TRIAL-SemiBold.woff2',
    './fonts/SaansMono-TRIAL-Regular.woff2'
];

// Install event - Cache core files
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

// Activate event - Clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch event - Stale-While-Revalidate strategy
self.addEventListener('fetch', (event) => {
    // Only cache GET requests
    if (event.request.method !== 'GET') return;
    
    // Bypass caching for GitHub API calls so sync is always fresh when online
    if (event.request.url.includes('api.github.com')) return;

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                // Open cache and store the new response for next time
                caches.open(CACHE_NAME).then((cache) => {
                    // Only cache valid HTTP responses (prevents caching chrome-extension:// etc)
                    if (networkResponse.ok && event.request.url.startsWith('http')) {
                        cache.put(event.request, networkResponse.clone());
                    }
                });
                return networkResponse;
            }).catch(() => {
                // Offline fallback - ignore fetch errors
            });

            // Return cached response immediately if available, otherwise wait for network
            return cachedResponse || fetchPromise;
        })
    );
});