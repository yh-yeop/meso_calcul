/* 오프라인 캐시. index.html 하나로 동작한다는 약속에서 유일하게 예외인 파일.
   프리캐시 + stale-while-revalidate: 캐시가 있으면 바로 주고 뒤에서 새 걸 받아 갈아끼움.
   캐시 이름의 버전을 올리면 activate 에서 옛 캐시를 지움. */
var VERSION = "meso-calc-v1";
var ASSETS = ["./", "./index.html", "./icon.svg", "./manifest.json"];

self.addEventListener("install", function(e){
  e.waitUntil(caches.open(VERSION).then(function(c){ return c.addAll(ASSETS); }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k.indexOf("meso-calc-") === 0 && k !== VERSION; })
                           .map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener("fetch", function(e){
  var req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  // 해시·쿼리가 붙어 들어와도 같은 페이지
  var key = req.mode === "navigate" ? "./index.html" : req;
  e.respondWith(caches.open(VERSION).then(function(c){
    return c.match(key).then(function(cached){
      var fresh = fetch(req).then(function(res){
        if (res && res.ok) c.put(key, res.clone());
        return res;
      }).catch(function(){ return cached; });
      return cached || fresh;
    });
  }));
});
