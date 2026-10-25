// DracoSkill service worker: makes the page open instantly and work offline.
//
// WHAT IT CACHES: only this site's own files (the app shell). Calls to the code-running backend are a different origin and
// are never touched: a stale compiler answer would be worse than none.
// OFFLINE: the editor, your autosaved code and the theme all work. Running code needs the server, and the page says so.
// UPDATES: bump VERSION below on every release. The new worker installs in the background, then WAITS; the page shows
// "A new version is ready" and only switches when the visitor clicks Reload, so nobody loses work mid-edit.
const VERSION = 'v1';
const CACHE = 'draco-shell-' + VERSION;

const SHELL = [
  './',
  'compiler.css',
  'compiler.js',
  'manifest.webmanifest',
  'assets/design.css',
  'assets/theme.js',
  'assets/highlight.js',
  'assets/editor.js',
  'assets/config.js',
  'assets/dracoskill-mark.png',
  'assets/fonts/bricolage.woff2',
  'assets/fonts/jetbrains-mono.woff2',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/favicon-32.png'
];

self.addEventListener('install', (event) => {
  // cache: 'reload' bypasses the HTTP cache so a new version never installs half-old files
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('draco-shell-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirst(request, cacheKey) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(cacheKey || request, fresh.clone());
    return fresh;
  } catch (err) {
    const hit = await cache.match(cacheKey || request, { ignoreSearch: !cacheKey });
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  const refresh = fetch(request).then((res) => { if (res && res.ok) cache.put(request, res.clone()); return res; }).catch(() => null);
  return hit || (await refresh) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // backend / third parties: never intercepted

  if (req.mode === 'navigate') {                               // the page itself (including /?lang=java and #share links)
    event.respondWith(networkFirst(req, new Request('./')).catch(async () => (await caches.match('./')) || Response.error()));
    return;
  }
  if (url.pathname.endsWith('/assets/config.js') || url.pathname.endsWith('/sw.js')) {   // must be fresh whenever we are online
    event.respondWith(networkFirst(req));
    return;
  }
  event.respondWith(staleWhileRevalidate(req));
});
