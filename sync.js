/* 기기 간 동기화 — Google 로그인 + Firestore (Firebase).
   localStorage 가 계속 원본이고, 이 모듈은 옆에서 로컬 ↔ 클라우드를 맞춤. 로그인 안 하면 아무것도 안 함.
   병합 규칙은 core.js MesoCore.sync (테스트 있음). Firebase SDK 는 로그인한 적이 있거나 로그인 버튼을 누를 때만 불러옴. */
Meso.sync = (function(M){
  "use strict";

  var CFG = window.MESO_FIREBASE || null;
  var SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
  var S = M.core.sync;
  var K = M.KEYS;
  // 올리는 것: 장부 · 캐릭터 · 계산기 · 결정석 가격. API 키 · 테마 · 금액 단위는 기기마다
  var KEYS = {ledger:K.ledger, chars:K.chars, calc:K.calc, prices:K.prices};
  var BASE_KEY = "meso-sync-base", ON_KEY = "meso-sync-on", DEV_KEY = "meso-sync-dev";

  /* status: off(설정 없음) · loading · out(로그아웃) · syncing · idle · offline · error · ask(첫 연결 선택 대기) */
  var st = {status: CFG ? "out" : "off", user: null, at: 0, err: ""};
  var fb = null, db = null, ad = null, unwatch = null;
  var timer = null, running = false, again = false, applying = false, lastRev = -1, ask = null, lastErrToast = 0;

  function lsGet(k){ try{ return localStorage.getItem(k); } catch(e){ return null; } }
  function lsSet(k, v){ try{ if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch(e){} }
  function dev(){
    var d = lsGet(DEV_KEY);
    if (!d){ d = Math.random().toString(36).slice(2, 10); lsSet(DEV_KEY, d); }
    return d;
  }
  function set(patch){
    for (var k in patch) st[k] = patch[k];
    M.emit("sync", st.status);
  }

  /* ---------- SDK ---------- */
  var sdkP = null;
  function script(src){
    return new Promise(function(ok, no){
      var s = document.createElement("script");
      s.src = src; s.onload = ok; s.onerror = function(){ no(new Error("Firebase 를 못 불러옴")); };
      document.head.appendChild(s);
    });
  }
  function loadSdk(){
    if (!sdkP){
      sdkP = script(SDK + "firebase-app-compat.js")
        .then(function(){ return Promise.all([script(SDK + "firebase-auth-compat.js"), script(SDK + "firebase-firestore-compat.js")]); })
        .then(function(){
          fb = window.firebase;
          fb.initializeApp(CFG);
          db = fb.firestore();
          fb.auth().onAuthStateChanged(onUser);
        });
      sdkP.catch(function(){ sdkP = null; });
    }
    return sdkP;
  }

  /* ---------- 클라우드 저장소 ----------
     users/{uid}/meta/state  : rev · 캐릭터 · 계산기 · 가격 · 장부 메타(JSON 문자열) · years{연도: 해시}
     users/{uid}/ledger/{연도}: 그해 장부 기록(JSON 문자열) — 문서당 1MB 제한, 배열 안 배열을 못 넣어서 문자열로 */
  function parse(s){ try{ return s ? JSON.parse(s) : null; } catch(e){ return null; } }
  function adapter(uid){
    var root = db.collection("users").doc(uid), metaRef = root.collection("meta").doc("state");
    function yearRef(y){ return root.collection("ledger").doc(y); }
    function get(n){
      return metaRef.get().then(function(snap){
        if (!snap.exists) return null;
        var m = snap.data(), ys = Object.keys(m.years || {});
        return Promise.all(ys.map(function(y){ return yearRef(y).get(); })).then(function(snaps){
          var years = {}, bad = false;
          snaps.forEach(function(s, i){
            var d = s.exists ? s.data() : null;
            if (!d || d.h !== m.years[ys[i]]) bad = true;
            else years[ys[i]] = parse(d.data) || [];
          });
          // 다른 기기가 쓰는 도중에 읽었으면 다시
          if (bad){
            if ((n || 0) < 3) return get((n || 0) + 1);
            throw new Error("클라우드 데이터가 서로 안 맞음");
          }
          var lmeta = parse(m.lmeta);
          return {rev: m.rev || 0, years: m.years || {}, state: {
            ledger: lmeta ? S.joinLedger(lmeta, years) : null,
            chars: parse(m.chars), calc: parse(m.calc), prices: parse(m.prices)
          }};
        });
      });
    }
    function put(state, prev){
      var expect = prev ? prev.rev : 0, prevYears = prev ? prev.years : {};
      var p = state.ledger ? S.splitLedger(state.ledger) : {meta: null, years: {}}, years = {}, docs = {};
      Object.keys(p.years).forEach(function(y){ docs[y] = JSON.stringify(p.years[y]); years[y] = S.hash(p.years[y]); });
      var meta = {
        rev: expect + 1, dev: dev(), at: fb.firestore.FieldValue.serverTimestamp(),
        lmeta: JSON.stringify(p.meta), chars: JSON.stringify(state.chars || null),
        calc: JSON.stringify(state.calc || null), prices: JSON.stringify(state.prices || null), years: years
      };
      return db.runTransaction(function(tx){
        return tx.get(metaRef).then(function(snap){
          var cur = snap.exists ? snap.data().rev || 0 : 0;
          // 그 사이 다른 기기가 썼으면 처음부터 다시 받아서 합침
          if (cur !== expect){ var e = new Error("conflict"); e.conflict = true; throw e; }
          Object.keys(years).forEach(function(y){ if (years[y] !== prevYears[y]) tx.set(yearRef(y), {data: docs[y], h: years[y]}); });
          Object.keys(prevYears).forEach(function(y){ if (!years[y]) tx.delete(yearRef(y)); });
          tx.set(metaRef, meta);
        });
      }).then(function(){ return expect + 1; });
    }
    function watch(cb){
      return metaRef.onSnapshot(function(snap){
        if (snap.metadata.hasPendingWrites || !snap.exists) return;
        cb(snap.data().rev || 0);
      }, function(){});
    }
    return {get: get, put: put, watch: watch};
  }

  /* ---------- 로컬 ---------- */
  function local(){
    var o = {};
    Object.keys(KEYS).forEach(function(k){ o[k] = M.read(KEYS[k]); });
    return o;
  }
  function count(s){
    return {n: s && s.ledger && s.ledger.entries ? s.ledger.entries.length : 0, c: s && s.chars && s.chars.list ? s.chars.list.length : 0};
  }
  function hasData(s){ var c = count(s); return c.n > 0 || c.c > 0; }
  // base 는 계정마다 — 다른 계정으로 로그인하면 처음 연결로 봄
  function readBase(){
    var b = parse(lsGet(BASE_KEY));
    return b && st.user && b.uid === st.user.uid ? b.b : null;
  }
  function writeBase(state){ lsSet(BASE_KEY, JSON.stringify({uid: st.user.uid, b: S.baseOf(state)})); }

  var calcWait = false;
  // 받은 걸 로컬에 쓰고 각 모듈을 다시 읽힘. 여기서 쓴 저장은 다시 올리지 않음
  function apply(next){
    var cur = local(), changed = {};
    applying = true;
    try{
      Object.keys(KEYS).forEach(function(k){
        if (S.hash(cur[k] || null) === S.hash(next[k] || null)) return;
        changed[k] = true;
        if (next[k] == null) lsSet(KEYS[k], null); else M.write(KEYS[k], next[k]);
      });
      if (changed.ledger) M.ledger.reload();
      if (changed.chars) M.chars.load();
      if (changed.prices) M.bosses.reloadPrices();
      if (changed.calc){
        // 계산기를 고치는 중이면 손 뗄 때 반영 (입력하던 칸이 바뀌면 안 됨)
        var ae = document.activeElement, view = document.getElementById("view-calc");
        if (ae && view && view.contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)){
          if (!calcWait){
            calcWait = true;
            view.addEventListener("focusout", function f(){
              view.removeEventListener("focusout", f);
              calcWait = false;
              setTimeout(function(){ if (!view.contains(document.activeElement)) M.calc.reload(); }, 0);
            });
          }
        } else M.calc.reload();
      }
    } finally { applying = false; }
    if (Object.keys(changed).length) M.emit("change", "sync");
  }

  /* ---------- 동기화 ---------- */
  function schedule(ms){
    if (!ad || st.status === "ask") return;
    clearTimeout(timer);
    timer = setTimeout(run, ms == null ? 1500 : ms);
  }
  function run(){
    if (!ad) return;
    if (running){ again = true; return; }
    if (navigator.onLine === false){ set({status: "offline"}); return; }
    running = true;
    set({status: "syncing"});
    attempt(0).then(function(asked){
      if (!asked) set({status: "idle", at: Date.now(), err: ""});
    }, fail).then(function(){
      running = false;
      if (again){ again = false; schedule(300); }
    });
  }
  function fail(e){
    var off = navigator.onLine === false || (e && /offline|unavailable|network/i.test(String(e.code || e.message)));
    set({status: off ? "offline" : "error", err: off ? "" : String(e && (e.message || e.code) || e)});
    if (!off && Date.now() - lastErrToast > 30000){
      lastErrToast = Date.now();
      M.toast("동기화 실패 — 이 기기에는 그대로 저장됨");
    }
  }
  // true 를 돌려주면 첫 연결 선택을 기다리는 중
  function attempt(n){
    return ad.get().then(function(remote){
      var base = readBase(), mine = local();
      if (!base && remote && hasData(mine) && hasData(remote.state)){
        ask = {local: mine, remote: remote, lc: count(mine), rc: count(remote.state)};
        set({status: "ask"});
        return true;
      }
      return commit(S.merge(mine, remote ? remote.state : {}, base), remote);
    }).catch(function(e){
      if (e && e.conflict && n < 3) return attempt(n + 1);
      throw e;
    });
  }
  function commit(m, remote){
    if (m.toLocal) apply(m.state);
    var p = m.toRemote || !remote ? ad.put(m.state, remote) : Promise.resolve(remote.rev);
    return p.then(function(rev){ lastRev = rev; writeBase(m.state); return false; });
  }

  // 첫 연결에서 둘 다 데이터가 있을 때: merge(합치기) · cloud(클라우드 것으로) · local(이 기기 것으로)
  function choose(kind){
    if (!ask) return;
    var a = ask, before = a.local, next;
    ask = null;
    if (kind === "cloud") next = {state: a.remote.state, toLocal: true, toRemote: false};
    else if (kind === "local") next = {state: a.local, toLocal: false, toRemote: true};
    else next = S.merge(a.local, a.remote.state, null);
    set({status: "syncing"});
    running = true;
    commit(next, a.remote).then(function(){
      set({status: "idle", at: Date.now(), err: ""});
      var msg = kind === "cloud" ? "클라우드 데이터로 바꿈" : kind === "local" ? "이 기기 데이터로 덮어씀" : "합침 — 장부 " + count(next.state).n + "건";
      M.toast(msg, function(){
        // 양쪽 다 고르기 전으로 돌려놓고 다시 물음 (이 기기 것만 되돌리면 클라우드에만 있던 기록이 지워짐)
        apply(before);
        lsSet(BASE_KEY, null);
        ad.get().then(function(cur){ return ad.put(a.remote.state, cur); })
          .then(function(){ schedule(0); }, fail);
      });
    }, function(e){
      if (e && e.conflict){ running = false; schedule(0); return; }
      fail(e);
    }).then(function(){ running = false; });
  }

  /* ---------- 로그인 ---------- */
  function onUser(u){
    if (unwatch){ unwatch(); unwatch = null; }
    if (!u){
      // 로그인 안 된 게 확인되면 다음부터는 SDK 를 미리 안 불러옴
      lsSet(ON_KEY, null);
      ad = null; ask = null;
      set({status: CFG ? "out" : "off", user: null});
      return;
    }
    attach(adapter(u.uid), {uid: u.uid, email: u.email || "", name: u.displayName || ""});
  }
  // 저장소 어댑터 {get, put, watch} 를 붙임 — 테스트에선 Firebase 대신 가짜를 붙여 흐름을 확인
  function attach(a, user){
    if (unwatch){ unwatch(); unwatch = null; }
    set({user: user});
    lsSet(ON_KEY, "1");
    ad = a;
    lastRev = -1;
    unwatch = ad.watch(function(rev){ if (rev !== lastRev) schedule(0); });
    schedule(0);
  }
  function login(){
    if (!CFG) return Promise.resolve();
    set({status: "loading"});
    return loadSdk().then(function(){
      var p = new fb.auth.GoogleAuthProvider();
      return fb.auth().signInWithPopup(p).catch(function(e){
        // 팝업이 막힌 브라우저는 페이지 이동 방식으로
        if (e && /popup-blocked|operation-not-supported/.test(e.code)){
          // 돌아왔을 때 SDK 를 불러와야 로그인 결과를 받음
          lsSet(ON_KEY, "1");
          return fb.auth().signInWithRedirect(p);
        }
        throw e;
      });
    }).catch(function(e){
      set({status: st.user ? "idle" : "out"});
      if (e && /popup-closed|cancelled-popup/.test(e.code)) return;
      M.toast("로그인 실패 — " + (e && (e.message || e.code) || e));
    });
  }
  function logout(){
    lsSet(ON_KEY, null); lsSet(BASE_KEY, null);
    if (unwatch){ unwatch(); unwatch = null; }
    ad = null; ask = null;
    if (fb) fb.auth().signOut();
    set({status: CFG ? "out" : "off", user: null});
    M.toast("로그아웃 — 이 기기 데이터는 그대로 남음");
  }

  /* ---------- 연결 ---------- */
  M.on("saved", function(key){
    if (applying || !ad) return;
    for (var k in KEYS) if (KEYS[k] === key){ schedule(); return; }
  });
  document.addEventListener("visibilitychange", function(){ if (document.visibilityState === "visible") schedule(0); });
  window.addEventListener("online", function(){ schedule(0); });
  window.addEventListener("offline", function(){ if (ad) set({status: "offline"}); });
  // 전에 로그인해 둔 기기면 뜨자마자 이어서 (SDK 는 이때만 불러옴)
  if (CFG && lsGet(ON_KEY) === "1"){
    set({status: "loading"});
    loadSdk().catch(function(){ set({status: "offline"}); });
  }

  return {
    state: function(){ return st; },
    pending: function(){ return ask ? {lc: ask.lc, rc: ask.rc} : null; },
    login: login, logout: logout, choose: choose,
    now: function(){ schedule(0); },
    _attach: attach
  };
})(Meso);
