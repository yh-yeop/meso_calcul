/* 셸 — 해시 라우팅, 화면 전환, ⚙ 설정(테마 · 백업 · CSV · 계산기 초기화), 시트 닫기, 다른 탭과 동기화.
   라우트: #home · #ledger[/stats|/budget] · #calc · #chars · #settings
   계산기 공유 링크(#s=…)와 목표 진입점(#goal=…)은 한 번 적용하고 주소를 #calc 로 바꿈 */
(function(M){
  "use strict";

  var $ = M.$, C = M.core;
  var VIEWS = ["home", "ledger", "calc", "chars", "settings"];
  var cur = null, curSub = null;

  function render(source){
    if (cur === "home") M.home.render();
    else if (cur === "ledger") M.ledger.render(curSub);
    // 계산기는 입력이 바뀔 때 스스로 다시 그림 — 같은 변경으로 두 번 그리지 않게
    else if (cur === "calc"){ if (source !== "calc") M.calc.render(); }
    else if (cur === "chars") M.charsView.render();
    else if (cur === "settings") renderSettings();
  }

  function show(v, sub){
    var changed = cur !== v;
    cur = v;
    curSub = v === "ledger" ? (sub === "stats" || sub === "budget" ? sub : "log") : null;
    VIEWS.forEach(function(x){ $("v-" + x).hidden = x !== v; });
    Array.prototype.forEach.call(document.querySelectorAll(".tabs [data-view]"), function(a){
      if (a.dataset.view === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    if (v === "settings") $("btn-settings").setAttribute("aria-current", "page"); else $("btn-settings").removeAttribute("aria-current");
    $("fab").hidden = !(v === "home" || v === "ledger");
    if (changed) window.scrollTo(0, 0);
    if (calcWaiting && v !== "calc") flushCalc();   // 계산기 화면을 떠났는데 focusout 이 안 온 경우
    render();
  }

  // 로그인 중이면 이 기기 변경이 클라우드로 올라가 다른 기기에도 퍼짐 — 덮어쓰기 확인에 한 줄 덧붙임
  function syncNote(){
    var y = M.sync && M.sync.state && M.sync.state();
    return y && y.user ? "\n로그인 중이라 모든 기기에 반영됨" : "";
  }

  // 공유 링크는 캐릭터(보스 루틴 포함)를 통째로 갈아끼우므로 먼저 읽어보고, 덮어쓸 땐 묻고, 되돌리기를 줌
  function applySharedLink(code){
    var s = null;
    try{ s = JSON.parse(C.b64d(code)); } catch(e){}
    if (!s || typeof s !== "object"){ M.toast("공유 링크를 못 읽음"); return; }
    var mine = M.chars.all().length, theirs = Array.isArray(s.r) ? s.r.length : 0, takeChars = true;
    if (theirs && mine){
      // 어느 쪽이든 계산기 설정은 바뀜 — 캐릭터만 확인/취소로 갈림
      takeChars = confirm("공유 링크에 캐릭터 " + theirs + "명이 들어 있음.\n확인: 지금 캐릭터 " + mine + "명을 링크 것으로 바꿈 (이름이 같은 캐릭터는 보스 루틴 · 본캐 유지)\n취소: 캐릭터는 그대로, 계산기 설정만 불러옴" + syncNote());
    }
    var before = {calc:M.calc.getState(), chars:JSON.parse(JSON.stringify(M.chars.all()))}, ok = false;
    try{ ok = M.calc.applyShare(s, takeChars) !== false; } catch(e){}
    if (!ok){ M.toast("공유 링크를 못 읽음"); return; }
    M.toast(theirs && takeChars ? "공유 링크의 계산기 설정과 캐릭터를 불러옴" : "공유 링크의 계산기 설정을 불러옴", function(){
      M.chars.setAll(before.chars);
      M.calc.setState(before.calc);
    });
  }

  function route(){
    var h = location.hash.replace(/^#/, "");
    var share = h.match(/(?:^|&)s=([A-Za-z0-9\-_]+)/), goal = h.match(/(?:^|&)goal=(\d+(?:\.\d+)?)/);
    if (share){
      history.replaceState(null, "", "#calc");
      applySharedLink(share[1]);
      h = "calc";
      // 링크에 goal= 도 같이 있으면 공유 설정 위에 목표를 얹음
      if (goal){ show("calc"); M.calc.applyGoal(parseFloat(goal[1])); return; }
    } else if (goal){
      history.replaceState(null, "", "#calc");
      show("calc");
      M.calc.applyGoal(parseFloat(goal[1]));
      return;
    }
    var p = h.split("/");
    show(VIEWS.indexOf(p[0]) >= 0 ? p[0] : "home", p[1]);
  }

  /* ---------- ⚙ 설정 ---------- */
  function renderSettings(){
    var pref = M.themePref();
    Array.prototype.forEach.call($("theme-seg").children, function(b){
      b.setAttribute("aria-pressed", b.dataset.theme === pref ? "true" : "false");
    });
    renderPrices();
    renderSync();
  }

  /* ---------- 계정 · 동기화 ---------- */
  function ago(t){
    var s = Math.round((Date.now() - t) / 1000);
    return s < 60 ? "방금" : s < 3600 ? Math.floor(s / 60) + "분 전" : Math.floor(s / 3600) + "시간 전";
  }
  function renderSync(){
    var y = M.sync.state(), u = y.user, on = !!u && y.status !== "out";
    var label = {off:"", loading:"연결 중…", out:"", syncing:"동기화 중…", idle:"동기화됨", offline:"오프라인", error:"오류", ask:"선택 필요"}[y.status] || "";
    $("sync-state").textContent = label;
    $("sync-note").textContent =
      y.status === "off" ? "아직 연결 안 됨 — 서버 설정(firebase-config.js)이 비어 있음." :
      !on ? "로그인하면 폰 · PC 에서 같은 장부 · 캐릭터 · 계산기를 씀. API 키는 기기마다 따로." :
      (u.email || u.name) + " · " + (
        y.status === "offline" ? "연결되면 올림" :
        y.status === "error" ? "동기화 실패 — 이 기기엔 저장됨" :
        y.status === "ask" ? "이 기기와 클라우드에 둘 다 데이터가 있음" :
        y.at ? ago(y.at) + " 맞춤" : "맞추는 중");
    $("sync-login").hidden = on || y.status === "off";
    $("sync-login").disabled = y.status === "loading";
    $("sync-now").hidden = !on;
    $("sync-now").textContent = y.status === "ask" ? "다시 고르기" : "지금 동기화";
    $("sync-logout").hidden = !on;
  }
  function openLink(){
    var p = M.sync.pending();
    if (!p) return;
    $("link-msg").innerHTML = "이 기기: 장부 <b>" + p.lc.n + "</b>건 · 캐릭터 <b>" + p.lc.c + "</b>명<br>" +
      "클라우드: 장부 <b>" + p.rc.n + "</b>건 · 캐릭터 <b>" + p.rc.c + "</b>명";
    if (!$("link-sheet").open) $("link-sheet").showModal();
  }
  M.on("sync", function(status){
    if (cur === "settings") renderSync();
    if (status === "ask") openLink();
  });
  $("sync-login").addEventListener("click", function(){ M.sync.login(); });
  $("sync-logout").addEventListener("click", function(){
    if (confirm("로그아웃할까? 이 기기 데이터는 그대로 남고 동기화만 멈춤.")) M.sync.logout();
  });
  $("sync-now").addEventListener("click", function(){
    if (M.sync.pending()) openLink(); else M.sync.now();
  });
  $("link-sheet").addEventListener("click", function(e){
    var b = e.target.closest("[data-link]");
    if (!b) return;
    var k = b.dataset.link;
    if (k === "local" && !confirm("클라우드 데이터를 이 기기 것으로 덮어씀. 계속?")) return;
    $("link-sheet").close();
    M.sync.choose(k);
  });
  $("theme-seg").addEventListener("click", function(e){
    var b = e.target.closest("[data-theme]");
    if (!b) return;
    M.setTheme(b.dataset.theme);
    renderSettings();
  });

  function download(name, text, type){
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], {type:type}));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  function stamp(){ return M.toISO(M.today()).replace(/-/g, ""); }

  // 백업 한 파일에 장부 · 계산기 · 캐릭터. API 키는 안 넣음
  $("btn-backup").addEventListener("click", function(){
    var b = {app:"meso", v:1, saved:new Date().toISOString(),
             ledger:M.ledger.getState(), calc:M.calc.getState(), chars:M.chars.all(), prices:M.bosses.overrides()};
    download("meso-backup-" + stamp() + ".json", JSON.stringify(b, null, 1), "application/json");
  });
  $("btn-restore").addEventListener("click", function(){ $("file").click(); });

  // 저장 실패 안내 — 연달아 나도 10초에 한 번만. 복원 중이면 아래 restore 가 실패로 처리하게 표시만 남김
  var storageFailed = false, lastStorageToast = 0;
  M.on("storage-error", function(){
    storageFailed = true;
    var now = Date.now();
    if (now - lastStorageToast < 10000) return;
    lastStorageToast = now;
    M.toast("저장 실패 — 브라우저 저장 공간을 확인해줘 (백업 권장)");
  });
  $("file").addEventListener("change", function(){
    var f = this.files[0];
    this.value = "";
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function(){
      var s;
      try{ s = JSON.parse(rd.result); } catch(e){ M.toast("JSON 파일이 아님"); return; }
      // 통합 백업 / 예전 장부 전용 백업 (entries 가 바로 있음) 둘 다 받음
      var full = !!s && typeof s === "object" && s.app === "meso";
      // 통합 백업인데 장부가 없으면 거절 — 그대로 받으면 장부가 빈 상태로 덮임
      var src = s && typeof s === "object" ? (full ? s.ledger : s) : null;
      if (!s || typeof s !== "object" || !Array.isArray(src && src.entries)){ M.toast("메소 백업 파일이 아님"); return; }
      // 적용 전에 다 걸러 둠 — 중간에 터져도 반쯤 복원된 채로 남지 않게
      var insp = M.ledger.inspect ? M.ledger.inspect(src) : {state:M.ledger.sanitize(src), dropped:0};
      var ledger = insp.state, dropped = insp.dropped || 0;
      var dropNote = dropped > 0 ? dropped + "건은 형식이 맞지 않아 제외" : "";
      var chars = full && Array.isArray(s.chars) ? s.chars.filter(function(x){ return x && typeof x === "object"; }) : null;
      var calc = full && s.calc && typeof s.calc === "object" ? s.calc : null;
      var prices = full && s.prices && typeof s.prices === "object" ? s.prices : null;
      var what = ["장부 " + ledger.entries.length + "건"];
      if (chars) what.push("캐릭터 " + chars.length + "명");
      if (calc || prices) what.push((calc ? "계산기" : "") + (calc && prices ? " · " : "") + (prices ? "결정석 가격" : ""));
      var nowL = M.ledger.count(), nowC = M.chars.all().length;
      if ((nowL || nowC) &&
          !confirm("백업으로 덮어씀\n지금 장부 " + nowL + "건 → 백업 " + ledger.entries.length + "건" +
                   (chars ? "\n지금 캐릭터 " + nowC + "명 → 백업 " + chars.length + "명" : "") +
                   (calc || prices ? "\n" + what[what.length - 1] + "도 바뀜" : "") +
                   (dropNote ? "\n(" + dropNote + ")" : "") + syncNote() + "\n진행?")) return;
      var before = {ledger:M.ledger.getState(), calc:M.calc.getState(),
                    chars:JSON.parse(JSON.stringify(M.chars.all())), prices:M.bosses.overrides()};
      function restore(b){
        M.ledger.setState(b.ledger);
        M.chars.setAll(b.chars);
        M.calc.setState(b.calc);
        M.bosses.setOverrides(b.prices);
        renderPrices(true);
      }
      // 적용 중 저장 실패가 한 번이라도 나면 반쯤 저장된 것이므로 실패로 봄
      storageFailed = false;
      var threw = false;
      try{
        M.ledger.setState(ledger);
        if (chars) M.chars.setAll(chars);
        if (calc) M.calc.setState(calc);
        if (prices){ M.bosses.setOverrides(prices); renderPrices(true); }
      } catch(e){ threw = true; }
      if (threw || storageFailed){
        try{ restore(before); } catch(e2){}
        M.toast(storageFailed ? "복원 실패 — 저장 공간 부족, 이전 상태로 돌려놓음" : "복원 실패 — 이전 상태로 돌려놓음");
        return;
      }
      M.toast("복원함 — " + what.join(", ") + (dropNote ? " (" + dropNote + ")" : ""), function(){ restore(before); });
    };
    rd.readAsText(f);
  });

  $("btn-csv").addEventListener("click", function(){
    var L = M.ledger.compute();
    var q = function(v){ v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [["날짜", "구분", "항목", "금액(억)", "사냥시간", "캐릭터", "메모", "잔고(억)", "미기록(억)", "출처"].join(",")];
    L.rows.forEach(function(r){
      var e = r.e, api = e.src && e.src.indexOf("api:") === 0;
      lines.push([e.d, e.t === "in" ? "수입" : e.t === "out" ? "지출" : "잔고확인",
                  e.t === "bal" ? "" : M.ledger.cat(e.t, e.c).n,
                  e.t === "out" ? -e.a : e.a, e.h || "", e.ch || "", e.m || "",
                  M.round(r.after, 4), r.adj ? M.round(r.adj, 4) : "",
                  api ? (e.est ? "API 추정" : "API") + (e.lock ? " 고정" : "") : e.src ? "보스 체크" : ""].map(q).join(","));
    });
    // 엑셀이 한글을 깨뜨리지 않게 BOM
    download("meso-ledger-" + stamp() + ".csv", "﻿" + lines.join("\r\n"), "text/csv");
  });

  /* 결정석 가격 — 기본값은 bosses.js, 고친 값은 meso-boss-prices. 억/만/게임 숫자 다 받음 */
  // full: 목록을 처음부터 다시 그림. 입력 중에는 헤더만 고쳐야 포커스가 안 날아감
  function renderPrices(full){
    var B = M.bosses, over = B.overrides(), n = Object.keys(over).length;
    $("price-sub").textContent = B.data.version + " 기준" + (n ? " · " + n + "개 고침" : "");
    $("price-reset").hidden = !n;
    if (!full || $("price-list").hidden) return;
    var rows = [];
    [["w", "주간"], ["m", "월간"]].forEach(function(k){
      rows.push('<div class="prow-h">' + k[1] + ' 보스</div>');
      B.list(k[0]).forEach(function(b){
        Object.keys(b.p).forEach(function(d){
          var key = b.id + ":" + d, cur = B.price(k[0], b.id, d), def = b.p[d], isOver = key in over;
          rows.push('<div class="prow' + (isOver ? ' over' : '') + '"><label for="pr-' + key + '">' + M.esc(b.n) + ' ' + B.data.diffs[d] +
            '<small>' + k[1] + (isOver ? ' · 기본 ' + M.fmtMan(def / 1e8) : '') + '</small></label>' +
            '<input type="text" inputmode="decimal" id="pr-' + key + '" data-k="' + k[0] + '" data-b="' + b.id + '" data-d="' + d + '"' +
            ' value="' + M.fmtMan(cur / 1e8) + '" aria-label="' + M.esc(b.n) + ' ' + B.data.diffs[d] + ' 가격"></div>');
        });
      });
    });
    $("price-list").innerHTML = rows.join("");
  }
  $("price-toggle").addEventListener("click", function(){
    var open = $("price-list").hidden;
    $("price-list").hidden = !open;
    this.setAttribute("aria-expanded", open ? "true" : "false");
    this.textContent = open ? "닫기" : "가격 보기 · 수정";
    renderPrices(open);
  });
  $("price-list").addEventListener("change", function(e){
    var i = e.target.closest("input[data-b]");
    if (!i) return;
    var v = i.value.trim() ? M.parseAmount(i.value) : 0;
    if (v === null){ M.toast("가격을 못 읽음 — 예: 5970만, 0.597억, 59,700,000"); return; }
    // 결정석 1개가 100억을 넘는 일은 없음 — 단위 없는 5970(=5,970억) 같은 실수는 저장 전에 되물음
    if (v > 100){
      M.toast(M.fmtEok(v) + "으로 읽힘 — 만 단위면 '5970만'처럼 써 줘");
      i.value = M.fmtMan(M.bosses.price(i.dataset.k, i.dataset.b, i.dataset.d) / 1e8);
      return;
    }
    M.bosses.setPrice(i.dataset.k, i.dataset.b, i.dataset.d, v * 1e8);
    // 행만 제자리에서 고침 — 목록을 다시 그리면 다음 칸으로 넘어가는 포커스가 사라짐
    var k = i.dataset.k, b = i.dataset.b, d = i.dataset.d, B = M.bosses, row = i.closest(".prow");
    var isOver = (b + ":" + d) in B.overrides(), small = row.querySelector("small");
    row.classList.toggle("over", isOver);
    small.textContent = (k === "w" ? "주간" : "월간") + (isOver ? " · 기본 " + M.fmtMan(B.defaultPrice(k, b, d) / 1e8) : "");
    i.value = M.fmtMan(B.price(k, b, d) / 1e8);
    renderPrices();
  });
  $("price-reset").addEventListener("click", function(){
    var before = M.bosses.overrides();
    M.bosses.setOverrides({});
    renderPrices(true);
    M.toast("결정석 가격을 기본값으로", function(){ M.bosses.setOverrides(before); renderPrices(true); });
  });

  $("btn-calc-reset").addEventListener("click", function(){
    var before = M.calc.getState();
    M.calc.reset();
    M.toast("계산기 입력을 기본값으로", function(){ M.calc.setState(before); });
  });

  /* ---------- 공통 ---------- */
  $("fab").addEventListener("click", function(){ M.ledger.openSheet(); });
  $("toast-undo").addEventListener("click", M.runUndo);
  document.addEventListener("click", function(e){
    var x = e.target.closest("[data-close]");
    if (x) x.closest("dialog").close();
  });
  // 시트 바깥(배경) 클릭으로 닫기 — 입력이 바뀐 시트(dataset.dirty)는 실수로 날아가지 않게 X · 취소로만 닫음
  Array.prototype.forEach.call(document.querySelectorAll("dialog.sheet"), function(d){
    d.addEventListener("click", function(e){ if (e.target === d && d.dataset.dirty !== "1") d.close(); });
    d.addEventListener("close", function(){ delete d.dataset.dirty; });
  });

  M.on("change", function(source){
    // 체크는 기록된 사실이라 루틴 · 가격이 바뀌어도 다시 계산하지 않음
    render(source);
  });
  window.addEventListener("hashchange", route);

  // 다른 탭에서 바뀐 계산기 읽기. 여기서 입력 중이면 다시 그리다 타이핑이 날아가므로, 포커스가 계산기 화면
  // 밖으로 나갈 때까지 미룸 (칸 사이 Tab 이동에는 안 풀림 — sync 와 같은 규칙)
  var calcWaiting = false;
  function calcBusy(){
    var v = $("v-calc"), ae = document.activeElement;
    return !!(v && !v.hidden && ae && v.contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName));
  }
  // 한 틱 뒤에 확인 — focusout 시점엔 아직 activeElement 가 바뀌기 전
  function flushCalc(){
    setTimeout(function(){
      if (!calcWaiting || calcBusy()) return;   // 같은 화면 안에서 칸만 옮긴 것이면 계속 기다림
      calcWaiting = false;
      $("v-calc").removeEventListener("focusout", flushCalc);
      M.calc.reload(); render("calc");
    }, 0);
  }
  function reloadCalc(){
    if (calcWaiting) return;      // 이미 기다리는 중이면 나중 값까지 한 번에 읽음
    if (!calcBusy()){ M.calc.reload(); render("calc"); return; }
    calcWaiting = true;
    $("v-calc").addEventListener("focusout", flushCalc);
  }

  // 다른 탭에서 바꾼 장부 · 캐릭터 · 계산기 · 테마를 따라감
  window.addEventListener("storage", function(e){
    if (e.key === M.KEYS.ledger){ M.ledger.reload(); render(); }
    if (e.key === M.KEYS.chars){ M.chars.load(); render(); }
    if (e.key === M.KEYS.prices){
      M.bosses.reloadPrices(); render();
      // 여기서 가격을 입력 중이면 목록을 다시 그리지 않음 — 포커스가 날아감
      var ae = document.activeElement;
      renderPrices(!(ae && $("price-list").contains(ae) && ae !== $("price-list")));
    }
    if (e.key === M.KEYS.calc) reloadCalc();
    if (e.key === M.KEYS.theme){ M.applyTheme(); if (cur === "settings") renderSettings(); }
  });
  if (window.matchMedia) matchMedia("(prefers-color-scheme: light)").addEventListener("change", M.applyTheme);

  // 그래프는 실제 픽셀 폭으로 그려서 폭이 바뀌면 다시
  var resizeTimer = null, lastW = window.innerWidth;
  window.addEventListener("resize", function(){
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function(){ if (cur === "calc" || (cur === "ledger" && curSub === "stats")) render(); }, 150);
  });

  /* ---------- 시작 ---------- */
  M.applyTheme();
  route();

  // 오프라인 캐시. file:// 로 열었을 땐 서비스 워커가 안 되므로 건너뜀
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)){
    window.addEventListener("load", function(){ navigator.serviceWorker.register("./sw.js").catch(function(){}); });
  }
})(Meso);
