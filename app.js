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
    render();
  }

  function route(){
    var h = location.hash.replace(/^#/, "");
    var share = h.match(/(?:^|&)s=([A-Za-z0-9\-_]+)/), goal = h.match(/(?:^|&)goal=(\d+(?:\.\d+)?)/);
    if (share){
      history.replaceState(null, "", "#calc");
      var ok = false;
      try{ ok = M.calc.applyShare(JSON.parse(C.b64d(share[1]))); } catch(e){}
      M.toast(ok ? "공유 링크의 계산기 설정과 캐릭터를 불러옴" : "공유 링크를 못 읽음");
      h = "calc";
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
  }
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
  $("file").addEventListener("change", function(){
    var f = this.files[0];
    this.value = "";
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function(){
      var s;
      try{ s = JSON.parse(rd.result); } catch(e){ M.toast("JSON 파일이 아님"); return; }
      // 통합 백업 / 예전 장부 전용 백업 (entries 가 바로 있음) 둘 다 받음
      var full = s && s.app === "meso", ledger = full ? s.ledger : s;
      if (!ledger || !Array.isArray(ledger.entries)){ M.toast("메소 백업 파일이 아님"); return; }
      var what = full ? "장부 · 계산기 · 캐릭터" : "장부";
      if (M.ledger.count() && !confirm("지금 " + what + "를 백업으로 덮어씀 (장부 " + ledger.entries.length + "건). 진행?")) return;
      M.ledger.setState(ledger);
      if (full){
        if (Array.isArray(s.chars)) M.chars.setAll(s.chars);
        if (s.calc) M.calc.setState(s.calc);
        if (s.prices) M.bosses.setOverrides(s.prices);
      }
      M.toast("복원함 — " + what);
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
  function renderPrices(){
    var B = M.bosses, over = B.overrides(), n = Object.keys(over).length;
    $("price-sub").textContent = B.data.version + " 기준" + (n ? " · " + n + "개 고침" : "");
    $("price-reset").hidden = !n;
    if ($("price-list").hidden) return;
    var rows = [];
    [["w", "주간"], ["m", "월간"]].forEach(function(k){
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
    renderPrices();
  });
  $("price-list").addEventListener("change", function(e){
    var i = e.target.closest("input[data-b]");
    if (!i) return;
    var v = i.value.trim() ? M.parseAmount(i.value) : 0;
    if (v === null){ M.toast("가격을 못 읽음 — 예: 5970만, 0.597억, 59,700,000"); return; }
    M.bosses.setPrice(i.dataset.k, i.dataset.b, i.dataset.d, v * 1e8);
    renderPrices();
  });
  $("price-reset").addEventListener("click", function(){
    var before = M.bosses.overrides();
    M.bosses.setOverrides({});
    renderPrices();
    M.toast("결정석 가격을 기본값으로", function(){ M.bosses.setOverrides(before); renderPrices(); });
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
  // 시트 바깥(배경) 클릭으로 닫기
  Array.prototype.forEach.call(document.querySelectorAll("dialog.sheet"), function(d){
    d.addEventListener("click", function(e){ if (e.target === d) d.close(); });
  });

  M.on("change", render);
  window.addEventListener("hashchange", route);

  // 다른 탭에서 바꾼 장부 · 캐릭터 · 테마를 따라감 (계산기 입력은 이 탭 것을 유지)
  window.addEventListener("storage", function(e){
    if (e.key === M.KEYS.ledger){ M.ledger.reload(); render(); }
    if (e.key === M.KEYS.chars){ M.chars.load(); render(); }
    if (e.key === M.KEYS.prices){ M.bosses.reloadPrices(); render(); }
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
