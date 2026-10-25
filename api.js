/* 넥슨 Open API 클라이언트. 정적 페이지에서 바로 부름 (CORS 허용 확인함).
   키는 장부 데이터와 다른 저장 키에 둬서 백업 JSON · CSV · 공유 링크 어디에도 안 섞이게 한다. */
Meso.api = (function(M){
  "use strict";

  var BASE = "https://open.api.nexon.com";
  var ERR = {
    OPENAPI00001:"넥슨 서버 내부 오류", OPENAPI00002:"권한 없음", OPENAPI00003:"유효하지 않은 식별자",
    OPENAPI00004:"요청 값이 올바르지 않음", OPENAPI00005:"API 키가 올바르지 않음",
    OPENAPI00006:"없는 API 경로", OPENAPI00007:"호출 한도 초과 (개발 키 1,000건/일)",
    OPENAPI00009:"데이터 준비 중", OPENAPI00010:"게임 점검 중", OPENAPI00011:"API 점검 중"
  };
  var lastCall = 0;

  function key(){ try{ return localStorage.getItem(M.KEYS.apiKey) || ""; } catch(e){ return ""; } }
  function setKey(k){ try{ if (k) localStorage.setItem(M.KEYS.apiKey, k); else localStorage.removeItem(M.KEYS.apiKey); } catch(e){} }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  // 개발 키는 초당 5건. 260ms 간격으로 4건 아래를 유지하고, 429/5xx 는 지수 백오프
  function call(path, params, tries){
    tries = tries || 0;
    params = params || {};
    var qs = Object.keys(params).map(function(k){ return k + "=" + encodeURIComponent(params[k]); }).join("&");
    return sleep(Math.max(0, lastCall + 260 - Date.now())).then(function(){
      lastCall = Date.now();
      return fetch(BASE + path + (qs ? "?" + qs : ""), {headers:{"x-nxopen-api-key": key()}});
    }).then(function(res){
      return res.json().catch(function(){ return {}; }).then(function(body){
        if (res.ok) return body;
        var code = body && body.error && body.error.name || "HTTP " + res.status;
        if ((res.status === 429 || res.status >= 500) && tries < 4){
          return sleep(1000 * Math.pow(2, tries)).then(function(){ return call(path, params, tries + 1); });
        }
        var err = new Error(ERR[code] || (body.error && body.error.message) || code);
        err.code = code;
        throw err;
      });
    }, function(){
      var err = new Error(location.protocol === "file:" ? "파일로 열면 API를 못 부름 — GitHub Pages 주소에서 열어줘" : "네트워크 오류");
      err.code = "NET";
      throw err;
    });
  }

  // date 로 첫 장, 이후 next_cursor 로 그날 것을 끝까지
  function fetchAll(path, field, iso){
    var out = [], guard = 0;
    function page(params){
      return call(path, params).then(function(body){
        out = out.concat(body[field] || []);
        if (body.next_cursor && ++guard < 50) return page({count:1000, cursor:body.next_cursor});
        return out;
      });
    }
    return page({count:1000, date:iso});
  }

  // 키 주인 계정의 캐릭터 전부 (계정이 여럿이면 합침)
  function characterList(){
    return call("/maplestory/v1/character/list").then(function(body){
      var out = [];
      (body.account_list || []).forEach(function(a){ out = out.concat(a.character_list || []); });
      return out;
    });
  }

  return {key:key, setKey:setKey, call:call, fetchAll:fetchAll, characterList:characterList};
})(Meso);
