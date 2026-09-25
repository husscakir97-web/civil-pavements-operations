// Infrastruct field service worker: keeps the app shell usable without signal.
// - Page navigations: network first; the last good copy is served when offline.
// - /_next/static assets: cache first (file names are content hashed).
// - API requests are never cached here. Field data is cached by the app in
//   IndexedDB per user, and queued work is sent by the app with request ids.
const SHELL='infrastruct-shell-v1',STATIC='infrastruct-static-v1';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  for(const key of await caches.keys())if(![SHELL,STATIC].includes(key))await caches.delete(key);
  await self.clients.claim();
 })());
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 if(request.mode==='navigate'&&url.pathname==='/'){
  event.respondWith((async()=>{
   try{
    const response=await fetch(request);
    // Only cache the signed-in shell itself, never a redirect to sign-in.
    if(response.ok&&!response.redirected){const cache=await caches.open(SHELL);await cache.put('/',response.clone());}
    return response;
   }catch{
    const cached=await caches.match('/');
    return cached||new Response('<!doctype html><title>Offline</title><meta name="viewport" content="width=device-width,initial-scale=1"><p style="font-family:system-ui;padding:24px">You are offline and the app has not been opened on this device yet. Reconnect and open Infrastruct once to enable offline use.</p>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
   }
  })());
  return;
 }
 if(url.pathname.startsWith('/_next/static/')){
  event.respondWith((async()=>{
   const cache=await caches.open(STATIC),hit=await cache.match(request);
   if(hit)return hit;
   const response=await fetch(request);
   if(response.ok)await cache.put(request,response.clone());
   return response;
  })());
 }
});
