const CACHE="beagles-basket-cloud-v98";
const SHELL=["/","/index.html","/app.js?v=98","/styles.css?v=6","/rpg-theme.css?v=3","/manifest.webmanifest","/icon.svg","/icon-192.png","/icon-512.png"];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener("fetch",event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=="GET"||url.pathname.startsWith("/api/"))return;
  if(request.mode==="navigate"){
    event.respondWith(fetch(request,{cache:"no-store"}).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put("/index.html",copy));return response}).catch(()=>caches.match("/index.html")||caches.match("/")));
    return;
  }
  if(url.origin!==location.origin)return;
  if(url.pathname.endsWith("/app.js")||url.pathname.endsWith("/service-worker.js")||url.pathname.endsWith("/index.html")){
    event.respondWith(fetch(request,{cache:"no-store"}).then(response=>{if(response.ok&&url.pathname.endsWith("/app.js")){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));}return response}).catch(()=>caches.match(request)));
    return;
  }
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));}return response})));
});
