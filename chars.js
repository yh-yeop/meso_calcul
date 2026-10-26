/* 캐릭터 — 등록 · 순서 · 본캐, 도는 보스(루틴) 설정, Open API 계정 캐릭터 불러오기, 캐릭터별 실적.
   루틴이 있으면 주보 · 월보는 결정석 가격으로 자동 계산. 계산기 · 장부 · 홈 보스 체크가 전부 여기 값을 씀. */
Meso.charsView = (function(M){
  "use strict";

  var $ = M.$, esc = M.esc, fmtFine = M.fmtFine, fmtEok = M.fmtEok, fmtSigned = M.fmtSigned, fmtMan = M.fmtMan;
  var B = M.bosses;
  var editId = null, bossId = null, apiList = [];
  var bossView = "all", touched = {};   // 보스 시트 보기(고른 보스 / 전체) · 이 시트에서 뺀 보스는 닫을 때까지 목록에 남김

  function initial(name){ return esc(String(name).trim().charAt(0) || "?"); }
  function money(v){ return v > 0 ? fmtFine(v) : "0"; }
  function metaText(c){
    var p = [];
    if (c.world) p.push(esc(c.world));
    if (c.cls) p.push(esc(c.cls));
    if (c.level) p.push("Lv." + c.level);
    return p.join(" · ");
  }
  function routineText(c){
    var n = c.bosses ? c.bosses.length : 0, m = c.mbosses ? c.mbosses.length : 0;
    if (!n && !m) return "보스 미설정";
    return "보스 " + n + "/" + B.data.weeklyLimit + (m ? " · 월간 " + m : "");
  }

  function render(){
    var list = M.chars.all(), tot = M.chars.totals(), box = $("ch-list");
    $("ch-sum").textContent = list.length ? list.length + "명 · 주 " + fmtFine(tot.weekly) + " · 월 " + fmtFine(tot.monthly) : "";
    // 월드당 주 90개 판매 제한
    var wc = M.chars.worldCounts(), over = Object.keys(wc).filter(function(w){ return wc[w] > B.data.worldLimit; });
    $("ch-warn").hidden = !over.length;
    if (over.length) $("ch-warn").innerHTML = over.map(function(w){
      return "<b>" + esc(w) + "</b> 월드 루틴이 주 " + wc[w] + "개 — 월드당 " + B.data.worldLimit + "개까지만 팔 수 있어서 계산보다 덜 받음";
    }).join("<br>");
    if (!list.length){
      box.innerHTML = '<div class="empty"><h4>아직 캐릭터가 없음</h4>도는 보스를 고르면 주 · 월 수익이 자동 계산됨' +
        '<div><button type="button" class="btn" data-add>+ 캐릭터 추가</button></div></div>';
      return;
    }
    box.innerHTML = list.map(function(c){
      var meta = metaText(c), manual = !c.bosses && !c.mbosses && (c.weekly || c.monthly);
      return '<div class="crow">' +
        '<button class="open" data-cid="' + c.id + '">' +
          '<span class="avatar' + (c.main ? ' is-main' : '') + '">' + initial(c.name) + '</span>' +
          '<span class="main"><span class="t1">' + esc(c.name) + (c.main ? '<span class="badge main">본캐</span>' : '') + '</span>' +
          '<span class="t2">' + (manual ? "직접 입력" : routineText(c)) + (meta ? " · " + meta : "") + '</span></span>' +
          '<span class="vals">주 ' + money(M.chars.weekly(c)) + '<small>월 ' + money(M.chars.monthly(c)) + '</small></span>' +
        '</button></div>';
    }).join("");
  }

  /* ---------- 편집 시트 (기존 캐릭터면 실적도) ---------- */
  function statsHtml(c){
    var L = M.ledger.compute(), t = M.toISO(M.today());
    var mon = M.ledger.sumRange(L, t.slice(0, 7) + "-01", t, c.name), all = M.ledger.sumRange(L, null, null, c.name);
    if (!all.n) return '<div class="note">장부에 이 캐릭터로 적은 기록이 아직 없음.</div>';
    var top = Object.keys(all.byIn).sort(function(a, b){ return all.byIn[b] - all.byIn[a]; }).slice(0, 3)
      .map(function(k){ return M.ledger.cat("in", k).n + " " + fmtEok(all.byIn[k]); });
    var recent = M.ledger.recentRows(L, 3, c.name);
    return '<div class="kpis">' +
        '<div class="kpi"><small>이번 달 수입</small><b class="pos">' + fmtEok(mon.inc) + '</b></div>' +
        '<div class="kpi"><small>이번 달 지출</small><b class="neg">' + fmtEok(mon.out) + '</b></div>' +
        '<div class="kpi"><small>전체 순익</small><b class="' + M.signCls(all.inc - all.out) + '">' + fmtSigned(all.inc - all.out) + '</b></div>' +
      '</div>' +
      (top.length ? '<div class="note" style="margin-top:8px">수입 상위: ' + top.join(" · ") + '</div>' : '') +
      '<div class="list" style="margin-top:12px;border:1px solid var(--line-soft);border-radius:12px">' +
        recent.map(M.ledger.entryRow).join("") + '</div>';
  }

  // 루틴이 있으면 주보 · 월보 칸은 자동 계산이라 잠금
  function syncIncomeFields(c){
    var wAuto = !!(c && c.bosses), mAuto = !!(c && c.mbosses);
    $("ch-weekly").disabled = wAuto;
    $("ch-monthly").disabled = mAuto;
    if (wAuto) $("ch-weekly").value = M.round(M.chars.weekly(c), 4);
    if (mAuto) $("ch-monthly").value = M.round(M.chars.monthly(c), 4);
    $("ch-income-note").textContent = wAuto || mAuto
      ? "보스 설정에서 고른 보스로 자동 계산됨" + (wAuto && mAuto ? "" : wAuto ? " (주간)" : " (월간)")
      : "보스를 고르면 결정석 가격으로 자동 계산됨. 지금은 직접 넣은 값";
    $("ch-boss-btn").textContent = c ? "저장하고 보스 설정" : "저장하고 보스 고르기";
  }

  // 순서 바꾸기는 시트 안에서 — 새 캐릭터는 아직 순서가 없어서 숨김, 맨 위 · 맨 아래는 막음
  function syncOrder(){
    var i = editId ? M.chars.all().indexOf(M.chars.get(editId)) : -1;
    $("ch-order").hidden = i < 0;
    $("ch-up").disabled = i <= 0;
    $("ch-down").disabled = i < 0 || i >= M.chars.all().length - 1;
  }
  function moveChar(dir){
    if (!editId) return;
    M.chars.move(editId, dir);
    render();
    syncOrder();
    // 끝에 닿아 눌린 버튼이 잠기면 포커스가 사라지니 반대쪽으로
    var a = $(dir < 0 ? "ch-up" : "ch-down"), b = $(dir < 0 ? "ch-down" : "ch-up");
    if (a.disabled && !b.disabled) b.focus();
  }
  // 이름 오류는 토스트 대신 필드 아래에 (시트 안에서 바로 보이게)
  function setErr(msg){
    $("ch-err").textContent = msg || "";
    $("ch-err").hidden = !msg;
    $("ch-name").setAttribute("aria-invalid", msg ? "true" : "false");
  }

  function openChar(id){
    var c = id ? M.chars.get(id) : null;
    editId = c ? c.id : null;
    $("ch-title").textContent = c ? c.name : "캐릭터 추가";
    $("ch-name").value = c ? c.name : "";
    $("ch-weekly").value = c ? c.weekly || "" : "";
    $("ch-monthly").value = c ? c.monthly || "" : "";
    $("ch-main").checked = c ? c.main : !M.chars.all().length;
    $("ch-meta").innerHTML = c && metaText(c) ? metaText(c) + (c.ocid ? " · Open API 연결됨" : "") : "";
    $("ch-stats").innerHTML = c ? statsHtml(c) : "";
    $("ch-stats").hidden = !c;
    $("ch-del").hidden = !c;
    syncIncomeFields(c);
    syncOrder();
    setErr("");
    delete $("ch-sheet").dataset.dirty;
    if (!$("ch-sheet").open) $("ch-sheet").showModal();
    if (!c && !M.coarse()) $("ch-name").focus();
  }

  var revived = false;   // 마지막 commitChar 가 지워진 캐릭터를 새로 추가했는지
  var GONE_CHAR = "다른 기기에서 지운 캐릭터라 새로 추가함";
  // 저장하고 저장된 캐릭터를 돌려줌 (실패하면 null)
  function commitChar(){
    var name = $("ch-name").value.trim();
    if (!name){ $("ch-name").focus(); return null; }
    var dup = M.chars.byName(name);
    if (dup && dup.id !== editId){ setErr("같은 이름의 캐릭터가 이미 있음"); $("ch-name").focus(); return null; }
    var patch = {name:name, main:$("ch-main").checked};
    if (!$("ch-weekly").disabled) patch.weekly = parseFloat($("ch-weekly").value) || 0;
    if (!$("ch-monthly").disabled) patch.monthly = parseFloat($("ch-monthly").value) || 0;
    var c = editId ? M.chars.update(editId, patch) : null;
    // 시트를 연 사이 다른 기기가 지운 캐릭터면 update 가 null → 새 캐릭터로 추가
    revived = !!editId && !c;
    if (!c) c = M.chars.add(patch);
    editId = c.id;
    delete $("ch-sheet").dataset.dirty;
    return c;
  }

  function saveChar(ev){
    ev.preventDefault();
    var isNew = !editId, c = commitChar();
    if (!c) return;
    $("ch-sheet").close();
    M.toast(revived ? c.name + " — " + GONE_CHAR : c.name + (isNew ? " 추가함" : " 저장함"));
  }

  // 보스 시트를 연 사이 다른 기기가 캐릭터를 지웠으면 더 진행하지 않고 닫음 (c 가 null 이라 TypeError 나는 것 방지)
  function bossChar(){
    var c = M.chars.get(bossId);
    if (!c){
      if ($("boss-sheet").open) $("boss-sheet").close();
      M.toast("다른 기기에서 지운 캐릭터라 보스를 저장 못 함");
    }
    return c;
  }

  function deleteChar(){
    if (!editId) return;
    var r = M.chars.remove(editId);
    delete $("ch-sheet").dataset.dirty;
    $("ch-sheet").close();
    if (r) M.toast(r.c.name + " 삭제함 (장부 기록은 그대로)", function(){ M.chars.restore(r.c, r.i); });
  }

  /* ---------- 보스 시트 ---------- */
  function openBoss(){
    var c = commitChar();
    if (!c) return;
    bossId = c.id;
    touched = {};
    bossView = (c.bosses && c.bosses.length) || (c.mbosses && c.mbosses.length) ? "mine" : "all";
    $("ch-sheet").close();
    var others = M.chars.all().filter(function(o){ return o.id !== c.id && (o.bosses || o.mbosses); });
    $("boss-copy-row").hidden = !others.length;
    $("boss-copy").innerHTML = '<option value="">다른 캐릭터 루틴 복사…</option>' + others.map(function(o){
      return '<option value="' + o.id + '">' + esc(o.name) + ' (' + routineText(o) + ')</option>';
    }).join("");
    renderBossSheet();
    $("boss-sheet").showModal();
    if (revived) M.toast(c.name + " — " + GONE_CHAR);
  }

  function bossRows(kind, routine){
    var cur = {};
    routine.forEach(function(r){ cur[r.id] = r; });
    // 주간 12마리가 차면 새 보스는 못 고르게 (이미 고른 보스의 난이도 변경 · 빼기는 가능)
    var full = kind === "w" && routine.length >= B.data.weeklyLimit;
    // "고른 보스" 보기: 고른 것 + 이 시트에서 뺀 것만 (뺀 행이 바로 사라지면 되돌리기 어려움)
    var rows = B.list(kind).filter(function(b){ return bossView === "all" || cur[b.id] || touched[kind + b.id]; });
    if (!rows.length) return '<div class="note">고른 보스 없음</div>';
    return rows.map(function(b){
      var r = cur[b.id], diffs = Object.keys(b.p), nm = esc(b.n);
      var chips = '<button type="button" class="chip" data-k="' + kind + '" data-b="' + b.id + '" data-d="" aria-pressed="' + !r + '" aria-label="' + nm + ' 안 함">없음</button>' +
        diffs.map(function(d){
          return '<button type="button" class="chip" data-k="' + kind + '" data-b="' + b.id + '" data-d="' + d + '" aria-pressed="' + !!(r && r.d === d) + '" aria-label="' + nm + ' ' + B.data.diffs[d] + '"' + (full && !r ? ' disabled' : '') + '>' +
                 B.data.diffs[d] + '</button>';
        }).join("");
      var party = r ? '<select class="bs-p" data-k="' + kind + '" data-b="' + b.id + '" aria-label="' + esc(b.n) + ' 파티 인원">' +
        [1,2,3,4,5,6].map(function(n){ return '<option value="' + n + '"' + (r.p === n ? ' selected' : '') + '>' + (n === 1 ? "솔로" : n + "인") + '</option>'; }).join("") +
        '</select>' : '';
      return '<div class="bsrow' + (r ? ' on' : '') + '"><div class="hd"><b>' + esc(b.n) + '</b>' +
        (r ? '<span class="pos">' + fmtFine(B.share(kind, r)) + '</span>' + party : '') + '</div>' +
        '<div class="ctl">' + chips + '</div></div>';
    }).join("");
  }

  function renderBossSheet(){
    var c = M.chars.get(bossId);
    if (!c) return;
    var w = c.bosses || [], m = c.mbosses || [], lim = B.data.weeklyLimit;
    $("boss-title").textContent = c.name + " 보스";
    $("boss-sum").innerHTML = '주간 <b class="' + (w.length > lim ? "neg" : "") + '">' + w.length + "/" + lim + '</b> · 주 <b>' +
      fmtFine(M.chars.weekly(c)) + '</b>' + (m.length ? ' · 월 <b>' + fmtFine(M.chars.monthly(c)) + '</b>' : '') +
      (w.length > lim ? '<br><span class="neg">주간 보스는 캐릭터당 ' + lim + '마리까지 — ' + (w.length - lim) + '개 빼야 함</span>'
        : w.length === lim ? '<br>' + lim + '/' + lim + ' · 새 보스는 하나 빼고 고르기' : '');
    var views = {mine: "고른 보스 " + (w.length + m.length), all: "전체 " + (B.list("w").length + B.list("m").length)};
    Array.prototype.forEach.call($("boss-view").querySelectorAll("[data-v]"), function(btn){
      var on = btn.dataset.v === bossView;
      btn.textContent = views[btn.dataset.v];
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", on);
      btn.setAttribute("aria-pressed", on);   // .seg 활성 표시가 aria-pressed 기준
    });
    $("boss-w").innerHTML = bossRows("w", w);
    $("boss-m").innerHTML = bossRows("m", m);
  }

  function setBoss(kind, id, d, p){
    var c = bossChar();
    if (!c) return;
    var list = ((kind === "m" ? c.mbosses : c.bosses) || []).filter(function(r){ return r.id !== id; });
    var prev = ((kind === "m" ? c.mbosses : c.bosses) || []).filter(function(r){ return r.id === id; })[0];
    if (d) list.push({id:id, d:d, p:p || (prev ? prev.p : 1)});
    else if (prev) touched[kind + id] = true;
    // 다시 그리면 포커스가 사라져서 키보드 · 스크린리더 사용자가 길을 잃음 — 같은 컨트롤에 돌려놓음
    var ae = document.activeElement, sel = null;
    if (ae && ae.dataset && $("boss-sheet").contains(ae) && ae.dataset.b != null){
      sel = ae.matches("select.bs-p")
        ? 'select.bs-p[data-k="' + ae.dataset.k + '"][data-b="' + ae.dataset.b + '"]'
        : '[data-k="' + ae.dataset.k + '"][data-b="' + ae.dataset.b + '"][data-d="' + ae.dataset.d + '"]';
    }
    M.chars.setRoutine(bossId, kind, list);
    renderBossSheet();
    var next = sel && $("boss-sheet").querySelector(sel);
    if (next) next.focus();
  }

  /* ---------- Open API 불러오기 ---------- */
  function openImport(){
    if (!M.api.key()){
      M.toast("⚙ 설정에서 넥슨 Open API 키를 먼저 넣어줘");
      location.hash = "#settings";
      return;
    }
    apiList = [];
    $("imp-list").innerHTML = "";
    $("imp-ok").disabled = true;
    $("imp-msg").textContent = "계정 캐릭터 불러오는 중…";
    $("imp-sheet").showModal();
    M.api.characterList().then(function(list){
      apiList = list.slice().sort(function(a, b){ return (b.character_level || 0) - (a.character_level || 0); });
      if (!apiList.length){ $("imp-msg").textContent = "이 키의 계정에 캐릭터가 없음."; return; }
      $("imp-msg").textContent = "보스 도는 캐릭터만 골라. 이미 등록된 이름은 월드 · 직업 · 레벨만 채움.";
      $("imp-list").innerHTML = apiList.map(function(a, i){
        var have = !!M.chars.byName(a.character_name);
        return '<label class="pick"><input type="checkbox" data-i="' + i + '"' + (have ? ' checked' : '') + '>' +
          '<span class="main"><b>' + esc(a.character_name) + '</b>' + (have ? ' <span class="badge">등록됨</span>' : '') +
          '<small>' + esc(a.world_name || "") + ' · ' + esc(a.character_class || "") + ' · Lv.' + (a.character_level || "?") + '</small></span></label>';
      }).join("");
      syncImportBtn();
    }, function(err){
      $("imp-msg").innerHTML = '<span class="neg">불러오기 실패: ' + esc(err.message) + '</span>';
    });
  }
  function syncImportBtn(){
    var n = $("imp-list").querySelectorAll("input:checked").length;
    $("imp-ok").disabled = !n;
    $("imp-ok").textContent = n ? n + "명 불러오기" : "불러오기";
  }
  function doImport(ev){
    ev.preventDefault();
    var picked = Array.prototype.map.call($("imp-list").querySelectorAll("input:checked"), function(i){ return apiList[+i.dataset.i]; });
    if (!picked.length) return;
    var r = M.chars.mergeApi(picked);
    $("imp-sheet").close();
    M.toast("추가 " + r.added + " · 정보 갱신 " + r.updated + (r.added ? " — 캐릭터를 눌러 도는 보스를 골라줘" : ""));
  }

  /* ---------- events ---------- */
  $("ch-list").addEventListener("click", function(e){
    var open = e.target.closest("[data-cid]");
    if (open) openChar(open.dataset.cid);
    else if (e.target.closest("[data-add]")) openChar(null);
  });
  $("ch-add").addEventListener("click", function(){ openChar(null); });
  $("ch-form").addEventListener("submit", saveChar);
  $("ch-del").addEventListener("click", deleteChar);
  $("ch-up").addEventListener("click", function(){ moveChar(-1); });
  $("ch-down").addEventListener("click", function(){ moveChar(1); });
  // 입력이 바뀐 시트는 배경 탭으로 안 닫히게 표시 (app.js 가 확인), 이름을 고치면 중복 오류는 걷음
  function markDirty(e){
    $("ch-sheet").dataset.dirty = "1";
    if (e.target.id === "ch-name") setErr("");
  }
  $("ch-form").addEventListener("input", markDirty);
  $("ch-form").addEventListener("change", markDirty);
  $("ch-boss-btn").addEventListener("click", openBoss);
  // 실적 안의 최근 기록을 누르면 장부 기록 수정으로
  $("ch-stats").addEventListener("click", function(e){
    var row = e.target.closest("[data-id]");
    if (!row) return;
    $("ch-sheet").close();
    M.ledger.openSheet({id:+row.dataset.id});
  });

  $("boss-sheet").addEventListener("click", function(e){
    var chip = e.target.closest("[data-b][data-d]");
    if (chip) setBoss(chip.dataset.k, chip.dataset.b, chip.dataset.d);
  });
  $("boss-view").addEventListener("click", function(e){
    var b = e.target.closest("[data-v]");
    if (!b || b.dataset.v === bossView) return;
    bossView = b.dataset.v;
    renderBossSheet();
    var next = $("boss-view").querySelector('[data-v="' + bossView + '"]');
    if (next) next.focus();
  });
  $("boss-sheet").addEventListener("change", function(e){
    var sel = e.target.closest("select.bs-p");
    if (!sel) return;
    var c = bossChar(), k = sel.dataset.k;
    if (!c) return;
    var r = ((k === "m" ? c.mbosses : c.bosses) || []).filter(function(x){ return x.id === sel.dataset.b; })[0];
    if (r) setBoss(k, r.id, r.d, +sel.value);
  });
  $("boss-copy-btn").addEventListener("click", function(){
    var from = $("boss-copy").value;
    if (!from) return;
    var c = bossChar(), src = M.chars.get(from);
    if (!c) return;
    if (!src){ M.toast("복사할 캐릭터가 다른 기기에서 지워짐"); return; }
    var before = {w:c.bosses || [], m:c.mbosses || []};
    M.chars.copyRoutine(from, bossId);
    renderBossSheet();
    M.toast(src.name + " 루틴을 복사함", function(){
      M.chars.setRoutine(bossId, "w", before.w);
      M.chars.setRoutine(bossId, "m", before.m);
      if ($("boss-sheet").open) renderBossSheet();
    });
  });
  $("boss-form").addEventListener("submit", function(ev){
    ev.preventDefault();
    $("boss-sheet").close();
    var c = M.chars.get(bossId);
    if (c) M.toast(c.name + " · " + routineText(c) + " · 주 " + fmtFine(M.chars.weekly(c)));
  });

  $("ch-api-btn").addEventListener("click", openImport);
  $("imp-list").addEventListener("change", syncImportBtn);
  $("imp-form").addEventListener("submit", doImport);

  return {render:render, open:openChar};
})(Meso);
