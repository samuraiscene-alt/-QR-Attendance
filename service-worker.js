const CACHE='qr-attendance-v36-34-cache-refresh-ios-safe-20260901';
const ASSETS=[
'./','./index.html','./checkin.html','./proxy.html','./style.css','./app.js','./proxy-share-v36-15.js','./manifest.json','./supabase-config.js',
'./icons/apple-touch-icon.png','./icons/icon-192.png','./icons/icon-512.png'
];

// iPhone Safari/PWA가 이전 HTTP 캐시의 app.js를 다시 쓰는 문제를 막기 위해
// 설치 시 핵심 파일을 반드시 네트워크에서 새로 받아 캐시에 저장합니다.
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(ASSETS.map(async (url) => {
      try {
        const request = new Request(url, { cache: 'reload' });
        const response = await fetch(request);
        if (response && response.ok) await cache.put(url, response.clone());
      } catch (_) {
        // 설치 중 일부 파일을 못 받아도 기존 앱 자체가 중단되지 않도록 둡니다.
      }
    }));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  if (url.includes('supabase.co') || url.includes('cdn.jsdelivr.net')) return;

  // 온라인일 때는 브라우저 HTTP 캐시를 우회해 항상 최신 GitHub Pages 파일을 확인하고,
  // 네트워크가 끊겼을 때만 서비스워커 캐시를 사용합니다.
  event.respondWith((async () => {
    try {
      const freshRequest = new Request(event.request, { cache: 'no-store' });
      const response = await fetch(freshRequest);
      if (response && response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (_) {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      return caches.match('./index.html');
    }
  })());
});
