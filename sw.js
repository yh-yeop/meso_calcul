/* 오프라인 캐시.
   프리캐시 + stale-while-revalidate: 캐시가 있으면 바로 주고 뒤에서 새 걸 받아 갈아끼움.
   캐시 이름의 버전을 올리면 activate 에서 옛 캐시를 지움. */
var VERSION = "meso-calc-v11";
var ASSETS = ["./", "./index.html", "./app.css", "./core.js", "./store.js", "./api.js", "./ledger.js", "./calc.js",
              "./chars.js", "./home.js", "./firebase-config.js", "./sync.js", "./app.js", "./rules.js", "./bosses.js", "./ledger.html", "./icon.svg", "./manifest.json"];

self.addEventListener("install", function(e){
  // HTTP 캐시를 건너뛰어야 새 버전이 옛 파일을 프리캐시하지 않음
  e.waitUntil(caches.open(VERSION).then(function(c){
    return c.addAll(ASSETS.map(function(u){ return new Request(u, {cache:"reload"}); }));
  }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k.indexOf("meso-calc-") === 0 && k !== VERSION; })
                           .map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

function noop(){}

self.addEventListener("fetch", function(e){
  var req = e.request;
  var url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  // 페이지 이동은 해시·쿼리를 떼고 그 페이지 자체로. 폴더 주소(./)만 index.html
  // (전부 index.html 로 보내면 ledger.html 을 열어도 계산기가 뜸)
  var key = req.mode === "navigate"
    ? (/\/$/.test(url.pathname) ? "./index.html" : url.origin + url.pathname)
    : req;
  // 갱신은 waitUntil 에 걸어야 응답 뒤에도 워커가 안 죽고 캐시 교체가 끝남 (안 그러면 옛 파일이 남아 버전이 섞임)
  var open = caches.open(VERSION);
  var fresh = open.then(function(c){
    // 갱신은 HTTP 캐시를 그냥 믿지 않고 서버에 확인
    return fetch(req, {cache:"no-cache"}).then(function(res){
      // 저장이 실패해도(용량 · 불투명 · 206) 네트워크 응답은 그대로 돌려줌
      if (res && res.ok) return c.put(key, res.clone()).then(function(){ return res; }, function(){ return res; });
      return res;
    });
  });
  e.waitUntil(fresh.then(noop, noop));
  // 캐시가 없는데 네트워크도 실패하면 요청이 실패하는 게 맞음
  e.respondWith(open.then(function(c){ return c.match(key); }).then(function(cached){ return cached || fresh; }));
});
