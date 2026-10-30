/* 홈 — 잔고 · 이번 달, 목표 진행도, 이번 주 보스 체크, 최근 기록, 처음 쓰는 사람용 체크리스트.
   보스 체크는 따로 저장하지 않는다. 캐릭터 × 주(월)마다 장부 기록 1건(src:"chk:…")이 곧 상태이고,
   그 기록의 x.b 에 체크한 보스 [id, 난이도, 인원, 금액] 목록이 들어 있음.
   체크한 보스는 사실 기록이라 이후 루틴 · 파티 · 가격이 바뀌어도 저장된 값을 다시 쓰지 않음 (새로 체크하는 보스만 현재 값). */
Meso.home = (function(M){
  "use strict";

  var $ = M.$, esc = M.esc, fmtEok = M.fmtEok, fmtFine = M.fmtFine, fmtSigned = M.fmtSigned;
  var md = M.md, toISO = M.toISO, addDays = M.addDays, signCls = M.signCls;
  var CHECK = '<svg viewBox="0 0 24 24"><path class="ck" d="M5 12.5l4.5 4.5L19 7.5"/><path class="mx" d="M6 12h12"/></svg>';
  var CHEV = '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';
  var opened = {};   // 펼친 캐릭터 "w:id"

  function weekFrom(){ return toISO(M.weekStart(M.today())); }
  function monthKey(){ return toISO(M.today()).slice(0, 7); }
  function srcFor(kind, c){ return "chk:" + kind + ":" + (kind === "w" ? weekFrom() : monthKey()) + ":" + c.id; }
  function routineOf(kind, c){ return (kind === "w" ? c.bosses : c.mbosses) || []; }
  function fullOf(kind, c){ return kind === "w" ? M.chars.weekly(c) : M.chars.monthly(c); }

  // 같은 캐릭터 이름 · 같은 기간의 보스 수입 중 이 캐릭터의 체크 기록이 아닌 것 (직접 적은 것, 지운 캐릭터가 남긴 체크 기록 포함)
  function manualEntry(kind, c){
    var cat = kind === "w" ? "weekly" : "monthly";
    var from = kind === "w" ? weekFrom() : monthKey() + "-01";
    var to = kind === "w" ? toISO(addDays(M.weekStart(M.today()), 6)) : monthKey() + "-31", own = srcFor(kind, c);
    return M.ledger.entries().filter(function(x){
      return x.t === "in" && x.c === cat && x.ch === c.name && x.d >= from && x.d <= to && x.src !== own;
    })[0] || null;
  }

  function bossState(kind, c){
    var routine = routineOf(kind, c), e = M.ledger.findBySrc(srcFor(kind, c)), done = {}, rec = {};
    if (!e){
      var man = manualEntry(kind, c);
      if (man) return {routine:routine, e:man, manual:true, done:done, rec:rec, extra:[], n:0};
    }
    if (e){
      // 보스 목록 없는 기록(루틴 없을 때 통째로 넣은 것, 예전 방식)은 어떤 보스인지 모름 — 루틴이 생겼으면 통째 기록으로만 보여줌
      if (e.x && Array.isArray(e.x.b)) e.x.b.forEach(function(r){ done[r[0]] = true; rec[r[0]] = r; });
      else if (routine.length) return {routine:routine, e:e, manual:false, lump:true, done:done, rec:rec, extra:[], n:0};
    }
    // 이미 잡은 보스는 사실이라 루틴에서 빼도 이번 기간 기록에 남김 (extra = 저장된 행 그대로). n 은 루틴 보스만 셈
    var extra = e && e.x && Array.isArray(e.x.b) ? e.x.b.filter(function(r){
      return !routine.some(function(q){ return q.id === r[0]; });
    }) : [];
    var n = routine.filter(function(r){ return done[r.id]; }).length;
    return {routine:routine, e:e, manual:false, done:done, rec:rec, extra:extra, n:n};
  }

  // 보스별 표시 행. 체크한 보스는 저장된 값(난이도 · 인원 · 금액) 그대로, 안 한 루틴 보스는 현재 루틴 값
  function bossRows(kind, s){
    return s.routine.map(function(r){
      var q = s.rec[r.id];
      return q ? {id:q[0], d:q[1], p:q[2], amt:q[3], on:true}
        : {id:r.id, d:r.d, p:r.p, amt:M.bosses.share(kind, r), on:false};
    }).concat(s.extra.map(function(q){ return {id:q[0], d:q[1], p:q[2], amt:q[3], on:true, extra:true}; }));
  }

  // 체크한 보스 목록으로 장부 기록을 맞춤. 이미 체크돼 있던 행은 저장값 그대로, 새로 체크한 루틴 보스만 현재 값
  function checkList(kind, s, done){
    return s.routine.filter(function(r){ return done[r.id]; }).map(function(r){
      var q = s.rec[r.id];
      return q ? q.slice() : [r.id, r.d, r.p, M.round(M.bosses.share(kind, r), 6)];
    }).concat(s.extra.filter(function(r){ return done[r[0]]; }).map(function(r){ return r.slice(); }));
  }
  // 루틴 없는 캐릭터는 all 로 통째
  function writeCheck(kind, c, s, done, all){
    var src = srcFor(kind, c), cat = kind === "w" ? "weekly" : "monthly";
    if (!s.routine.length){
      return M.ledger.setCheck(src, all ? {d:toISO(M.today()), t:"in", c:cat, ch:c.name, a:fullOf(kind, c)} : null);
    }
    var list = checkList(kind, s, done);
    if (!list.length) return M.ledger.setCheck(src, null);
    var sum = 0, names = list.map(function(r){ sum += r[3]; return M.bosses.short(kind, {id:r[0], d:r[1]}); });
    var memo = names.length > 3 ? names.slice(0, 3).join(" · ") + " 외 " + (names.length - 3) : names.join(" · ");
    return M.ledger.setCheck(src, {d:toISO(M.today()), t:"in", c:cat, ch:c.name, a:sum, m:memo, x:{b:list}});
  }

  function charRows(kind, list){
    return list.map(function(c){
      var s = bossState(kind, c), full = fullOf(kind, c), key = kind + ":" + c.id, has = s.routine.length > 0;
      var got = s.e ? s.e.a : 0;
      var check = s.manual || s.lump ? "true" : !s.e ? "false" : has && s.n < s.routine.length ? "mixed" : "true";
      var sub = s.manual ? "장부에 직접 기록됨 (지우면 체크 가능)"
              : s.lump ? "통째로 기록됨, " + fmtFine(got)
              : has ? s.n + "/" + s.routine.length + ", " + (got > 0 ? fmtFine(got) : "0") + " / " + fmtFine(full)
              : s.e ? md(M.parseDate(s.e.d)) + " 기록" : "";
      var h = '<div class="bgrp">' +
        '<div class="brow2"><button class="boss" role="checkbox" aria-checked="' + check + '" data-kind="' + kind + '" data-cid="' + c.id + '"' +
          (s.manual ? ' disabled title="장부에 직접 적은 기록이 있음"' : '') + '>' +
          '<span class="box">' + CHECK + '</span>' +
          '<span class="main"><span class="t1">' + esc(c.name) + '</span>' + (sub ? '<span class="t2">' + sub + '</span>' : '') + '</span>' +
          '<span class="amt ' + (s.e ? 'pos' : 'dim') + '">' + (s.e ? '+' + fmtFine(got) : fmtFine(full)) + '</span></button>' +
          (has && !s.manual ? '<button class="exp" data-exp="' + key + '" aria-expanded="' + !!opened[key] + '" aria-label="보스별 보기" aria-controls="bsub-' + key.replace(":", "-") + '">' + CHEV + '</button>' : '') +
        '</div>';
      if (has && !s.manual && opened[key]){
        h += '<div class="bsub" id="bsub-' + key.replace(":", "-") + '">' + (s.lump ? '<div class="note">캐릭터 체크를 풀면 보스별로 기록 가능</div>' : '') +
          bossRows(kind, s).map(function(r){
            return '<button class="boss sm" role="checkbox" aria-checked="' + r.on + '" data-kind="' + kind + '" data-cid="' + c.id + '" data-b="' + esc(r.id) + '"' +
              (s.lump ? ' disabled' : '') + '>' +
              '<span class="box">' + CHECK + '</span>' +
              '<span class="main"><span class="t1">' + esc(M.bosses.label(kind, r)) + '</span>' +
              (r.extra ? '<span class="t2">루틴에서 뺀 보스 · 이번 기록</span>' : r.p > 1 ? '<span class="t2">' + r.p + '인 파티</span>' : '') + '</span>' +
              '<span class="amt ' + (r.on ? 'pos' : 'dim') + '">' + fmtFine(r.amt) + '</span></button>';
          }).join("") + '</div>';
      }
      return h + '</div>';
    }).join("");
  }

  function renderBoss(){
    var chars = M.chars.all();
    var wk = chars.filter(function(c){ return M.chars.weekly(c) > 0; });
    var mo = chars.filter(function(c){ return M.chars.monthly(c) > 0; });
    var box = $("h-boss"), ws = M.weekStart(M.today());
    if (!chars.length){
      $("h-boss-sub").textContent = "";
      box.innerHTML = '<div class="empty">캐릭터와 도는 보스를 등록하면 주마다 잡은 보스를 체크해서 장부에 넣을 수 있음.' +
        '<div><a class="btn primary" href="#chars">캐릭터 등록</a></div></div>';
      return;
    }
    if (!wk.length && !mo.length){
      $("h-boss-sub").textContent = "";
      box.innerHTML = '<div class="empty">캐릭터에 도는 보스를 정하면 여기 체크 목록이 생김.<div><a class="btn" href="#chars">보스 설정</a></div></div>';
      return;
    }
    // 보스 단위로 센 진행도 (루틴 없는 캐릭터는 1개로)
    var done = 0, total = 0, got = 0;
    wk.forEach(function(c){
      var s = bossState("w", c), n = s.routine.length || 1, ex = s.routine.length && !s.manual && !s.lump ? s.extra.length : 0;
      total += n + ex;
      done += s.manual || s.lump ? n : s.routine.length ? s.n + ex : (s.e ? 1 : 0);
      if (s.e) got += s.e.a;
    });
    $("h-boss-sub").textContent = done + "/" + total + (got ? ", +" + fmtFine(got) : "");
    var h = charRows("w", wk);
    if (mo.length) h += '<div class="boss-h">' + (M.today().getMonth() + 1) + '월 월간보스</div>' + charRows("m", mo);
    box.innerHTML = h;
  }

  function toggle(kind, id, bossId){
    var c = M.chars.get(id);
    if (!c) return;
    var s = bossState(kind, c);
    // 직접 적은 기록 · 통째 기록은 보스별 상태를 모르니 보스 하나로 덮어쓰지 않음 (lump 는 캐릭터 체크박스로 해제만)
    if (s.manual || (s.lump && bossId)) return;
    var done = {}, label, undo;
    Object.keys(s.done).forEach(function(k){ done[k] = true; });
    if (bossId){
      var r = bossRows(kind, s).filter(function(x){ return x.id === bossId; })[0];
      if (!r) return;
      if (done[bossId]) delete done[bossId]; else done[bossId] = true;
      undo = writeCheck(kind, c, s, done, false);
      label = c.name + ": " + M.bosses.label(kind, r) + (done[bossId] ? " 체크" : " 해제");
    } else {
      // 캐릭터 체크박스: 루틴이 다 됐으면 기록째 해제, 아니면 안 한 루틴 보스만 현재 값으로 추가 (기존 행 · 뺀 보스는 기록 그대로)
      var all = s.lump ? false : !(s.e && (!s.routine.length || s.n === s.routine.length));
      if (all) s.routine.forEach(function(x){ done[x.id] = true; });
      else done = {};
      undo = writeCheck(kind, c, s, done, all);
      label = c.name + (kind === "w" ? " 주간보스 " : " 월간보스 ") + (all ? "전부 체크" : "체크 해제");
    }
    var e = M.ledger.findBySrc(srcFor(kind, c));
    M.toast(label + (e ? ", 장부 +" + fmtFine(e.a) : ", 장부에서 뺌"), undo);
  }

  // 기간만 ("3,549일" → "약 9년 9개월")
  function dur(n){ return M.daysText(n).replace(/ 뒤$/, ""); }
  function renderGoal(L, ws, cfg){
    var g = M.ledger.goalInfo(L, ws, cfg), box = $("h-goal");
    if (!g){
      box.innerHTML = '<div class="note">계산기에서 목표 메소를 정하면 진행도가 나옴.</div>';
      return;
    }
    var pct = L.first ? Math.max(0, Math.min(1, L.bal / g.goal)) : 0;
    var eta = g.state === "eta" ? M.mdLong(g.eta) : g.state === "done" ? "달성" : "—";
    var diff = g.diff === undefined ? "" : g.diff === 0 ? "계획과 같음"
             : g.diff > 0 ? '<b class="neg">계획보다 ' + dur(g.diff) + ' 늦음</b>' : '<b class="pos">계획보다 ' + dur(-g.diff) + ' 빠름</b>';
    box.innerHTML =
      '<div class="income"><div><div class="lbl">' + fmtEok(g.goal) + ' 중</div><b class="gold" style="font-size:22px">' +
        (L.first ? fmtEok(L.bal) : "—") + '</b> <span class="dim">' + Math.round(pct * 100) + '%</span></div>' +
        '<div style="text-align:right"><div class="lbl">실측 페이스 도달</div><b style="font-size:18px" class="' + (g.state === "stall" ? "neg" : g.diff > 0 ? "" : "pos") + '">' + eta + '</b></div></div>' +
      '<div class="meter"><div class="fl goal" style="width:' + (pct * 100).toFixed(1) + '%"></div></div>' +
      '<div class="bud-status">' + (g.state === "nodata" ? "장부에 잔고를 넣으면 실제 페이스로 계산함" :
        g.state === "stall" ? "최근 순수익이 0 이하라 이 페이스론 못 닿음" :
        g.state === "done" ? "목표보다 " + fmtEok(-g.left) + " 많음" :
        "남은 " + fmtEok(g.left) + ", " + M.daysText(g.days) + (diff ? ", " + diff : "")) +
        (g.planD ? '<br>계산기 계획 도달 ' + M.mdLong(g.planD) : '') + '</div>';
  }

  function renderOnboard(L){
    var steps = [
      {done: M.chars.all().length > 0, text:"캐릭터와 도는 보스 등록", href:"#chars"},
      {done: L.rows.some(function(r){ return r.e.t === "bal"; }), text:"잔고 넣기", open:"bal"},
      {done: !!M.read(M.KEYS.calc), text:"계산기에서 목표 메소 정하기", href:"#calc"}
    ];
    var all = steps.every(function(s){ return s.done; });
    $("h-onboard").hidden = all;
    if (all) return;
    $("h-steps").innerHTML = steps.map(function(s){
      var act = s.done ? "" : s.open ? '<button class="btn sm" data-open="' + s.open + '">하기</button>' : '<a class="btn sm" href="' + s.href + '">하기</a>';
      return '<li class="' + (s.done ? "done" : "") + '"><span>' + s.text + '</span>' + act + '</li>';
    }).join("");
  }

  function render(){
    var L = M.ledger.compute(), ws = M.ledger.windowStats(L), cfg = M.calc.cfg();
    renderOnboard(L);

    if (!L.first){
      $("h-bal").textContent = "—";
      $("h-sub").textContent = "기록 없음. 오른쪽 아래 + 기록으로 잔고 넣기";
    } else {
      $("h-bal").textContent = fmtEok(L.bal);
      var lb = L.lastBal, sub = md(M.parseDate(L.last)) + " 기록까지";
      if (lb){
        sub += ", 마지막 확인 " + md(M.parseDate(lb.e.d));
        if (!lb.open && Math.abs(lb.adj) >= 1e-4) sub += " (기록 밖 <b>" + fmtSigned(lb.adj) + "</b>)";
      }
      $("h-sub").innerHTML = sub;
    }
    var t = M.today(), m = M.ledger.monthSum(L), net = m.inc - m.out, bud = M.ledger.budgetTotal(), pills = [];
    pills.push({href:"#ledger/stats", k:(t.getMonth() + 1) + "월 순수익", v:(m.inc || m.out) ? fmtSigned(net) : "—", cls:signCls(net)});
    pills.push({href:"#ledger", k:(t.getMonth() + 1) + "월 지출", v:fmtEok(m.out), cls:m.out ? "neg" : "dim"});
    if (bud > 0){
      var left = bud - m.out;
      pills.push({href:"#ledger/budget", k:left >= 0 ? "예산 남음" : "예산 초과", v:fmtEok(Math.abs(left)), cls:left >= 0 ? "" : "neg"});
    } else {
      pills.push({href:"#ledger/budget", k:"예산", v:"정하기", cls:"dim"});
    }
    $("h-pills").innerHTML = pills.map(function(p){
      return '<a class="pill" href="' + p.href + '"><small>' + esc(p.k) + '</small><b class="' + p.cls + '">' + p.v + '</b></a>';
    }).join("");

    renderGoal(L, ws, cfg);
    renderBoss();

    var recent = M.ledger.recentRows(L, 5);
    $("h-recent").innerHTML = recent.length ? recent.map(M.ledger.entryRow).join("")
      : '<div class="empty">아직 기록 없음<div><button class="btn primary" data-open="bal">잔고 넣기</button></div></div>';
  }

  /* ---------- events ---------- */
  $("h-boss").addEventListener("click", function(e){
    var ex = e.target.closest("[data-exp]");
    if (ex){ opened[ex.dataset.exp] = !opened[ex.dataset.exp]; renderBoss(); return; }
    var b = e.target.closest("[data-cid]");
    if (b && !b.disabled) toggle(b.dataset.kind, b.dataset.cid, b.dataset.b);
  });
  $("v-home").addEventListener("click", function(e){
    var open = e.target.closest("[data-open]");
    if (open){ M.ledger.openSheet({t:open.dataset.open}); return; }
    var row = e.target.closest("#h-recent [data-id]");
    if (row) M.ledger.openSheet({id:+row.dataset.id});
  });

  return {render:render};
})(Meso);
