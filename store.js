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
  function mdLong(d){ return (d.getMonth()+1) + "월 " + d.getDate() + "일 (" + DOW[d.getDay()] + ")"; }
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
  var KEYS = {chars:"meso-chars-v1", calc:"meso-calc-v1", ledger:"meso-ledger-v1", apiKey:"meso-ledger-key", theme:"meso-theme"};
  function read(key){ try{ return JSON.parse(localStorage.getItem(key)); } catch(e){ return null; } }
  function write(key, v){ try{ localStorage.setItem(key, JSON.stringify(v)); } catch(e){} }

  /* ---------- 변경 알림 ---------- */
  var subs = {};
  function on(name, fn){ (subs[name] = subs[name] || []).push(fn); }
  function emit(name, data){ (subs[name] || []).forEach(function(fn){ fn(data); }); }

  /* ---------- 캐릭터 ----------
     {id, name, weekly(억/주), monthly(억/월), main, world?, cls?, level?, ocid?} — 배열 순서가 곧 표시 순서.
     예전엔 계산기 저장값의 r([이름, 주보, 월보])에만 있었음. 처음 열 때 거기서 옮겨 옴. */
  var chars = [];
  function newId(){ return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function cleanChar(c){
    var x = {id: c.id || newId(), name: String(c.name || "").trim() || "이름 없음",
             weekly: Math.max(0, parseFloat(c.weekly) || 0), monthly: Math.max(0, parseFloat(c.monthly) || 0),
             main: !!c.main};
    if (c.world) x.world = String(c.world);
    if (c.cls) x.cls = String(c.cls);
    if (+c.level > 0) x.level = +c.level;
    if (c.ocid) x.ocid = String(c.ocid);
    return x;
  }
  function fromRoster(r){
    return (Array.isArray(r) ? r : []).filter(Array.isArray).map(function(c, i){
      return cleanChar({name: c[0] != null ? c[0] : "캐릭 " + (i + 1), weekly: c[1], monthly: c[2], main: i === 0});
    });
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
      chars = s.list.map(cleanChar);
    } else {
      var calc = read(KEYS.calc);
      chars = fromRoster(calc && calc.r);
      saveChars(true);
    }
    fixMain();
  }
  function saveChars(quiet){
    fixMain();
    write(KEYS.chars, {v:1, list:chars});
    if (!quiet) emit("change", "chars");
  }
  function charTotals(){
    var w = 0, m = 0;
    chars.forEach(function(c){ w += c.weekly; m += c.monthly; });
    return {weekly:w, monthly:m};
  }
  function findChar(id){
    for (var i = 0; i < chars.length; i++) if (chars[i].id === id) return chars[i];
    return null;
  }
  function findCharByName(name){
    for (var i = 0; i < chars.length; i++) if (chars[i].name === name) return chars[i];
    return null;
  }

  var charsApi = {
    list: function(){ return chars.slice(); },
    get: findChar,
    byName: findCharByName,
    totals: charTotals,
    add: function(c){ var x = cleanChar(c); chars.push(x); saveChars(); return x; },
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
    restore: function(c, i){ chars.splice(Math.min(i, chars.length), 0, c); saveChars(); },
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
        else { chars.push(cleanChar({name: name || "캐릭 " + (chars.length + 1), weekly:f.weekly, monthly:f.monthly})); added++; }
      });
      saveChars();
      return {added:added, updated:updated};
    },
    // Open API 캐릭터 목록: 이름이 같으면 월드·직업·레벨·ocid만 채움
    mergeApi: function(list){
      var added = 0, updated = 0;
      list.forEach(function(a){
        var c = findCharByName(a.character_name);
        var meta = {world:a.world_name, cls:a.character_class, level:a.character_level, ocid:a.ocid};
        if (c){ Object.assign(c, cleanChar(Object.assign({}, c, meta))); updated++; }
        else { chars.push(cleanChar(Object.assign({name:a.character_name}, meta))); added++; }
      });
      saveChars();
      return {added:added, updated:updated};
    },
    // 계산기 공유 링크에 담겨 온 로스터 — 링크를 연 쪽의 캐릭터를 링크 것으로 바꿈 (예전 동작과 같음)
    replaceFromRoster: function(r){
      var list = fromRoster(r);
      if (!list.length) return false;
      chars = list;
      saveChars();
      return true;
    },
    toRoster: function(){ return chars.map(function(c){ return [c.name, c.weekly, c.monthly]; }); },
    all: function(){ return chars; },
    load: loadChars,
    setAll: function(list){ chars = (Array.isArray(list) ? list : []).map(cleanChar); saveChars(); }
  };

  /* ---------- 토스트 · 되돌리기 ---------- */
  var toastTimer = null, undoFn = null;
  function toast(msg, onUndo){
    $("toast-msg").textContent = msg;
    undoFn = onUndo || null;
    $("toast-undo").hidden = !undoFn;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ $("toast").hidden = true; undoFn = null; }, 5000);
  }
  function runUndo(){
    var f = undoFn;
    undoFn = null;
    $("toast").hidden = true;
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

  // 계산기 · 장부 모듈이 뜨기 전에 캐릭터부터 (예전 계산기 로스터에서 옮기는 것도 여기서)
  loadChars();

  return {
    $:$, core:C, KEYS:KEYS, read:read, write:write, on:on, emit:emit,
    DOW:DOW, parseDate:parseDate, toISO:toISO, addDays:addDays, dayDiff:dayDiff, md:md, mdLong:mdLong,
    weekStart:weekStart, today:today, coarse:coarse,
    esc:esc, fmtEok:fmtEok, fmtSigned:fmtSigned, fmtMan:fmtMan, fmtFine:fmtFine, fmtShort:fmtShort,
    round:round, signCls:signCls, parseAmount:parseAmount,
    chars:charsApi, toast:toast, runUndo:runUndo,
    themePref:themePref, setTheme:setTheme, applyTheme:applyTheme
  };
})();
