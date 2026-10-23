/* One-time handover for origins that formerly hosted main's ovll-shell SW.
 * The beta app does not register a service worker. Do not precache beta files.
 */
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Delete only caches owned by the old main worker, not unrelated caches.
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('ovll-shell-')).map(key => caches.delete(key)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.allSettled(windows
      .filter(client => new URL(client.url).origin === self.location.origin)
      .map(client => client.navigate(client.url)));
  })());
});
