// Service Worker: hält die App offline verfügbar.
// Strategie: sofort aus dem Cache antworten und im Hintergrund aktualisieren
// (neue Versionen greifen also beim nächsten Öffnen der App).
const CACHE = 'restlos-v1';
const FILES = [
  './',
  'index.html',
  'css/style.css',
  'js/theme.js',
  'js/app.js',
  'manifest.webmanifest',
  'assets/favicon.svg',
  'assets/fonts/recursive-latin.woff2',
  'assets/fonts/recursive-latin-ext.woff2',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    // Seitenaufrufe (auch mit ?query) landen auf der gecachten Startseite
    const key = req.mode === 'navigate' ? './' : req;
    const cached = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
    const update = fetch(req).then(res => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    }).catch(() => cached);
    if (cached) {
      e.waitUntil(update);
      return cached;
    }
    return update;
  }));
});
