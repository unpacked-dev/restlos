// Service Worker: hält die App offline verfügbar.
// Die App-Dateien kommen immer aus dem Cache. Beim Start fragt die Seite per Nachricht
// nach Updates (siehe js/update.js); nur dann werden die Dateien neu geladen.
const CACHE = 'restlos-v2';
// Dateien, aus denen die App besteht – werden beim Update-Check zusammen geprüft und getauscht
const CORE = [
  './',
  'index.html',
  'css/style.css',
  'js/update.js',
  'js/theme.js',
  'js/app.js',
  'manifest.webmanifest'
];
const FILES = CORE.concat([
  'assets/favicon.svg',
  'assets/fonts/recursive-latin.woff2',
  'assets/fonts/recursive-latin-ext.woff2',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png'
]);

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

// Lädt alle App-Dateien vom Server (mit ETag, also meist nur „304 unverändert“).
// Erst wenn alle da sind, wird verglichen und getauscht – so gibt es nie eine halb neue App.
async function checkUpdate() {
  const cache = await caches.open(CACHE);
  const fresh = await Promise.all(CORE.map(async url => {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return { url, res, text: await res.clone().text() };
  }));
  let changed = false;
  for (const f of fresh) {
    const old = await cache.match(f.url);
    if (!old || (await old.text()) !== f.text) changed = true;
  }
  if (changed) await Promise.all(fresh.map(f => cache.put(f.url, f.res)));
  return changed;
}

self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'check-update') return;
  const reply = msg => e.source && e.source.postMessage({ type: 'update-result', ...msg });
  e.waitUntil(checkUpdate().then(changed => reply({ changed }), err => reply({ changed: false, error: String(err) })));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    // Seitenaufrufe (auch mit ?query) landen auf der gecachten Startseite
    const nav = req.mode === 'navigate';
    const cached = await cache.match(nav ? './' : req, { ignoreSearch: nav });
    if (cached) return cached;
    // Nicht im Cache (z. B. neue Datei): vom Netz holen und für offline merken
    const res = await fetch(req);
    if (res.ok) cache.put(nav ? './' : req, res.clone());
    return res;
  }));
});
