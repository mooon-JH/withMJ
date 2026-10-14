// 서비스 워커: 앱 껍데기(화면·스타일·스크립트)를 기기에 저장해 두어 빠르게 뜨게 한다.
// 데이터(API)는 항상 서버에서 새로 받는다 — 성적은 최신이어야 하므로.
const VERSION = 'v1';
const SHELL = [
  '/', '/academy', '/admin',
  '/css/app.css', '/css/report.css',
  '/js/common.js', '/js/academy.js', '/js/admin.js', '/js/report.js',
  '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // 화면은 '네트워크 먼저, 안 되면 저장본' → 업데이트가 바로 반영되면서 오프라인에도 뜸
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('/'))),
  );
});
