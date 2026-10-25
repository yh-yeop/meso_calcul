/* 캐릭터 — 등록 · 순서 · 본캐, 정산표 붙여넣기(이름으로 병합), Open API 계정 캐릭터 불러오기, 캐릭터별 실적.
   여기 값이 계산기 보스 수입 · 장부 보스 채우기 · 홈 보스 체크의 출처. */
Meso.charsView = (function(M){
  "use strict";

  var C = M.core, $ = M.$, esc = M.esc, fmtFine = M.fmtFine, fmtEok = M.fmtEok, fmtSigned = M.fmtSigned;
  var editId = null, apiList = [];

  function initial(name){ return esc(String(name).trim().charAt(0) || "?"); }
  function metaText(c){
    var p = [];
    if (c.world) p.push(esc(c.world));
    if (c.cls) p.push(esc(c.cls));
    if (c.level) p.push("Lv." + c.level);
    return p.join(" · ");
  }

  function render(){
    var list = M.chars.all(), tot = M.chars.totals(), box = $("ch-list");
    $("ch-sum").textContent = list.length ? list.length + "명 · 주 " + fmtFine(tot.weekly) + " · 월 " + fmtFine(tot.monthly) : "";
    if (!list.length){
      box.innerHTML = '<div class="empty"><h4>아직 캐릭터가 없음</h4>보스 도는 캐릭터와 주간 · 월간 수익을 넣어 두면 계산기 · 장부 · 홈 보스 체크가 전부 이 값을 씀.<br>' +
        'maplescouter 정산표를 붙여넣으면 한 번에 들어감.</div>';
      return;
    }
    box.innerHTML = list.map(function(c, i){
      var meta = metaText(c);
      return '<div class="crow">' +
        '<button class="open" data-cid="' + c.id + '">' +
          '<span class="avatar' + (c.main ? ' is-main' : '') + '">' + initial(c.name) + '</span>' +
          '<span class="main"><span class="t1">' + esc(c.name) + (c.main ? '<span class="badge main">본캐</span>' : '') + '</span>' +
          '<span class="t2">' + (meta || "정보 없음 · 눌러서 수정") + '</span></span>' +
          '<span class="vals">주 ' + fmtFine(c.weekly) + '<small>월 ' + fmtFine(c.monthly) + '</small></span>' +
        '</button>' +
        '<span class="ord">' +
          '<button data-up="' + c.id + '" aria-label="위로"' + (i === 0 ? ' disabled' : '') + '><svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg></button>' +
          '<button data-down="' + c.id + '" aria-label="아래로"' + (i === list.length - 1 ? ' disabled' : '') + '><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>' +
        '</span></div>';
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
    $("ch-sheet").showModal();
    if (!c && !M.coarse()) $("ch-name").focus();
  }

  function saveChar(ev){
    ev.preventDefault();
    var name = $("ch-name").value.trim();
    if (!name){ $("ch-name").focus(); return; }
    var dup = M.chars.byName(name);
    if (dup && dup.id !== editId){ M.toast("같은 이름의 캐릭터가 이미 있음"); $("ch-name").focus(); return; }
    var patch = {name:name, weekly:parseFloat($("ch-weekly").value) || 0, monthly:parseFloat($("ch-monthly").value) || 0,
                 main:$("ch-main").checked};
    if (editId) M.chars.update(editId, patch);
    else M.chars.add(patch);
    $("ch-sheet").close();
    M.toast(name + (editId ? " 저장함" : " 추가함"));
  }

  function deleteChar(){
    if (!editId) return;
    var r = M.chars.remove(editId);
    $("ch-sheet").close();
    if (r) M.toast(r.c.name + " 삭제함 (장부 기록은 그대로)", function(){ M.chars.restore(r.c, r.i); });
  }

  /* ---------- 정산표 붙여넣기 ---------- */
  function onPaste(){
    var msg = $("parsemsg"), txt = $("paste").value;
    if (!txt.trim()){ msg.textContent = ""; msg.className = "parsemsg"; return; }
    var found = C.parsePaste(txt);
    if (!found.length){
      var dg = C.diagnosePaste(txt);
      msg.innerHTML = "캐릭터를 못 찾았음. 캐릭터 목록을 통째로 드래그해서 붙여봐." +
        '<span class="diag">' + esc(dg.summary) + (dg.hints.length ? "<br>" + dg.hints.map(esc).join("<br>") : "") + '</span>';
      msg.className = "parsemsg bad";
      return;
    }
    var r = M.chars.mergeIncome(found);
    msg.textContent = "캐릭터 " + found.length + "개 읽음 — 추가 " + r.added + " · 갱신 " + r.updated;
    msg.className = "parsemsg";
    $("paste").value = "";
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
    M.toast("추가 " + r.added + " · 정보 갱신 " + r.updated + (r.added ? " — 주보 · 월보 수익은 직접 넣거나 정산표로" : ""));
  }

  /* ---------- events ---------- */
  $("ch-list").addEventListener("click", function(e){
    var up = e.target.closest("[data-up]"), down = e.target.closest("[data-down]"), open = e.target.closest("[data-cid]");
    if (up){ M.chars.move(up.dataset.up, -1); return; }
    if (down){ M.chars.move(down.dataset.down, 1); return; }
    if (open) openChar(open.dataset.cid);
  });
  $("ch-add").addEventListener("click", function(){ openChar(null); });
  $("ch-form").addEventListener("submit", saveChar);
  $("ch-del").addEventListener("click", deleteChar);
  // 실적 안의 최근 기록을 누르면 장부 기록 수정으로
  $("ch-stats").addEventListener("click", function(e){
    var row = e.target.closest("[data-id]");
    if (!row) return;
    $("ch-sheet").close();
    M.ledger.openSheet({id:+row.dataset.id});
  });
  $("ch-paste-btn").addEventListener("click", function(){
    var box = $("ch-paste-box"), open = box.hidden;
    box.hidden = !open;
    this.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) $("paste").focus();
  });
  $("paste").addEventListener("input", onPaste);
  $("ch-api-btn").addEventListener("click", openImport);
  $("imp-list").addEventListener("change", syncImportBtn);
  $("imp-form").addEventListener("submit", doImport);

  return {render:render, open:openChar};
})(Meso);
