// Offline cache: app shell first, map tiles opportunistically.
const VERSION = 'stride-v2';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png',
  './css/app.css', './js/config.js', './js/i18n.js', './js/social.js', './js/views-friends.js',
  './js/util.js', './js/db.js', './js/analysis.js', './js/charts.js', './js/maps.js',
  './js/hr.js', './js/tracker.js', './js/plan.js',
  './js/views-record.js', './js/views-activities.js', './js/views-explore.js',
  './js/views-training.js', './js/views-me.js', './js/app.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/@supabase/supabase-js@2.45.4/dist/umd/supabase.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'tiles').map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Routing requests must always be live.
  if (url.hostname.includes('routing.openstreetmap.de') || url.hostname.endsWith('supabase.co')) return;

  if (url.hostname.includes('basemaps.cartocdn.com') || url.hostname.includes('tile.openstreetmap.org')) {
    e.respondWith(
      caches.open('tiles').then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // App shell: network first (so updates arrive), cache fallback offline.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && (url.origin === location.origin || url.hostname === 'unpkg.com')) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
