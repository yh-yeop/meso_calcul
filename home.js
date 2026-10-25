/* 홈 — 잔고 · 이번 달, 목표 진행도, 이번 주 보스 체크, 최근 기록, 처음 쓰는 사람용 체크리스트.
   보스 체크는 따로 저장하지 않는다. 체크 = 장부에 src:"chk:…" 기록을 넣는 것이라 장부가 곧 상태. */
Meso.home = (function(M){
  "use strict";

  var $ = M.$, esc = M.esc, fmtEok = M.fmtEok, fmtFine = M.fmtFine, fmtSigned = M.fmtSigned, fmtMan = M.fmtMan;
  var md = M.md, toISO = M.toISO, addDays = M.addDays, signCls = M.signCls;
  var CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function weekKey(){ return toISO(M.weekStart(M.today())); }
  function monthKey(){ return toISO(M.today()).slice(0, 7); }
  function srcFor(kind, c){ return "chk:" + kind + ":" + (kind === "w" ? weekKey() : monthKey()) + ":" + c.id; }

  // 체크로 넣은 기록, 아니면 손으로 넣은 같은 캐릭터 · 같은 기간의 보스 기록
  function bossState(kind, c){
    var src = srcFor(kind, c), e = M.ledger.findBySrc(src);
    if (e) return {on:true, e:e, manual:false};
    var cat = kind === "w" ? "weekly" : "monthly";
    var from = kind === "w" ? weekKey() : monthKey() + "-01", to = kind === "w" ? toISO(addDays(M.weekStart(M.today()), 6)) : monthKey() + "-31";
    var hit = M.ledger.entries().filter(function(x){ return x.t === "in" && x.c === cat && x.ch === c.name && x.d >= from && x.d <= to; })[0];
    return hit ? {on:true, e:hit, manual:true} : {on:false};
  }

  function bossRows(kind, list){
    return list.map(function(c){
      var s = bossState(kind, c), v = kind === "w" ? c.weekly : c.monthly;
      var amt = s.on ? s.e.a : v;
      return '<button class="boss" role="checkbox" aria-checked="' + s.on + '" data-kind="' + kind + '" data-cid="' + c.id + '"' +
             (s.manual ? ' disabled title="장부에 직접 적은 기록이 있음"' : '') + '>' +
             '<span class="box">' + CHECK + '</span>' +
             '<span class="main"><span class="t1">' + esc(c.name) + '</span>' +
             (s.manual ? '<span class="t2">장부에 직접 기록됨</span>' : s.on ? '<span class="t2">' + md(M.parseDate(s.e.d)) + ' 기록</span>' : '') + '</span>' +
             '<span class="amt ' + (s.on ? 'pos' : 'dim') + '">' + (s.on ? '+' : '') + fmtFine(amt) + '</span></button>';
    }).join("");
  }

  function renderBoss(){
    var chars = M.chars.all(), wk = chars.filter(function(c){ return c.weekly > 0; }), mo = chars.filter(function(c){ return c.monthly > 0; });
    var box = $("h-boss"), ws = M.weekStart(M.today());
    if (!chars.length){
      $("h-boss-sub").textContent = "";
      box.innerHTML = '<div class="empty">캐릭터를 등록하면 주마다 보스 돈 캐릭터를 체크해서 바로 장부에 넣을 수 있음.' +
        '<div><a class="btn primary" href="#chars">캐릭터 등록</a></div></div>';
      return;
    }
    if (!wk.length && !mo.length){
      $("h-boss-sub").textContent = "";
      box.innerHTML = '<div class="empty">캐릭터에 주간 · 월간보스 수익을 넣으면 여기 체크 목록이 생김.<div><a class="btn" href="#chars">수익 넣기</a></div></div>';
      return;
    }
    var done = 0, got = 0;
    wk.forEach(function(c){ var s = bossState("w", c); if (s.on){ done++; got += s.e.a; } });
    $("h-boss-sub").textContent = md(ws) + "~" + md(addDays(ws, 6)) + " · " + done + "/" + wk.length + (got ? " · +" + fmtEok(got) : "");
    var h = bossRows("w", wk);
    if (mo.length) h += '<div class="boss-h">' + (M.today().getMonth() + 1) + '월 월간보스</div>' + bossRows("m", mo);
    box.innerHTML = h;
  }

  function toggleBoss(kind, id){
    var c = M.chars.get(id);
    if (!c) return;
    var s = bossState(kind, c), label = c.name + (kind === "w" ? " 주보 " : " 월보 ");
    if (s.on){
      if (s.manual) return;
      var undo = M.ledger.removeEntry(s.e.id, true);
      M.toast(label + "체크 해제 (장부에서 뺌)", undo);
    } else {
      var v = kind === "w" ? c.weekly : c.monthly;
      var undoAdd = M.ledger.addEntry({t:"in", c: kind === "w" ? "weekly" : "monthly", a:v, ch:c.name, src:srcFor(kind, c)});
      M.toast(label + "+" + fmtFine(v) + " 장부에 기록함", undoAdd);
    }
  }

  function renderGoal(L, ws, cfg){
    var g = M.ledger.goalInfo(L, ws, cfg), box = $("h-goal");
    if (!g){
      box.innerHTML = '<div class="note">계산기에서 목표 메소를 정하면 진행도가 나옴.</div>';
      return;
    }
    var pct = L.first ? Math.max(0, Math.min(1, L.bal / g.goal)) : 0;
    var eta = g.state === "eta" ? M.mdLong(g.eta) : g.state === "done" ? "달성" : "—";
    var diff = g.diff === undefined ? "" : g.diff === 0 ? "계획과 같음"
             : g.diff > 0 ? '<b class="neg">계획보다 ' + g.diff + '일 늦음</b>' : '<b class="pos">계획보다 ' + (-g.diff) + '일 빠름</b>';
    box.innerHTML =
      '<div class="income"><div><div class="lbl">' + fmtEok(g.goal) + ' 중</div><b class="gold" style="font-size:22px">' +
        (L.first ? fmtEok(L.bal) : "—") + '</b> <span class="dim">' + Math.round(pct * 100) + '%</span></div>' +
        '<div style="text-align:right"><div class="lbl">실측 페이스 도달</div><b style="font-size:18px" class="' + (g.state === "stall" ? "neg" : "pos") + '">' + eta + '</b></div></div>' +
      '<div class="meter"><div class="fl goal" style="width:' + (pct * 100).toFixed(1) + '%"></div></div>' +
      '<div class="bud-status">' + (g.state === "nodata" ? "장부에 잔고를 넣으면 실제 페이스로 계산함" :
        g.state === "stall" ? "최근 순수익이 0 이하라 이 페이스론 못 닿음" :
        g.state === "done" ? "목표보다 " + fmtEok(-g.left) + " 많음" :
        "남은 " + fmtEok(g.left) + " · " + g.days + "일 뒤" + (diff ? " · " + diff : "")) +
        (g.planD ? '<br>계산기 계획 도달 ' + M.mdLong(g.planD) : '') + '</div>';
  }

  function renderOnboard(L){
    var steps = [
      {done: M.chars.all().length > 0, text:"캐릭터 등록 — 보스 수익까지", href:"#chars"},
      {done: L.rows.some(function(r){ return r.e.t === "bal"; }), text:"지금 가진 메소 넣기", open:"bal"},
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
      $("h-sub").textContent = "아직 기록 없음 · 아래 기록 버튼으로 지금 잔고부터";
    } else {
      $("h-bal").textContent = fmtMan(M.round(L.bal, 1));
      var lb = L.lastBal, sub = md(M.parseDate(L.last)) + " 기록까지";
      if (lb){
        sub += " · 마지막 확인 " + md(M.parseDate(lb.e.d));
        if (!lb.open && Math.abs(lb.adj) >= 1e-4) sub += " (미기록 <b>" + fmtSigned(lb.adj) + "</b>)";
      }
      $("h-sub").innerHTML = sub;
    }
    var t = M.today(), m = M.ledger.monthSum(L), net = m.inc - m.out, bud = M.ledger.budgetTotal(), pills = [];
    pills.push({href:"#ledger/stats", k:(t.getMonth() + 1) + "월 순수익", v:(m.inc || m.out) ? fmtSigned(net) : "—", cls:signCls(net)});
    pills.push({href:"#ledger", k:(t.getMonth() + 1) + "월 지출", v:fmtEok(m.out), cls:m.out ? "neg" : "dim"});
    if (bud > 0){
      var left = bud - m.out;
      pills.push({href:"#ledger/budget", k:"예산", v:left >= 0 ? fmtEok(left) + " 남음" : fmtEok(-left) + " 초과", cls:left >= 0 ? "" : "neg"});
    } else {
      pills.push({href:"#ledger/budget", k:"예산", v:"정하기 →", cls:"dim"});
    }
    $("h-pills").innerHTML = pills.map(function(p){
      return '<a class="pill" href="' + p.href + '"><small>' + esc(p.k) + '</small><b class="' + p.cls + '">' + p.v + '</b></a>';
    }).join("");

    renderGoal(L, ws, cfg);
    renderBoss();

    var recent = M.ledger.recentRows(L, 5);
    $("h-recent").innerHTML = recent.length ? recent.map(M.ledger.entryRow).join("")
      : '<div class="empty">아직 기록 없음<div><button class="btn primary" data-open="bal">지금 잔고 넣기</button></div></div>';
  }

  /* ---------- events ---------- */
  $("h-boss").addEventListener("click", function(e){
    var b = e.target.closest("[data-cid]");
    if (b && !b.disabled) toggleBoss(b.dataset.kind, b.dataset.cid);
  });
  $("v-home").addEventListener("click", function(e){
    var open = e.target.closest("[data-open]");
    if (open){ M.ledger.openSheet({t:open.dataset.open}); return; }
    var row = e.target.closest("#h-recent [data-id]");
    if (row) M.ledger.openSheet({id:+row.dataset.id});
  });

  return {render:render};
})(Meso);
