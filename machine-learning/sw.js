// Gerado por build-site.mjs — não editar à mão.
const CACHE = 'estudos-machine-learning-1ef9170';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon-180.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate: abre instantâneo (e offline), mas busca a versão
// nova em segundo plano para a próxima abertura.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // Links de importação de progresso (?p=) e de cache-busting (?v=) apontam para
  // o mesmo documento. Sem normalizar, cada variação guardaria uma cópia de
  // ~600 KB no cache.
  const key = url.search ? new Request(url.origin + url.pathname, { headers: e.request.headers }) : e.request;
  e.respondWith(
    caches.match(key).then((cached) => {
      const net = fetch(e.request)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(key, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || net;
    })
  );
});
