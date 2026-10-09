const CACHE = 'ovll-shell-v64';

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
  '/runtime-config.js',
  '/js/boot.js',
  '/js/functions.js',
  '/js/fileStore.js',
  '/js/artifactVisuals.js',
  '/js/artifactRequest.js',
  '/js/svgLibrary.js',
  '/js/previewSandbox.js',
  '/js/api.js',
  '/js/canvasNode.js',
  '/js/runtimeEngine.js',
  '/js/navigation.js',
  '/js/ui.js',
  '/js/workspaceStore.js',
  '/js/ovllPointerApi.js',
  '/js/ovllPointerProjection.js',
  '/js/ovllPointerGraphPatch.js',
  '/js/ovllPointerLocal.js',
  '/js/ovllPointerFunctions.js',
  '/js/ovllPointerLocalActions.js',
  '/js/ovllPointerGraphCore.mjs',
  '/js/ovllPointerPlanCore.mjs',
  '/js/libraryPage.js',
  '/js/shellMenu.js',
  '/js/ovllPresence.js',
  '/js/runtimeFinalization.js',
  '/js/app.js',
  '/js/mascot.js'
];

function isMutableAsset(url) {
  return (
    url.pathname === '/runtime-config.js' ||
    url.pathname.startsWith('/css/') ||
    url.pathname.startsWith('/js/')
  );
}

async function cacheResponse(key, response) {
  if (!response?.ok) return;

  const cache =
    await caches.open(CACHE);

  await cache.put(
    key,
    response.clone()
  );
}

async function networkFirst(
  request,
  cacheKey = request
) {
  try {
    const response =
      await fetch(
        request,
        {
          cache: 'no-cache'
        }
      );

    await cacheResponse(
      cacheKey,
      response
    );

    return response;
  } catch (error) {
    const cached =
      await caches.match(
        cacheKey
      );

    if (cached) {
      return cached;
    }

    throw error;
  }
}

async function cacheFirst(request) {
  const cached =
    await caches.match(
      request
    );

  if (cached) {
    return cached;
  }

  const response =
    await fetch(request);

  await cacheResponse(
    request,
    response
  );

  return response;
}

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
      networkFirst(
        request,
        '/home'
      )
    );
    return;
  }

  if (isMutableAsset(url)) {
    event.respondWith(
      networkFirst(request)
    );
    return;
  }

  event.respondWith(
    cacheFirst(request)
  );
});
