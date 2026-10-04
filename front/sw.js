const CACHE = 'ovll-shell-v41';

const SHELL = [
  '/home',
  '/manifest.webmanifest',
  '/pwa-icon.svg',
  '/pwa-192.png',
  '/pwa-512.png',
  '/css/style.css',
  '/css/ui.css',
  '/css/node.css',
  '/css/chat.css',
  '/css/library.css',
  '/css/shellMenu.css',
  '/js/boot.js',
  '/js/functions.js',
  '/js/fileStore.js',
  '/js/artifactVisuals.js',
  '/js/svgLibrary.js',
  '/js/previewSandbox.js',
  '/js/api.js',
  '/js/canvasNode.js',
  '/js/runtimeEngine.js',
  '/js/ui.js',
  '/js/workspaceStore.js',
  '/js/libraryPage.js',
  '/js/shellMenu.js',
  '/js/ovllPresence.js',
  '/js/app.js',
  '/js/mascot.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put('/home', copy));
          return response;
        })
        .catch(() => caches.match('/home'))
    );
    return;
  }

  event.respondWith(
    caches.match(request)
      .then(cached => cached || fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      }))
  );
});
