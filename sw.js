/* Cache everything on install; serve cache-first so the app works with no signal. */
const CACHE = 'menu-decoder-v11';
const ASSETS = [
  './', './index.html',
  'app/styles.css', 'app/app.js', 'app/manifest.webmanifest',
  'data/tags.json', 'data/cuisines.json', 'data/restaurants.json',
  'data/terms/ethiopian.json',
  'data/terms/peruvian.json',
  'data/terms/palestinian.json',
  'data/terms/thai.json',
  'data/terms/lebanese.json',
  'data/terms/greek.json',
  'data/terms/french.json',
  'data/terms/chinese.json',
  'data/terms/japanese.json',
  'data/terms/korean.json',
  'data/terms/ukrainian.json',
  'data/terms/turkish.json',
  'data/terms/indian.json',
  'data/terms/salvadoran.json',
  'data/terms/afghan.json',
  'data/terms/mexican.json',
  'data/terms/vietnamese.json',
  'data/terms/spanish.json',
  'app/fonts/fredoka-latin.woff2', 'app/fonts/jakarta-latin.woff2',
  'app/icons/icon-192.png', 'app/icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll fails wholesale if any one file 404s; add individually so a
      // not-yet-written cuisine file can't break the whole offline cache.
      .then(c => Promise.all(ASSETS.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => {
      if (hit) {
        // Refresh in the background so data updates land on the next visit.
        fetch(e.request).then(res => {
          if (res && res.ok) caches.open(CACHE).then(c => c.put(e.request, res));
        }).catch(() => {});
        return hit;
      }
      return fetch(e.request).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
