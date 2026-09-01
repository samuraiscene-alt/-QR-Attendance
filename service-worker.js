const CACHE='qr-attendance-v36-30-edit-confirm-20260901';
const ASSETS=[
'./','./index.html','./checkin.html','./proxy.html','./style.css','./app.js','./proxy-share-v36-15.js','./manifest.json','./supabase-config.js',
'./icons/apple-touch-icon.png','./icons/icon-192.png','./icons/icon-512.png'
];
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;if(event.request.url.includes('supabase.co')||event.request.url.includes('cdn.jsdelivr.net'))return;event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;}).catch(()=>caches.match(event.request).then(cached=>cached||caches.match('./index.html'))));});
