const CACHE = 'clipmint-shell-v6';
const SHELL = ['/', '/manifest.json', '/app.js', '/icon.svg', '/apple-touch-icon.png'];
const TAILWIND = 'https://cdn.tailwindcss.com/';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(async cache => {
    await cache.addAll(SHELL);
    // A no-cors opaque cache entry is sufficient for the classic CDN script.
    try { const response = await fetch(TAILWIND, { mode: 'no-cors' }); await cache.put(TAILWIND, response); } catch (_) {}
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;
  if (url.href === TAILWIND) {
    event.respondWith(caches.match(TAILWIND).then(cached => cached || fetch(request).then(response => {
      caches.open(CACHE).then(cache => cache.put(TAILWIND, response.clone()));
      return response;
    })));
    return;
  }
  if (url.origin !== self.location.origin) return;
  // Never persist source URLs, media previews, downloads, or API responses.
  if (url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put('/', response.clone()));
      return response;
    }).catch(() => caches.match('/')));
    return;
  }
  if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
      return response;
    })));
  }
});
