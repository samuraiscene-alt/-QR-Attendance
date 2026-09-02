const CACHE='qr-attendance-v36-42-sheets-org-status-20260902';
const ASSETS=[
'./','./index.html','./checkin.html','./proxy.html','./style.css','./app.js','./proxy-share-v36-15.js','./manifest.json','./supabase-config.js',
'./icons/apple-touch-icon.png','./icons/icon-192.png','./icons/icon-512.png',
'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

// iPhone Safari/PWA가 이전 HTTP 캐시의 app.js를 다시 쓰는 문제를 막고,
// 오프라인 재실행 시 필요한 외부 라이브러리도 함께 캐시에 보관합니다.
// V36.40에서는 앱 자체가 실제 네트워크 복구를 감지해 자동 재초기화합니다.
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(ASSETS.map(async (url) => {
      try {
        const request = new Request(url, { cache: 'reload' });
        const response = await fetch(request);
        if (response && (response.ok || response.type === 'opaque')) {
          await cache.put(request, response.clone());
        }
      } catch (_) {
        // 일부 외부 자산을 못 받아도 설치 자체는 중단하지 않습니다.
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

  // Supabase 데이터 API 요청 자체는 절대로 캐시하지 않습니다.
  if (url.includes('supabase.co')) return;

  event.respondWith((async () => {
    try {
      const freshRequest = new Request(event.request, { cache: 'no-store' });
      const response = await fetch(freshRequest);
      if (response && (response.ok || response.type === 'opaque')) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (_) {
      const cached = await caches.match(event.request);
      if (cached) return cached;

      // 외부 스크립트 요청에 index.html을 돌려주면 JS 파싱 오류가 생기므로
      // 같은 출처의 화면 이동 요청에만 앱 셸을 대체 응답으로 사용합니다.
      if (event.request.mode === 'navigate') {
        return caches.match('./index.html');
      }
      throw _;
    }
  })());
});
