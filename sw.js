/* 오프라인 캐시.
   프리캐시 + stale-while-revalidate: 캐시가 있으면 바로 주고 뒤에서 새 걸 받아 갈아끼움.
   캐시 이름의 버전을 올리면 activate 에서 옛 캐시를 지움. */
var VERSION = "meso-calc-v4";
var ASSETS = ["./", "./index.html", "./app.css", "./core.js", "./store.js", "./api.js", "./ledger.js", "./calc.js",
              "./chars.js", "./home.js", "./app.js", "./rules.js", "./ledger.html", "./icon.svg", "./manifest.json"];

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
  var url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  // 페이지 이동은 해시·쿼리를 떼고 그 페이지 자체로. 폴더 주소(./)만 index.html
  // (전부 index.html 로 보내면 ledger.html 을 열어도 계산기가 뜸)
  var key = req.mode === "navigate"
    ? (/\/$/.test(url.pathname) ? "./index.html" : url.origin + url.pathname)
    : req;
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
