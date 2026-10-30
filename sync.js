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
  // 클라우드 데이터 형식 버전 — 옛 앱이 새 형식을 정제해서 덮어쓰면 필드가 사라지므로, 더 새 버전이면 읽기만 함
  var SV = 1;
  var NET_MS = 30000, RETRY_MIN = 60000, RETRY_MAX = 30 * 60000, FRESH_MS = 30000;

  /* status: off(설정 없음) · loading · out(로그아웃) · syncing · idle · offline · error · ask(첫 연결 선택 대기) */
  var st = {status: CFG ? "out" : "off", user: null, at: 0, err: ""};
  var fb = null, db = null, ad = null, unwatch = null, watchAlive = false;
  var timer = null, retryTimer = null, retryN = 0, okAt = 0;
  var running = false, again = false, applying = false, lastRev = -1, ask = null, lastErrToast = 0, droppedSeen = 0;
  // 로그아웃 · 계정 전환마다 올림 — 진행 중이던 작업의 결과는 세대가 다르면 버림
  var gen = 0;
  var STALE = {stale: true}, HANDLED = {handled: true};

  function lsGet(k){ try{ return localStorage.getItem(k); } catch(e){ return null; } }
  function lsSet(k, v){
    try{ if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch(e){ return false; }
  }
  function dev(){
    var d = lsGet(DEV_KEY);
    if (!d){ d = Math.random().toString(36).slice(2, 10); lsSet(DEV_KEY, d); }
    return d;
  }
  function set(patch){
    for (var k in patch) st[k] = patch[k];
    M.emit("sync", st.status);
  }
  // get · put 이 응답 없이 멈추면 running 이 영영 안 풀리므로 시간 제한
  function tmo(p){
    return new Promise(function(ok, no){
      var t = setTimeout(function(){ no(new Error("클라우드 응답이 없음 (시간 초과)")); }, NET_MS);
      p.then(function(v){ clearTimeout(t); ok(v); }, function(e){ clearTimeout(t); no(e); });
    });
  }
  // 같은 브라우저의 다른 탭과 한 번에 하나만 (base 를 둘이 동시에 쓰면 원격 편집이 유실됨)
  function locked(fn){
    var L = typeof navigator !== "undefined" && navigator.locks;
    if (L && L.request){
      try{ return L.request("meso-sync", fn); } catch(e){}
    }
    return fn();
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
  // 전에 로그인해 둔 기기면 SDK 를 불러옴 — 오프라인으로 열었다가 돌아왔을 때도 다시 시도
  function boot(){
    if (!CFG || ad || lsGet(ON_KEY) !== "1") return;
    if (!sdkP) set({status: "loading"});
    loadSdk().catch(function(){ if (!ad) set({status: "offline"}); });
  }

  /* ---------- 클라우드 저장소 ----------
     users/{uid}/meta/state  : rev · sv · 캐릭터 · 계산기 · 가격 · 장부 메타(JSON 문자열) · years{연도: 해시}
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
          var years = {}, bad = false, broken = "";
          snaps.forEach(function(s, i){
            var d = s.exists ? s.data() : null;
            if (!d || d.h !== m.years[ys[i]]){ bad = true; return; }
            var arr = parse(d.data);
            // 깨진 문서를 빈 해로 읽으면 로컬 기록이 지워짐 — 배열이고 해시가 맞는지 확인
            if (!Array.isArray(arr) || S.hash(arr) !== d.h) broken = broken || ys[i];
            else years[ys[i]] = arr;
          });
          // 다른 기기가 쓰는 도중에 읽었으면 다시
          if (bad){
            if ((n || 0) < 3) return get((n || 0) + 1);
            throw new Error("클라우드 데이터가 서로 안 맞음");
          }
          if (broken) throw new Error("클라우드 장부(" + broken + "년) 문서가 깨져 있음. 동기화 중단");
          var lmeta = parse(m.lmeta);
          return {rev: m.rev || 0, sv: m.sv || 0, years: m.years || {}, state: {
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
        rev: expect + 1, sv: SV, dev: dev(), at: fb.firestore.FieldValue.serverTimestamp(),
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
    function watch(cb, onErr){
      return metaRef.onSnapshot(function(snap){
        if (snap.metadata.hasPendingWrites || !snap.exists) return;
        cb(snap.data().rev || 0);
      }, function(e){ if (onErr) onErr(e); });
    }
    return {get: get, put: put, watch: watch};
  }

  /* ---------- 로컬 ---------- */
  function local(){
    var o = {};
    Object.keys(KEYS).forEach(function(k){ o[k] = M.read(KEYS[k]); });
    return o;
  }
  // 양쪽을 같은 방식으로 정제해서 비교 — 형식 불량 기록이 한쪽에만 있다가 저장될 때 조용히 사라지는 걸 막음. dropped = 버려진 장부 기록 수
  function clean(s){
    s = s || {};
    var o = {ledger: null, chars: null, calc: s.calc || null, prices: null}, dropped = 0;
    if (s.ledger){
      if (M.ledger && M.ledger.inspect){ var r = M.ledger.inspect(s.ledger); o.ledger = r.state; dropped = r.dropped; }
      else o.ledger = s.ledger;
    }
    if (s.chars) o.chars = M.chars && M.chars.sanitize ? M.chars.sanitize(s.chars) : s.chars;
    if (s.prices){
      var p = M.bosses && M.bosses.sanitizePrices ? M.bosses.sanitizePrices(s.prices) : s.prices;
      o.prices = p && Object.keys(p).length ? p : null;
    }
    return {state: o, dropped: dropped};
  }
  // 클라우드에서 받은 것 + 지금 로컬을 정제해서 돌려줌
  function prep(remote){
    var r = remote ? clean(remote.state) : null;
    if (r && r.dropped > 0 && r.dropped !== droppedSeen) M.toast("클라우드 기록 " + r.dropped + "건이 형식이 맞지 않아 제외");
    droppedSeen = r ? r.dropped : 0;
    return {mine: clean(local()).state, rem: r ? r.state : null};
  }
  function count(s){
    return {n: s && s.ledger && s.ledger.entries ? s.ledger.entries.length : 0, c: s && s.chars && s.chars.list ? s.chars.list.length : 0};
  }
  function hasData(s){ var c = count(s); return c.n > 0 || c.c > 0; }

  // base 는 계정마다, 형식 버전이 같을 때만 — 아니면 없는 것으로 보고 처음 연결로 처리
  function readBase(){
    var b = parse(lsGet(BASE_KEY));
    return b && st.user && b.uid === st.user.uid && b.b && b.b.v === S.BASE_V ? b.b : null;
  }
  // 다른 탭이 더 새 클라우드 시점을 이미 저장했으면 덮지 않음 (false)
  function writeBase(state, rev, g){
    if (g !== gen || !st.user) return false;
    var cur = readBase();
    if (cur && typeof cur.rev === "number" && typeof rev === "number" && cur.rev > rev) return false;
    if (!lsSet(BASE_KEY, JSON.stringify({uid: st.user.uid, b: S.baseOf(state, rev)}))) throw new Error("동기화 기준점을 이 기기에 저장하지 못함");
    return true;
  }

  var calcWait = false;
  // 계산기를 고치는 중이면 손 뗄 때 반영 (입력하던 칸이 바뀌면 안 됨)
  function reloadCalc(){
    var ae = document.activeElement, view = document.getElementById("v-calc");
    if (ae && view && view.contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)){
      if (calcWait) return;
      calcWait = true;
      view.addEventListener("focusout", function f(ev){
        // 칸 사이로 옮겨 가는 건 계속 기다림 — 뷰 밖으로 나갔을 때만 반영
        if (ev.relatedTarget && view.contains(ev.relatedTarget)) return;
        setTimeout(function(){
          if (view.contains(document.activeElement)) return;
          view.removeEventListener("focusout", f);
          calcWait = false;
          M.calc.reload();
        }, 0);
      });
    } else M.calc.reload();
  }
  function reload(changed){
    if (changed.ledger) M.ledger.reload();
    if (changed.chars) M.chars.load();
    if (changed.prices) M.bosses.reloadPrices();
    if (changed.calc) reloadCalc();
  }
  // 받은 걸 로컬에 쓰고 각 모듈을 다시 읽힘. 여기서 쓴 저장은 다시 올리지 않음
  // 저장이 하나라도 실패하면 이미 쓴 것을 되돌리고 false — 호출한 쪽은 base · put 을 건너뜀
  function apply(next){
    var cur = S.norm(clean(local()).state), nn = S.norm(next), changed = {}, done = [], ok = true;
    applying = true;
    try{
      Object.keys(KEYS).some(function(k){
        if (S.hash(cur[k] || null) === S.hash(nn[k] || null)) return false;
        var prev = lsGet(KEYS[k]);
        if (next[k] == null) lsSet(KEYS[k], null);
        else if (!M.write(KEYS[k], next[k])){ ok = false; return true; }
        changed[k] = true;
        done.push({k: k, raw: prev});
        return false;
      });
      if (!ok){
        var back = {};
        done.reverse().forEach(function(d){ lsSet(KEYS[d.k], d.raw); back[d.k] = true; });
        reload(back);
      } else {
        if (changed.ledger || changed.chars){ if (M.dropUndo) M.dropUndo(); }   // 되돌리기 토스트가 옛 상태로 되돌리면 다른 기기 변경이 지워짐
        reload(changed);
      }
    } finally { applying = false; }
    if (!ok){
      set({status: "error", err: "이 기기에 저장하지 못함"});
      M.toast("동기화 실패: 저장 공간이 부족해 받은 내용을 적용하지 못함");
      return false;
    }
    if (Object.keys(changed).length) M.emit("change", "sync");
    return true;
  }

  /* ---------- 동기화 ---------- */
  function schedule(ms){
    if (!ad || st.status === "ask") return;
    clearTimeout(timer);
    timer = setTimeout(run, ms == null ? 1500 : ms);
  }
  function retryIn(ms){
    clearTimeout(retryTimer);
    retryTimer = setTimeout(function(){ schedule(0); }, ms);
  }
  function watchStart(){
    if (!ad || unwatch) return;
    var g = gen;
    watchAlive = true;
    unwatch = ad.watch(function(rev){
      if (g === gen && rev !== lastRev) schedule(0);
    }, function(e){
      if (g !== gen) return;
      // 구독이 죽었는데 "동기화됨" 으로 두면 거짓 — 표시하고 다음 동기화 때 다시 구독
      watchAlive = false;
      if (unwatch){ try{ unwatch(); } catch(x){} unwatch = null; }
      var off = navigator.onLine === false;
      if (!running) set({status: off ? "offline" : "error", err: off ? "" : "실시간 연결이 끊김: " + String(e && (e.message || e.code) || e)});
      if (!off) retryIn(RETRY_MIN);
    });
  }
  function run(){
    if (!ad) return;
    if (running){ again = true; return; }
    if (navigator.onLine === false){ set({status: "offline"}); return; }
    running = true;
    var g = gen;
    set({status: "syncing"});
    locked(function(){ return attempt(0, g); }).then(function(asked){
      if (g !== gen) return;
      if (!asked) done();
    }, function(e){ if (g === gen) fail(e); }).then(function(){
      running = false;
      if (again){ again = false; schedule(300); }
    });
  }
  function done(){
    retryN = 0; okAt = Date.now();
    clearTimeout(retryTimer);
    set({status: "idle", at: okAt, err: ""});
    watchStart();
  }
  function fail(e){
    if (e === STALE) return;
    var handled = e === HANDLED;   // apply 가 이미 상태 · 토스트를 냄
    var off = navigator.onLine === false || (!handled && e && /offline|unavailable|network/i.test(String(e.code || e.message)));
    if (!handled) set({status: off ? "offline" : "error", err: off ? "" : String(e && (e.message || e.code) || e)});
    if (off) return;
    if (!handled && Date.now() - lastErrToast > 30000){
      lastErrToast = Date.now();
      M.toast("동기화 실패 (이 기기에는 그대로 저장됨)");
    }
    // 새 버전이 있어 멈춘 건 새로고침 전엔 다시 해도 같음
    if (e && e.noRetry) return;
    if (e && e.conflict){ retryIn(5000); return; }
    retryN++;
    retryIn(Math.min(RETRY_MIN * Math.pow(2, retryN - 1), RETRY_MAX));
  }
  function conflictErr(){ var e = new Error("conflict"); e.conflict = true; return e; }
  // true 를 돌려주면 첫 연결 선택을 기다리는 중
  function attempt(n, g){
    return tmo(ad.get()).then(function(remote){
      if (g !== gen) throw STALE;
      var v = prep(remote), base = remote ? readBase() : null;   // 클라우드가 비었으면 처음 연결처럼 올림
      if (base && typeof base.rev === "number" && remote && base.rev > remote.rev){
        // 다른 탭이 이미 더 새 시점을 기록함 (또는 클라우드가 되돌려짐) — 다시 받음
        throw conflictErr();
      }
      if (!base && remote && hasData(v.mine) && hasData(v.rem)){
        var m0 = S.merge(v.mine, v.rem, null);
        // 같은 데이터로 다시 로그인한 경우 등 — 물을 필요 없이 기준점만
        if (!m0.toLocal && !m0.toRemote){
          writeBase(v.rem, remote.rev, g);
          lastRev = remote.rev;
          return false;
        }
        ask = {g: g, local: v.mine, remote: remote, lc: count(v.mine), rc: count(v.rem)};
        set({status: "ask"});
        return true;
      }
      return commit(S.merge(v.mine, v.rem || {}, base), remote, g).then(function(){ return false; });
    }).catch(function(e){
      if (e && e.conflict && n < 3 && g === gen) return attempt(n + 1, g);
      throw e;
    });
  }
  /* 받은 것을 로컬에 쓰고(apply) → 받은 클라우드 시점을 base 로 → 올리고(put) → 합친 결과를 base 로.
     apply 직후 base 를 받은 시점으로 맞춰 두면, put 이 실패해 다시 돌 때 받은 값이 "이 기기 수정"으로 보이지 않음.
     클라우드 rev 를 돌려줌 */
  function commit(m, remote, g){
    var rv = remote ? remote.rev : 0;
    if (m.toLocal){
      if (!apply(m.state)) throw HANDLED;
      if (!writeBase(remote ? remote.state : {ledger: null, chars: null, calc: null, prices: null}, rv, g)){
        if (g !== gen) throw STALE;
        throw conflictErr();
      }
    }
    if (remote && remote.sv > SV){
      var e0 = new Error("새 버전이 있음. 새로고침 필요");
      e0.noRetry = true;
      throw e0;
    }
    var need = m.toRemote || !remote;
    // 빈 기기가 빈 상태를 클라우드에 만들지 않음
    if (!remote && S.empty(m.state)) return Promise.resolve(rv);
    var p = need ? tmo(ad.put(m.state, remote)) : Promise.resolve(rv);
    return p.then(function(rev){
      if (g !== gen) throw STALE;
      lastRev = rev;
      if (!writeBase(m.state, rev, g)){ if (g !== gen) throw STALE; again = true; }
      return rev;
    });
  }

  // 첫 연결에서 둘 다 데이터가 있을 때: merge(합치기) · cloud(클라우드 것으로) · local(이 기기 것으로)
  // 고르는 순간 로컬 · 클라우드를 다시 읽어서 그걸로 계산 (묻는 동안 바뀐 편집을 잃지 않게)
  function choose(kind){
    if (!ask) return;
    var a = ask, g = a.g;
    ask = null;
    if (g !== gen) return;
    set({status: "syncing"});
    running = true;
    var undoInfo = null;
    locked(function(){
      return tmo(ad.get()).then(function(remote){
        if (g !== gen) throw STALE;
        var v = prep(remote), next;
        if (!remote) next = S.merge(v.mine, {}, null);
        else if (kind === "cloud") next = {state: v.rem, toLocal: true, toRemote: false};
        else if (kind === "local") next = {state: v.mine, toLocal: false, toRemote: true};
        else next = S.merge(v.mine, v.rem, null);
        return commit(next, remote, g).then(function(rev){
          if (remote) undoInfo = {before: v.mine, remote: remote, rev: rev, after: S.hash(S.norm(local()))};
          return next;
        });
      });
    }).then(function(next){
      if (g !== gen) return;
      done();
      var msg = kind === "cloud" ? "클라우드 데이터로 바꿈" : kind === "local" ? "이 기기 데이터로 덮어씀" : "합침: 장부 " + count(next.state).n + "건";
      M.toast(msg, undoInfo ? function(){ undoChoice(g, undoInfo); } : null);
    }, function(e){
      if (g !== gen) return;
      if (e && e.conflict){ schedule(0); return; }
      fail(e);
    }).then(function(){
      running = false;
      if (again){ again = false; schedule(300); }
    });
  }
  // 양쪽 다 고르기 전으로 돌려놓고 다시 물음 (이 기기 것만 되돌리면 클라우드에만 있던 기록이 지워짐)
  // 고른 뒤 로컬이 바뀌었거나 클라우드가 (선택 때 받은 rev 에서) 달라졌으면 되돌리지 않음
  function undoChoice(g, u){
    function cant(){ M.toast("이미 바뀌어 되돌릴 수 없음"); }
    if (g !== gen || !ad) return cant();
    if (S.hash(S.norm(local())) !== u.after) return cant();
    locked(function(){
      return tmo(ad.get()).then(function(cur){
        if (g !== gen) throw STALE;
        if (!cur || cur.rev !== u.rev || cur.sv > SV || S.hash(S.norm(local())) !== u.after) throw conflictErr();
        return tmo(ad.put(u.remote.state, cur)).then(function(){
          if (g !== gen) throw STALE;
          if (!apply(u.before)) throw HANDLED;
          lsSet(BASE_KEY, null);
        });
      });
    }).then(function(){
      if (g === gen) schedule(0);
    }, function(e){
      if (g !== gen) return;
      if (e && e.conflict) cant(); else fail(e);
    });
  }

  /* ---------- 로그인 ---------- */
  function reset(){
    gen++;
    if (unwatch){ try{ unwatch(); } catch(e){} unwatch = null; }
    watchAlive = false; ask = null; again = false; retryN = 0; okAt = 0; droppedSeen = 0;
    clearTimeout(timer); clearTimeout(retryTimer);
  }
  function onUser(u){
    if (!u){
      // 로그인 안 된 게 확인되면 다음부터는 SDK 를 미리 안 불러옴
      lsSet(ON_KEY, null);
      reset();
      ad = null;
      set({status: CFG ? "out" : "off", user: null});
      return;
    }
    attach(adapter(u.uid), {uid: u.uid, email: u.email || "", name: u.displayName || ""});
  }
  // 저장소 어댑터 {get, put, watch} 를 붙임 — 테스트에선 Firebase 대신 가짜를 붙여 흐름을 확인
  function attach(a, user){
    reset();
    set({user: user});
    if (st.status === "ask") set({status: "loading"});
    lsSet(ON_KEY, "1");
    ad = a;
    lastRev = -1;
    watchStart();
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
      M.toast("로그인 실패: " + (e && (e.message || e.code) || e));
    });
  }
  function logout(){
    lsSet(ON_KEY, null); lsSet(BASE_KEY, null);
    reset();
    ad = null;
    if (fb) fb.auth().signOut();
    set({status: CFG ? "out" : "off", user: null});
    M.toast("로그아웃. 이 기기 데이터는 그대로 남음");
  }

  /* ---------- 연결 ---------- */
  M.on("saved", function(key){
    if (applying || !ad) return;
    for (var k in KEYS) if (KEYS[k] === key){ schedule(); return; }
  });
  document.addEventListener("visibilitychange", function(){
    if (document.visibilityState !== "visible") return;
    boot();
    // 방금 맞췄고 실시간 구독도 살아 있으면 탭을 오갈 때마다 전체를 다시 받지 않음
    if (okAt && Date.now() - okAt < FRESH_MS && watchAlive) return;
    schedule(0);
  });
  window.addEventListener("online", function(){ boot(); schedule(0); });
  window.addEventListener("offline", function(){ if (ad) set({status: "offline"}); });
  boot();

  return {
    state: function(){ return st; },
    pending: function(){ return ask ? {lc: ask.lc, rc: ask.rc} : null; },
    login: login, logout: logout, choose: choose,
    now: function(){ schedule(0); },
    _attach: attach
  };
})(Meso);
