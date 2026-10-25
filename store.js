/* 공용 — 날짜·포맷 헬퍼, 캐릭터 저장소, 변경 알림, 토스트·되돌리기, 테마.
   기능 모듈(ledger · calc · chars · home)은 전부 이 Meso 객체를 통해서만 서로를 안다. */
var Meso = (function(){
  "use strict";

  var C = window.MesoCore;
  var $ = function(id){ return document.getElementById(id); };

  /* ---------- 날짜 ---------- */
  var DOW = C.DOW;
  var parseDate = C.parseDate, toISO = C.toISO, addDays = C.addDays;
  function dayDiff(a, b){ return Math.round((b - a) / 864e5); }
  function md(d){ return (d.getMonth()+1) + "." + d.getDate(); }
  // 올해가 아니면 연도를 붙임 — 연도 없이 "8월 17일"만 보이면 곧 닿는 것처럼 읽힘
  function mdLong(d){
    return (d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() + "년 " : "") +
      (d.getMonth()+1) + "월 " + d.getDate() + "일 (" + DOW[d.getDay()] + ")";
  }
  // "N일 뒤" — 천 단위 쉼표, 1년 넘으면 "약 N년 M개월 뒤"
  function daysText(n){
    if (n <= 365) return n.toLocaleString("ko-KR") + "일 뒤";
    var mo = Math.round(n / 30.4375), y = Math.floor(mo / 12), r = mo % 12;
    return "약 " + y + "년 " + (r ? r + "개월 " : "") + "뒤";
  }
  // 메이플 주간 리셋은 목요일 0시
  function weekStart(d){ return addDays(d, -((d.getDay() - 4 + 7) % 7)); }
  function today(){ var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  function coarse(){ return !!(window.matchMedia && matchMedia("(pointer:coarse)").matches); }

  /* ---------- 포맷 ---------- */
  function esc(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function fmtEok(v){
    if (!isFinite(v)) return "—";
    var neg = v < 0; v = Math.abs(v); var out;
    if (v >= 10000){
      var jo = Math.floor(v/10000), rest = Math.round(v - jo*10000);
      // 반올림으로 1조가 되면 올림 (99999.7 → 10조, "9조 10,000억" 방지)
      if (rest >= 10000){ jo += 1; rest -= 10000; }
      out = jo + "조" + (rest > 0 ? " " + rest.toLocaleString("ko-KR") + "억" : "");
    } else {
      out = v.toLocaleString("ko-KR", {maximumFractionDigits: v < 100 ? 1 : 0}) + "억";
    }
    return (neg ? "−" : "") + out;
  }
  function fmtSigned(v){ return (v > 0 ? "+" : "") + fmtEok(v); }
  // 기록 단위는 만 메소까지 정확히: 21억 3,170만
  function fmtMan(v){
    var neg = v < 0, man = Math.round(Math.abs(v) * 10000);
    var r = man % 10000, eok = Math.floor(man / 10000), jo = Math.floor(eok / 10000);
    eok %= 10000;
    var p = [];
    if (jo) p.push(jo + "조");
    if (eok) p.push(eok.toLocaleString("ko-KR") + "억");
    if (r) p.push(r.toLocaleString("ko-KR") + "만");
    return (neg ? "−" : "") + (p.join(" ") || "0");
  }
  var fmtFine = C.fmtFine;
  function fmtShort(v){
    if (Math.abs(v) >= 10000) return (v/10000).toFixed(1) + "조";
    return Math.round(v).toLocaleString("ko-KR");
  }
  function round(v, n){ var k = Math.pow(10, n); return Math.round(v * k) / k; }
  function signCls(v){ return v > 0 ? "pos" : v < 0 ? "neg" : "dim"; }

  /* 손으로 치는 금액: "21.5"(억) / "21억 3170만" / "1조 2000억" / "2,131,700,000"(게임 숫자).
     조/억/만 말고 다른 글자가 섞이면 오타로 보고 거절함. (정산표 붙여넣기는 MesoCore.parseMeso) */
  var NUM = "([\\d,]+(?:\\.\\d+)?)";
  function parseAmount(s){
    s = String(s).replace(/메소|원/g, "").trim();
    if (!s) return null;
    var get = function(unit){
      var m = s.match(new RegExp(NUM + "\\s*" + unit));
      return m ? parseFloat(m[1].replace(/,/g, "")) : 0;
    };
    if (/[조억만]/.test(s)){
      if (s.replace(new RegExp(NUM + "\\s*[조억만]", "g"), "").trim()) return null;
      return get("조") * 10000 + get("억") + get("만") / 10000;
    }
    var plain = s.match(/^([\d,]+(?:\.\d+)?)$/);
    if (!plain) return null;
    var v = parseFloat(plain[1].replace(/,/g, ""));
    if (!isFinite(v)) return null;
    // 100만 이상이면 메소 원본값(게임 화면 그대로)으로 봄. 100만억 = 100조라 겹칠 일 없음
    return v >= 1e6 ? v / 1e8 : v;
  }

  /* ---------- 저장소 ---------- */
  var KEYS = {chars:"meso-chars-v1", calc:"meso-calc-v1", ledger:"meso-ledger-v1", apiKey:"meso-ledger-key", theme:"meso-theme",
              prices:"meso-boss-prices"};
  function read(key){ try{ return JSON.parse(localStorage.getItem(key)); } catch(e){ return null; } }
  // 저장 실패(용량 초과 · 사생활 보호 모드)를 호출한 쪽이 알 수 있게 true/false 로 돌려주고 "storage-error" 알림도 냄
  function write(key, v){
    var ok = true;
    try{ localStorage.setItem(key, JSON.stringify(v)); } catch(e){ ok = false; }
    if (!ok) emit("storage-error", key);
    return ok;
  }

  /* ---------- 변경 알림 ---------- */
  var subs = {};
  function on(name, fn){ (subs[name] = subs[name] || []).push(fn); }
  function emit(name, data){ (subs[name] || []).forEach(function(fn){ fn(data); }); }

  /* ---------- 보스 결정석 ----------
     가격표는 bosses.js, 사용자가 ⚙에서 덮어쓴 값은 meso-boss-prices {"lucid:hard": 메소}.
     kind 는 "w"(주간) | "m"(월간) */
  var BOSSES = window.MESO_BOSSES || {weekly:[], monthly:[], diffs:{}, weeklyLimit:12, worldLimit:90};
  var priceOver = cleanPrices(read(KEYS.prices));
  function hasOwn(o, k){ return Object.prototype.hasOwnProperty.call(o, k); }
  // 백업 · 저장값은 믿지 않음: 있는 보스 · 난이도의 유한한 양수만 남김
  function cleanPrices(o){
    var out = {};
    if (!o || typeof o !== "object" || Array.isArray(o)) return out;
    Object.keys(o).forEach(function(k){
      var i = k.indexOf(":"), v = o[k];
      if (i < 1 || typeof v !== "number" || !isFinite(v) || !(v > 0) || v >= 1e13) return;
      var id = k.slice(0, i), d = k.slice(i + 1);
      var ok = ["w", "m"].some(function(kind){ var b = bossInfo(kind, id); return b && hasOwn(b.p, d); });
      if (ok) out[k] = Math.round(v);
    });
    return out;
  }
  function bossList(kind){ return kind === "m" ? BOSSES.monthly : BOSSES.weekly; }
  function bossInfo(kind, id){
    var list = bossList(kind);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function bossPrice(kind, id, d){
    var b = bossInfo(kind, id);
    if (!b || !hasOwn(b.p, d)) return 0;
    var k = id + ":" + d;
    return priceOver[k] > 0 ? priceOver[k] : b.p[d];
  }
  // 파티면 인원으로 나누고 소수점 버림 (게임 규칙). 결과는 억
  function bossShare(kind, r){ return Math.floor(bossPrice(kind, r.id, r.d) / (r.p || 1)) / 1e8; }
  function routineSum(kind, list){
    var s = 0;
    (list || []).forEach(function(r){ s += bossShare(kind, r); });
    return s;
  }
  // 보스 하나에 난이도 하나, 인원 1~6, 표에 없는 보스 · 난이도는 버림
  function cleanRoutine(kind, list){
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function(r){
      var b = r && bossInfo(kind, r.id);
      if (!b || !hasOwn(b.p, r.d) || seen[r.id]) return;
      seen[r.id] = 1;
      out.push({id:r.id, d:r.d, p:Math.max(1, Math.min(6, parseInt(r.p, 10) || 1))});
    });
    // 진행 순서로 정렬
    var order = bossList(kind).map(function(b){ return b.id; });
    return out.sort(function(a, b){ return order.indexOf(a.id) - order.indexOf(b.id); });
  }
  function bossLabel(kind, r){
    var b = bossInfo(kind, r.id);
    return (b ? b.n : r.id) + " " + (BOSSES.diffs[r.d] || r.d);
  }
  function bossShort(kind, r){
    var b = bossInfo(kind, r.id);
    return (b ? b.n : r.id) + "(" + String(BOSSES.diffs[r.d] || r.d).charAt(0) + ")";
  }

  /* ---------- 캐릭터 ----------
     {id, name, weekly(억/주), monthly(억/월), main, world?, cls?, level?, ocid?,
      bosses?:[{id, d, p}] 주간 루틴, mbosses?:[{id, d, p}] 월간 루틴} — 배열 순서가 곧 표시 순서.
     루틴이 있으면 주보 · 월보는 루틴 합계, 없으면 직접 넣은 weekly · monthly.
     예전엔 계산기 저장값의 r([이름, 주보, 월보])에만 있었음. 처음 열 때 거기서 옮겨 옴. */
  var chars = [];
  function newId(){ return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  // id 는 HTML 속성에 그대로 들어가는 곳이 있어서 안전한 글자만 허용
  function cleanChar(c){
    if (!c || typeof c !== "object") c = {};
    var num = function(v){ v = parseFloat(v); return isFinite(v) && v >= 0 && v <= 1e6 ? v : 0; };
    var x = {id: typeof c.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(c.id) ? c.id : newId(),
             name: String(c.name == null ? "" : c.name).trim().slice(0, 40) || "이름 없음",
             weekly: num(c.weekly), monthly: num(c.monthly), main: !!c.main};
    if (c.world) x.world = String(c.world).slice(0, 30);
    if (c.cls) x.cls = String(c.cls).slice(0, 30);
    var lv = Math.floor(+c.level);
    if (lv >= 1 && lv <= 400) x.level = lv;
    if (c.ocid) x.ocid = String(c.ocid).slice(0, 80);
    var wb = cleanRoutine("w", c.bosses), mb = cleanRoutine("m", c.mbosses);
    if (wb.length) x.bosses = wb;
    if (mb.length) x.mbosses = mb;
    return x;
  }
  // 이름은 겹치면 안 됨 (장부가 이름으로 캐릭터를 찾음). 나중 것을 "이름 (2)", "이름 (3)"…
  function dupName(name, taken){
    for (var n = 2; ; n++){
      var suffix = " (" + n + ")", cand = name.slice(0, 40 - suffix.length) + suffix;
      if (!taken[cand]) return cand;
    }
  }
  function uniqueNames(list){
    var taken = Object.create(null), dups = [];
    list.forEach(function(c){ if (taken[c.name]) dups.push(c); else taken[c.name] = 1; });
    dups.forEach(function(c){ c.name = dupName(c.name, taken); taken[c.name] = 1; });
    return list;
  }
  function uniqueName(name){
    var taken = Object.create(null);
    chars.forEach(function(c){ taken[c.name] = 1; });
    return taken[name] ? dupName(name, taken) : name;
  }
  // 객체만 받아 정리하고 id · 이름 중복 제거
  function cleanList(list){
    var ids = Object.create(null);
    var out = (Array.isArray(list) ? list : []).filter(function(c){ return c && typeof c === "object"; }).map(function(c){
      var x = cleanChar(c);
      while (ids[x.id]) x.id = newId();
      ids[x.id] = 1;
      return x;
    });
    return uniqueNames(out);
  }
  function charWeekly(c){ return c.bosses && c.bosses.length ? routineSum("w", c.bosses) : c.weekly; }
  function charMonthly(c){ return c.mbosses && c.mbosses.length ? routineSum("m", c.mbosses) : c.monthly; }
  function fromRoster(r){
    return cleanList((Array.isArray(r) ? r : []).filter(Array.isArray).map(function(c, i){
      return {name: c[0] != null ? c[0] : "캐릭 " + (i + 1), weekly: c[1], monthly: c[2], main: i === 0};
    }));
  }
  // 본캐는 하나만. 없으면 맨 앞
  function fixMain(){
    var seen = false;
    chars.forEach(function(c){ if (c.main){ if (seen) c.main = false; seen = true; } });
    if (!seen && chars.length) chars[0].main = true;
  }
  function loadChars(){
    var s = read(KEYS.chars);
    if (s && Array.isArray(s.list)){
      chars = cleanList(s.list);
    } else {
      var calc = read(KEYS.calc);
      chars = fromRoster(calc && calc.r);
      saveChars(true);
    }
    fixMain();
  }
  function saveChars(quiet){
    fixMain();
    var ok = write(KEYS.chars, {v:1, list:chars});
    if (!quiet) emit("change", "chars");
    return ok;
  }
  function charTotals(){
    var w = 0, m = 0;
    chars.forEach(function(c){ w += charWeekly(c); m += charMonthly(c); });
    return {weekly:w, monthly:m};
  }
  function findChar(id){
    for (var i = 0; i < chars.length; i++) if (chars[i].id === id) return chars[i];
    return null;
  }
  function findCharByOcid(ocid){
    for (var i = 0; i < chars.length; i++) if (chars[i].ocid && chars[i].ocid === ocid) return chars[i];
    return null;
  }
  function findCharByName(name){
    name = String(name == null ? "" : name).trim();
    for (var i = 0; i < chars.length; i++) if (chars[i].name === name) return chars[i];
    return null;
  }

  var charsApi = {
    list: function(){ return chars.slice(); },
    get: findChar,
    byName: findCharByName,
    totals: charTotals,
    add: function(c){ var x = cleanChar(c); x.name = uniqueName(x.name); chars.push(x); saveChars(); return x; },
    // 이름이 바뀌면 장부 기록의 캐릭터 이름도 같이 바꾸도록 알림
    update: function(id, patch){
      var c = findChar(id);
      if (!c) return null;
      var from = c.name, x = cleanChar(Object.assign({}, c, patch, {id:id}));
      chars[chars.indexOf(c)] = x;
      if (patch.main) chars.forEach(function(o){ if (o.id !== id) o.main = false; });
      saveChars();
      if (x.name !== from) emit("char-rename", {from:from, to:x.name});
      return x;
    },
    remove: function(id){
      var c = findChar(id);
      if (!c) return null;
      var i = chars.indexOf(c);
      chars.splice(i, 1);
      saveChars();
      return {c:c, i:i};
    },
    restore: function(c, i){
      // 지운 본캐를 되돌리면 그대로 본캐 (fixMain 은 목록 앞쪽 본캐를 남김)
      if (c.main) chars.forEach(function(o){ o.main = false; });
      c.name = uniqueName(c.name);
      chars.splice(Math.min(i, chars.length), 0, c); saveChars(); },
    move: function(id, dir){
      var c = findChar(id), i = chars.indexOf(c), j = i + dir;
      if (!c || j < 0 || j >= chars.length) return;
      chars[i] = chars[j]; chars[j] = c;
      saveChars();
    },
    // 정산표 붙여넣기: 이름이 같으면 수익만 갱신, 없으면 추가 (예전엔 로스터를 통째로 갈아엎었음)
    mergeIncome: function(found){
      var added = 0, updated = 0;
      found.forEach(function(f, i){
        var name = String(f.name || "").trim(), c = name && findCharByName(name);
        if (c){ c.weekly = f.weekly; c.monthly = f.monthly; updated++; }
        else {
          var x = cleanChar({name: name || "캐릭 " + (chars.length + 1), weekly:f.weekly, monthly:f.monthly});
          x.name = uniqueName(x.name); chars.push(x); added++;
        }
      });
      saveChars();
      return {added:added, updated:updated};
    },
    // Open API 캐릭터 목록: ocid 가 같으면(게임 안에서 이름을 바꿨어도) 같은 캐릭터, 아니면 이름으로 맞춤.
    // 월드·직업·레벨·ocid만 채움
    mergeApi: function(list){
      var added = 0, updated = 0;
      (Array.isArray(list) ? list : []).forEach(function(a){
        var name = a && a.character_name != null ? String(a.character_name).trim() : "";
        if (!name) return;
        var meta = {world:a.world_name, cls:a.character_class, level:a.character_level, ocid:a.ocid};
        // 응답에 빠진 칸은 기존 값을 지우지 않게 아예 뺌
        Object.keys(meta).forEach(function(k){ if (meta[k] == null || meta[k] === "") delete meta[k]; });
        var c = a.ocid ? findCharByOcid(String(a.ocid).slice(0, 80)) : null;
        if (c && c.name !== name){
          var other = findCharByName(name);
          // 새 이름을 다른 캐릭터가 쓰고 있으면 옛 이름 유지 (장부가 이름으로 찾으므로 겹치면 안 됨)
          // update 를 거쳐야 char-rename 이 나가 장부 기록의 이름이 따라 바뀜
          if (!other){ charsApi.update(c.id, Object.assign({name:name}, meta)); updated++; return; }
        }
        if (!c) c = findCharByName(name);
        if (c){ Object.assign(c, cleanChar(Object.assign({}, c, meta))); updated++; }
        else { chars.push(cleanChar(Object.assign({name:name}, meta))); added++; }
      });
      saveChars();
      return {added:added, updated:updated};
    },
    // 계산기 공유 링크에 담겨 온 로스터 — 링크를 연 쪽의 캐릭터를 링크 것으로 바꿈.
    // 이름이 같은 캐릭터는 id · 루틴 · 본캐 · 월드 등을 그대로 두고 주보 · 월보만 링크 값으로
    // (id 가 바뀌면 이번 주 체크 기록이 고아가 됨). 링크에 없는 캐릭터는 버림
    replaceFromRoster: function(r){
      var list = fromRoster(r);
      if (!list.length) return false;
      chars = list.map(function(n){
        var old = findCharByName(n.name);
        if (!old) return Object.assign(n, {main:false});
        return Object.assign({}, old, {weekly:n.weekly, monthly:n.monthly});
      });
      saveChars();
      return true;
    },
    // 루틴째 바꾸기 (kind "w" | "m")
    setRoutine: function(id, kind, list){
      var c = findChar(id);
      if (!c) return null;
      var r = cleanRoutine(kind, list), key = kind === "m" ? "mbosses" : "bosses";
      if (r.length) c[key] = r; else delete c[key];
      saveChars();
      return c;
    },
    copyRoutine: function(fromId, toId){
      var f = findChar(fromId), t = findChar(toId);
      if (!f || !t) return null;
      // 월간은 원본에 있을 때만 — 없는데 덮어쓰면 대상의 월간 루틴이 지워짐
      var r = charsApi.setRoutine(toId, "w", f.bosses || []);
      if (f.mbosses && f.mbosses.length) r = charsApi.setRoutine(toId, "m", f.mbosses);
      return r;
    },
    weekly: charWeekly,
    monthly: charMonthly,
    // 월드마다 주간 루틴 결정석 수 (월드당 주 90개 제한 확인용, 월드를 아는 캐릭터만)
    worldCounts: function(){
      var out = {};
      chars.forEach(function(c){ if (c.world && c.bosses) out[c.world] = (out[c.world] || 0) + c.bosses.length; });
      return out;
    },
    // 공유 링크엔 계산된 주보 · 월보를 실음 (받는 쪽은 직접 입력값으로)
    toRoster: function(){ return chars.map(function(c){ return [c.name, charWeekly(c), charMonthly(c)]; }); },
    all: function(){ return chars; },
    load: loadChars,
    setAll: function(list){ chars = cleanList(list); saveChars(); }
  };

  /* ---------- 토스트 · 되돌리기 ---------- */
  var toastTimer = null, undoFn = null, toastBound = false;
  function hideToast(){
    var el = $("toast");
    clearTimeout(toastTimer);
    el.hidden = true;
    undoFn = null;
    // 팝오버는 top layer 에 남지 않게 같이 닫음
    if (el.hidePopover) try{ el.hidePopover(); } catch(e){}
  }
  // 마우스를 올리거나 포커스가 있는 동안은 안 사라지게 멈추고, 벗어나면 3초 뒤 닫음
  function holdToast(){ clearTimeout(toastTimer); }
  function releaseToast(){
    if ($("toast").hidden) return;   // 닫히면서 생긴 focusout 이 새 타이머를 만들지 않게
    clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, 3000);
  }
  function toast(msg, onUndo){
    var el = $("toast");
    $("toast-msg").textContent = msg;
    undoFn = onUndo || null;
    $("toast-undo").hidden = !undoFn;
    el.hidden = false;
    // 모달 시트가 열려 있으면 바깥은 전부 inert 라 보여도 못 누름 → 시트 안으로 옮겨 둠
    var modal = document.querySelector("dialog[open]"), home = modal || document.body;
    if (el.parentNode !== home) home.appendChild(el);
    // 열린 모달 시트(top layer) 위에 보이게 매번 다시 띄움 — 나중에 띄운 게 위에 쌓임
    if (el.showPopover){
      try{ el.hidePopover(); } catch(e){}
      try{ el.showPopover(); } catch(e){}
    }
    if (!toastBound){
      toastBound = true;
      el.addEventListener("mouseenter", holdToast);
      el.addEventListener("focusin", holdToast);
      el.addEventListener("mouseleave", releaseToast);
      el.addEventListener("focusout", releaseToast);
    }
    clearTimeout(toastTimer);
    // 되돌리기는 누를 시간을 더 줌
    toastTimer = setTimeout(hideToast, undoFn ? 8000 : 5000);
  }
  function runUndo(){
    var f = undoFn;
    hideToast();
    if (f) f();
  }

  /* ---------- 테마 — 저장값 없으면 시스템 설정 ---------- */
  function themePref(){ var t = null; try{ t = localStorage.getItem(KEYS.theme); } catch(e){} return t === "light" || t === "dark" ? t : "system"; }
  function setTheme(pref){
    try{
      if (pref === "light" || pref === "dark") localStorage.setItem(KEYS.theme, pref);
      else localStorage.removeItem(KEYS.theme);
    } catch(e){}
    applyTheme();
  }
  function applyTheme(){
    var p = themePref();
    if (p === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = p;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#141220";
  }

  var bossApi = {
    data: BOSSES, list: bossList, info: bossInfo, price: bossPrice, share: bossShare, sum: routineSum,
    label: bossLabel, short: bossShort,
    defaultPrice: function(kind, id, d){ var b = bossInfo(kind, id); return b && hasOwn(b.p, d) ? b.p[d] : 0; },
    overrides: function(){ return Object.assign({}, priceOver); },
    // 메소 단위. 0 이나 기본값과 같으면 덮어쓰기 해제
    setPrice: function(kind, id, d, meso){
      var k = id + ":" + d, def = bossApi.defaultPrice(kind, id, d);
      if (!def || meso >= 1e13) return;   // 없는 보스 · 난이도거나 말도 안 되는 값
      if (!(meso > 0) || Math.round(meso) === def) delete priceOver[k]; else priceOver[k] = Math.round(meso);
      write(KEYS.prices, priceOver);
      emit("change", "prices");
    },
    setOverrides: function(o){ priceOver = cleanPrices(o); write(KEYS.prices, priceOver); emit("change", "prices"); },
    reloadPrices: function(){ priceOver = cleanPrices(read(KEYS.prices)); }
  };

  // 계산기 · 장부 모듈이 뜨기 전에 캐릭터부터 (예전 계산기 로스터에서 옮기는 것도 여기서)
  loadChars();

  return {
    $:$, core:C, KEYS:KEYS, read:read, write:write, on:on, emit:emit,
    DOW:DOW, parseDate:parseDate, toISO:toISO, addDays:addDays, dayDiff:dayDiff, md:md, mdLong:mdLong, daysText:daysText,
    weekStart:weekStart, today:today, coarse:coarse,
    esc:esc, fmtEok:fmtEok, fmtSigned:fmtSigned, fmtMan:fmtMan, fmtFine:fmtFine, fmtShort:fmtShort,
    round:round, signCls:signCls, parseAmount:parseAmount,
    chars:charsApi, bosses:bossApi, toast:toast, runUndo:runUndo,
    themePref:themePref, setTheme:setTheme, applyTheme:applyTheme
  };
})();
