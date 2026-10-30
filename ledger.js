/* 장부 — 기록 · 통계 · 예산, 기록 시트, Open API 잠재 재설정 동기화.
   기록 하나 = {id, d:"YYYY-MM-DD", t:"in"|"out"|"bal", a:억, c?:항목, h?:사냥시간, ch?:캐릭터 이름, m?:메모}
   bal(잔고 확인)은 더하는 값이 아니라 그 시점 잔고를 덮어씀. 기록상 잔고와의 차이가 "미기록"으로 남음.
   src 가 붙은 기록:
     api:… Open API 로 가져온 것 — est(규칙표 추정) · x(근거) · lock(손으로 고침). 같은 src 는 재동기화 때 교체,
           lock 이면 유지, 지운 src 는 api.skip 에 남아 다시 안 들어옴
     chk:… 홈의 보스 체크로 만든 것 — 체크 상태를 이 기록이 있느냐로 판단 */
Meso.ledger = (function(M){
  "use strict";

  var C = M.core, $ = M.$;
  var WINDOW = 28;                      // 실측 페이스를 잡는 기간
  var DAYS_PER_MONTH = C.DAYS_PER_MONTH;
  var parseDate = M.parseDate, toISO = M.toISO, addDays = M.addDays, dayDiff = M.dayDiff, md = M.md, mdLong = M.mdLong;
  var today = M.today, esc = M.esc, fmtEok = M.fmtEok, fmtSigned = M.fmtSigned, fmtMan = M.fmtMan, fmtFine = M.fmtFine;
  var fmtShort = M.fmtShort, round = M.round, signCls = M.signCls, DOW = M.DOW;

  var CATS = {
    "in": [
      {k:"weekly",  n:"주간보스", c:"var(--gold)"},
      {k:"monthly", n:"월간보스", c:"var(--gold-dim)"},
      {k:"hunt",    n:"사냥",     c:"var(--violet)"},
      {k:"sell",    n:"판매",     c:"var(--mint)"},
      {k:"etc",     n:"기타",     c:"var(--faint)"}
    ],
    "out": [
      {k:"sf",  n:"스타포스", c:"var(--gold)"},
      {k:"pot", n:"잠재능력", c:"var(--violet)"},
      {k:"buy", n:"구매",     c:"var(--mint)"},
      {k:"sym", n:"심볼",     c:"var(--rose)"},
      {k:"etc", n:"기타",     c:"var(--faint)"}
    ]
  };
  function cat(t, k){
    var list = CATS[t] || [];
    for (var i = 0; i < list.length; i++) if (list[i].k === k) return list[i];
    // 모르는 키를 이름으로 내보내지 않음 — 화면에 그대로 HTML 로 들어가는 자리라서
    return {k:"etc", n:"기타", c:"var(--faint)"};
  }
  function validCat(t, k){ return (CATS[t] || []).some(function(x){ return x.k === k; }); }
  function isApi(e){ return !!e.src && e.src.indexOf("api:") === 0; }

  var st = {v:1, seq:0, entries:[], budget:{total:0, cats:{}}, api:{last:{}, skip:{}, run:null}};
  // lastT: 마지막으로 쓴 수입/지출 모드 (+ 버튼은 잔고 확인이 아니라 이걸로 열림). unit: 금액 칸 단위 억|만
  var ui = {sub:"log", t:"in", lastT:"in", c:{"in":"hunt", "out":"sf"}, edit:null, month:null, period:"month",
            filter:"all", fresh:null, lastChar:"", budEdit:false, unit:"억"};
  var UNIT_KEY = "meso-amt-unit";

  /* ---------- 저장 ---------- */
  function load(){
    var s = M.read(M.KEYS.ledger);
    if (s && Array.isArray(s.entries)) adopt(s);
  }
  /* 저장값 · 백업 · 어디서 왔든 같은 검사를 거쳐 새 상태를 만듦 (원본은 안 건드림).
     남이 준 백업 파일이 들어올 수 있어서 형식 · 범위 · 화면에 나갈 값을 전부 걸러냄 */
  function num(v, lo, hi){ v = +v; return isFinite(v) && v >= lo && v <= hi ? v : null; }
  function cleanX(x){
    if (!x || typeof x !== "object") return null;
    var o = {};
    if (Array.isArray(x.items)){
      var items = x.items.filter(Array.isArray).slice(0, 20).map(function(it){
        return [String(it[0]).slice(0, 60), num(it[1], 0, 1e6) || 0, num(it[2], 0, 1e7) || 0];
      });
      if (items.length) o.items = items;      // 빈 배열은 남기지 않음 — 빈 근거 모양이 화면 · 홈 로직을 헷갈리게 함
    }
    if (Array.isArray(x.b)){
      var b = x.b.filter(function(r){ return Array.isArray(r) && typeof r[0] === "string"; }).slice(0, 30).map(function(r){
        return [r[0], String(r[1]), Math.max(1, Math.min(6, parseInt(r[2], 10) || 1)), num(r[3], 0, 1e7) || 0];
      });
      if (b.length) o.b = b;                  // 걸러서 비면 b:[] 로 두지 않음 (홈 보스 체크는 b 가 있으면 보스별 기록으로 읽음)
    }
    if (num(x.n, 0, 1e7) !== null) o.n = +x.n;
    if (num(x.unk, 0, 1e7) !== null) o.unk = +x.unk;
    if (x.rules) o.rules = String(x.rules).slice(0, 20);
    return Object.keys(o).length ? o : null;
  }
  function sanitize(s){
    var out = {v:1, seq:0, entries:[], budget:{total:0, cats:{}}, api:{last:{}, skip:{}, run:null}};
    (Array.isArray(s && s.entries) ? s.entries : []).forEach(function(e){
      if (!e || typeof e !== "object" || !(e.t === "in" || e.t === "out" || e.t === "bal")) return;
      if (typeof e.d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.d) || !parseDate(e.d)) return;   // 2026-02-30 같은 날짜도 버림
      var a = num(e.a, -1e7, 1e7);
      if (a === null) return;
      var x = {id: Math.floor(num(e.id, 1, 1e9) || 0), d:e.d, t:e.t, a:a};
      if (e.t !== "bal") x.c = validCat(e.t, e.c) ? e.c : "etc";
      if (num(e.h, 0.01, 24) !== null) x.h = +e.h;
      if (e.ch) x.ch = String(e.ch).slice(0, 40);
      if (e.m) x.m = String(e.m).slice(0, 200);
      if (e.src) x.src = String(e.src).slice(0, 120);
      if (e.est) x.est = true;
      if (e.lock) x.lock = true;
      var xx = cleanX(e.x);
      if (xx) x.x = xx;
      out.entries.push(x);
    });
    // id 가 없거나 겹치면 새로 매김 — 삭제 · 수정이 엉뚱한 기록까지 건드리지 않게
    var seen = {}, maxId = 0;
    out.entries.forEach(function(x){ if (!x.id || seen[x.id]) x.id = 0; else { seen[x.id] = 1; maxId = Math.max(maxId, x.id); } });
    out.entries.forEach(function(x){ if (!x.id) x.id = ++maxId; });
    out.seq = Math.max(maxId, Math.floor(num(s && s.seq, 0, 1e9) || 0));
    var b = s && s.budget || {};
    out.budget.total = num(b.total, 0, 1e7) || 0;
    if (b.cats && typeof b.cats === "object") CATS.out.forEach(function(x){
      var v = num(b.cats[x.k], 0, 1e7);
      if (v > 0) out.budget.cats[x.k] = v;
    });
    var a2 = s && s.api || {};
    if (a2.last && typeof a2.last.pot === "string" && parseDate(a2.last.pot)) out.api.last.pot = a2.last.pot;
    if (a2.skip && typeof a2.skip === "object") Object.keys(a2.skip).forEach(function(k){ if (k.indexOf("api:") === 0) out.api.skip[k] = 1; });
    if (typeof a2.run === "string" && !isNaN(Date.parse(a2.run))) out.api.run = a2.run;
    return out;
  }
  // 복원 전에 몇 건이 버려지는지 알려주기용. 기록은 합쳐지지 않고 버려지기만 하므로 개수 차이가 곧 버린 수
  function inspect(s){
    var state = sanitize(s), n = Array.isArray(s && s.entries) ? s.entries.length : 0;
    return {state: state, dropped: n - state.entries.length};
  }
  function adopt(s){ st = sanitize(s); }
  function save(){ M.write(M.KEYS.ledger, st); }
  function changed(){ save(); M.emit("change", "ledger"); }

  /* ---------- 계산 ---------- */
  function compute(){
    var list = st.entries.slice().sort(function(a, b){ return a.d < b.d ? -1 : a.d > b.d ? 1 : a.id - b.id; });
    var run = 0, any = false, lastBal = null;
    var rows = list.map(function(e){
      var r = {e:e, adj:0, open:false};
      if (e.t === "bal"){
        r.adj = any ? e.a - run : 0;
        r.open = !any;
        run = e.a;
        lastBal = r;
      } else {
        run += e.t === "in" ? e.a : -e.a;
      }
      any = true;
      r.after = run;
      return r;
    });
    return {rows:rows, bal:run, lastBal:lastBal,
            first: rows.length ? rows[0].e.d : null,
            last:  rows.length ? rows[rows.length-1].e.d : null};
  }

  function balAt(L, iso){
    var v = null;
    for (var i = 0; i < L.rows.length && L.rows[i].e.d <= iso; i++) v = L.rows[i].after;
    return v;
  }

  // ch 를 주면 그 캐릭터 기록만 (캐릭터 상세에서 씀)
  function sumRange(L, from, to, ch){
    var s = {inc:0, out:0, adj:0, byIn:{}, byOut:{}, byChar:{}, outs:[], hunt:0, huntH:0, weekly:0, n:0};
    L.rows.forEach(function(r){
      var e = r.e;
      if ((from && e.d < from) || (to && e.d > to)) return;
      if (ch && e.ch !== ch) return;
      if (e.t === "bal"){ s.adj += r.adj; return; }
      var k = e.c || "etc";
      s.n++;
      if (e.t === "in"){
        s.inc += e.a;
        s.byIn[k] = (s.byIn[k] || 0) + e.a;
        if (e.ch) s.byChar[e.ch] = (s.byChar[e.ch] || 0) + e.a;
        if (k === "weekly") s.weekly += e.a;
        if (k === "hunt" && e.h > 0){ s.hunt += e.a; s.huntH += e.h; }
      } else {
        s.out += e.a;
        s.byOut[k] = (s.byOut[k] || 0) + e.a;
        s.outs.push(e);
      }
    });
    return s;
  }

  // 최근 28일(기록이 그보다 짧으면 그 기간) 실측 페이스
  function windowStats(L){
    if (!L.first) return null;
    var end = today(), first = parseDate(L.first);
    if (first > end) return null;
    var from = addDays(end, -(WINDOW - 1));
    if (from < first) from = first;
    var days = dayDiff(from, end) + 1;
    var s = sumRange(L, toISO(from), toISO(end));
    var thu = 0;
    for (var d = from; d <= end; d = addDays(d, 1)) if (d.getDay() === 4) thu++;
    return {days:days, from:from, s:s,
            rate:  s.huntH > 0 ? s.hunt / s.huntH : null,
            hours: s.huntH / days,
            weekly: thu > 0 ? s.weekly / thu : null,
            incDay: s.inc / days, outDay: s.out / days,
            netDay: (s.inc - s.out) / days};
  }

  /* 계산기 계획 — 같은 페이지라 계산기 모듈의 cfg 로 MesoCore 를 직접 돌림 (복제 계산 없음) */
  function planSeries(cfg, to){
    if (!cfg || !cfg.start) return null;
    var n = Math.min(C.MAX_DAYS, dayDiff(cfg.start, to) + 1);
    if (n < 1) return null;
    var daily = C.simulate(cfg, n).daily, out = {};
    for (var i = 0; i < n; i++) out[toISO(addDays(cfg.start, i))] = daily[i];
    return out;
  }
  function planGoalDate(cfg){
    if (!cfg || !cfg.start || !(cfg.goal > 0)) return null;
    var g = C.findGoal(cfg);
    return g.days === 0 ? cfg.start : g.days > 0 ? addDays(cfg.start, g.days - 1) : null;
  }

  // 목표까지: 실측 순수익 페이스로 언제 닿나, 계산기 계획과 며칠 차이인가
  function goalInfo(L, ws, cfg){
    if (!cfg || !(cfg.goal > 0)) return null;
    var g = {goal:cfg.goal, left:cfg.goal - L.bal, planD:planGoalDate(cfg)};
    if (!L.first) g.state = "nodata";
    else if (g.left <= 0) g.state = "done";
    else if (!ws || ws.netDay <= 0) g.state = "stall";
    else {
      g.state = "eta";
      g.days = Math.ceil(g.left / ws.netDay);
      g.eta = addDays(today(), g.days);
      if (g.planD) g.diff = dayDiff(g.planD, g.eta);
    }
    return g;
  }

  function budgetTotal(){
    if (st.budget.total > 0) return st.budget.total;
    var s = 0;
    Object.keys(st.budget.cats).forEach(function(k){ s += st.budget.cats[k]; });
    return s;
  }
  function monthSum(L){ var t = toISO(today()); return sumRange(L, t.slice(0, 7) + "-01", t); }
  function monthPace(){ var t = today(); return t.getDate() / new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate(); }

  /* ---------- 기록 행 (장부 · 홈 · 캐릭터 상세 공용) ---------- */
  function entryRow(r){
    var e = r.e, info, amt, sub = [];
    if (e.t === "bal"){
      info = {n:"잔고 확인", c:"var(--sky)"};
      amt = '<div class="amt">' + fmtMan(e.a) + '<small>' + (r.open ? "시작 잔고" :
            Math.abs(r.adj) >= 1e-4 ? "미기록 " + fmtSigned(r.adj) : "기록과 일치") + '</small></div>';
    } else {
      info = cat(e.t, e.c);
      amt = '<div class="amt ' + (e.t === "in" ? "pos" : "") + '">' + (e.est ? "≈ " : "") +
            (e.t === "in" ? "+" : "−") + fmtMan(e.a) + '</div>';
    }
    if (e.ch) sub.push(esc(e.ch));
    if (e.h > 0) sub.push(e.h + "시간, 시급 " + fmtFine(e.a / e.h));
    if (e.m) sub.push(esc(e.m));
    var badge = isApi(e) ? '<span class="badge' + (e.lock ? ' lock' : '') + '">' + (e.lock ? "직접 고침" : "API") + '</span>' : "";
    var tip = isApi(e) && e.x && e.x.items ? e.x.items.map(function(it){
      return it[0] + "  " + it[1] + "회  " + fmtEok(it[2]);
    }).join("\n") : "";
    return '<button class="ent' + (ui.fresh === e.id ? " fresh" : "") + '" data-id="' + e.id + '"' +
           (tip ? ' title="' + esc(tip) + '"' : '') + '>' +
           '<span class="dot" style="--c:' + info.c + '"></span>' +
           '<span class="main"><span class="t1">' + info.n + badge + '</span>' +
           (sub.length ? '<span class="t2">' + sub.join(", ") + '</span>' : '') + '</span>' + amt + '</button>';
  }
  // 최근 n개 (기록일 → 입력 순 역순)
  function recentRows(L, n, ch){
    var out = [];
    for (var i = L.rows.length - 1; i >= 0 && out.length < n; i--){
      if (!ch || L.rows[i].e.ch === ch) out.push(L.rows[i]);
    }
    return out;
  }

  /* ---------- 기록 탭 ---------- */
  function renderLog(L){
    var p = ui.month.split("-");
    $("m-label").textContent = p[0] + "년 " + (+p[1]) + "월";
    Array.prototype.forEach.call($("filters").children, function(b){
      b.setAttribute("aria-pressed", b.dataset.f === ui.filter ? "true" : "false");
    });
    // 이번 달이 아니면 "이번 달" 로 돌아오는 버튼, 이번 달이면 다음 달(미래)로는 못 감
    var curM = toISO(today()).slice(0, 7);
    if ($("m-today")) $("m-today").hidden = ui.month === curM;
    $("m-next").disabled = ui.month >= curM;
    var monthRows = L.rows.filter(function(r){ return r.e.d.slice(0, 7) === ui.month; });
    var ms = sumRange({rows:monthRows});
    $("m-sum").innerHTML = monthRows.length
      ? '수입 <b class="pos">' + fmtEok(ms.inc) + '</b>, 지출 <b class="neg">' + fmtEok(ms.out) + '</b>, 순 <b>' + fmtSigned(ms.inc - ms.out) + '</b>'
      : "";

    var box = $("list");
    if (!st.entries.length){
      box.innerHTML = '<div class="card empty" style="margin-top:16px"><h4>잔고 확인부터</h4>' +
        '인벤토리와 창고 메소를 한 번 넣으면, 이후엔 벌고 쓴 것만 적으면 됨.' +
        '<div><button class="btn primary" data-open="bal">잔고 확인하기</button></div></div>';
      return;
    }
    var rows = monthRows.filter(function(r){ return ui.filter === "all" || r.e.t === ui.filter; });
    if (!rows.length){
      box.innerHTML = '<div class="empty">' + (monthRows.length ? "이 조건의 기록 없음" : "이 달 기록 없음") +
        (monthRows.length ? '<div><button class="btn sm" data-all>전체 보기</button></div>' : '') + '</div>';
      return;
    }
    var days = {}, order = [];
    rows.forEach(function(r){
      if (!days[r.e.d]){ days[r.e.d] = []; order.push(r.e.d); }
      days[r.e.d].push(r);
    });
    order.reverse();
    box.innerHTML = order.map(function(d){
      var list = days[d], net = 0, has = false;
      list.forEach(function(r){ if (r.e.t !== "bal"){ has = true; net += r.e.t === "in" ? r.e.a : -r.e.a; } });
      return '<div class="day"><div class="day-h"><strong>' + mdLong(parseDate(d)) + '</strong>' +
             (has ? '<span class="' + signCls(net) + '">' + fmtSigned(net) + '</span>' : '') + '</div>' +
             '<div class="day-list">' + list.slice().reverse().map(entryRow).join("") + '</div></div>';
    }).join("");
  }

  /* ---------- 통계 탭 ---------- */
  function bars(obj, t, total){
    var keys = Object.keys(obj).filter(function(k){ return obj[k] > 0; })
      .sort(function(a, b){ return obj[b] - obj[a]; });
    if (!keys.length) return '<div class="note">아직 없음</div>';
    var max = obj[keys[0]];
    return keys.map(function(k){
      var info = t ? cat(t, k) : {n:k, c:"var(--violet)"};
      return '<div class="row"><div class="nm" title="' + esc(info.n) + '">' + esc(info.n) + '</div>' +
             '<div class="tr"><div class="fl" style="width:' + (obj[k] / max * 100).toFixed(1) + '%;background:' + info.c + '"></div></div>' +
             '<div class="vl">' + fmtEok(obj[k]) + '<small>' + Math.round(obj[k] / total * 100) + '%</small></div></div>';
    }).join("");
  }

  function renderStats(L, ws, cfg){
    Array.prototype.forEach.call($("speriod").children, function(b){
      b.setAttribute("aria-pressed", b.dataset.p === ui.period ? "true" : "false");
    });
    var t = today(), tISO = toISO(t), from = null;
    if (ui.period === "month") from = tISO.slice(0, 7) + "-01";
    else if (ui.period === "28") from = toISO(addDays(t, -(WINDOW - 1)));
    if (from && L.first && from < L.first) from = L.first;
    var s = sumRange(L, from, ui.period === "all" ? null : tISO), net = s.inc - s.out;

    $("kpis").innerHTML =
      '<div class="kpi"><small>수입</small><b class="pos">' + fmtEok(s.inc) + '</b></div>' +
      '<div class="kpi"><small>지출</small><b class="neg">' + fmtEok(s.out) + '</b></div>' +
      '<div class="kpi"><small>순익</small><b class="' + signCls(net) + '">' + fmtSigned(net) + '</b></div>';
    $("kpi-note").innerHTML = Math.abs(s.adj) >= 1e-4
      ? "위 숫자엔 <b>미기록 " + fmtSigned(s.adj) + "</b> 빠짐." : "";
    $("b-in").innerHTML = bars(s.byIn, "in", s.inc || 1);
    $("b-out").innerHTML = bars(s.byOut, "out", s.out || 1);
    $("b-char").innerHTML = Object.keys(s.byChar).length ? bars(s.byChar, null, s.inc || 1)
      : '<div class="note">수입에 캐릭터를 적으면 여기 나옴</div>';
    var big = s.outs.slice().sort(function(a, b){ return b.a - a.a; }).slice(0, 5);
    $("b-big").innerHTML = big.length ? '<table class="tbl"><tbody>' + big.map(function(e){
      return '<tr><td class="wrap">' + cat("out", e.c).n + '<div class="note">' + md(parseDate(e.d)) +
             (e.m ? ", " + esc(e.m) : "") + '</div></td><td class="neg">' + fmtEok(e.a) + '</td></tr>';
    }).join("") + '</tbody></table>' : '<div class="note">아직 없음</div>';

    renderGoal(L, ws, cfg);
    renderWeeks(L);
    renderCompare(ws, cfg);
    drawChart(L, cfg);
  }

  function goalHtml(g, ws){
    var planTxt = g.planD ? "계산기 계획 <b>" + md(g.planD) + "</b>" : "계산기 계획으론 도달 불가";
    var h;
    if (g.state === "nodata") h = '<div class="note">기록이 생기면 계산함. ' + planTxt + '</div>';
    else if (g.state === "done") h = '<div class="goal-big">달성<small>목표보다 ' + fmtEok(-g.left) + ' 많음</small></div>';
    else if (g.state === "stall") h = '<div class="goal-big" style="color:var(--rose)">—<small>최근 순수익이 0 이하</small></div>' +
                                      '<div class="goal-lines">남은 <b>' + fmtEok(g.left) + '</b>, ' + planTxt + '</div>';
    else {
      var diff = g.diff === undefined ? "" : g.diff === 0 ? ", 계획과 같음"
               : g.diff > 0 ? ', <b class="neg">' + g.diff + "일 늦음</b>" : ', <b class="pos">' + (-g.diff) + "일 빠름</b>";
      h = '<div class="goal-big">' + mdLong(g.eta) + '<small>' + M.daysText(g.days) + '</small></div>' +
          '<div class="goal-lines">남은 <b>' + fmtEok(g.left) + '</b>, 최근 ' + ws.days + '일 순수익 페이스 기준<br>' + planTxt + diff + '</div>';
    }
    /* 계산기의 정기 지출은 예상치고, 이건 실제 기록 기준. 실제 지출 페이스가 목표를 얼마나 미루는지 따로 보여준다. */
    if (ws && ws.outDay > 0 && g.left > 0 && ws.incDay > 0){
      var withOut = ws.netDay > 0 ? Math.ceil(g.left / ws.netDay) : null;
      var noOut = Math.ceil(g.left / ws.incDay);
      h += '<div class="callout">' + (withOut
        ? "지금 지출(<b>" + fmtEok(ws.outDay * DAYS_PER_MONTH) + "/월</b>)이 도달을 <b>" + (withOut - noOut) + "일</b> 미루는 중. 안 쓰고 모으면 " + noOut + "일."
        : "최근 지출이 수입보다 많아서 이 페이스론 못 감. 안 쓰고 모으면 <b>" + noOut + "일</b>.") + '</div>';
    }
    return h;
  }

  function renderGoal(L, ws, cfg){
    var g = goalInfo(L, ws, cfg);
    if (!g){
      $("goal-sub").textContent = "";
      $("goal").innerHTML = '<div class="note">계산기에서 목표를 정하면 실제 수입 속도로 도달 시점을 보여줌.</div>' +
                            '<div class="btns" style="margin-top:12px"><a class="btn sm" href="#calc">계산기 열기</a></div>';
      return;
    }
    $("goal-sub").textContent = fmtEok(g.goal);
    $("goal").innerHTML = goalHtml(g, ws);
  }

  function renderCompare(ws, c){
    function cls(a, b, higherGood){
      // 3% 안쪽은 같은 걸로 봄 (2.98억 vs 3억에 빨간색은 과함)
      if (a === null || b === null || !isFinite(a) || !isFinite(b) || Math.abs(a - b) <= Math.abs(b) * 0.03) return "";
      return (a > b) === higherGood ? "pos" : "neg";
    }
    function cell(v, f){ return v === null || !isFinite(v) ? '<span class="dim">—</span>' : f(v); }
    var aRate = ws ? ws.rate : null, aHours = ws ? ws.hours : null, aWeekly = ws ? ws.weekly : null;
    var aOut = ws ? ws.outDay * DAYS_PER_MONTH : null, aNet = ws ? ws.netDay * DAYS_PER_MONTH : null;
    var inc = c ? C.monthIncome(c) : null, cNet = inc ? inc.total : null, cOut = inc ? inc.expense : null;
    var rows = [
      ["재획 시급", cls(aRate, c && c.rate, true), cell(aRate, function(v){ return fmtFine(v) + "/h"; }), c ? fmtFine(c.rate) + "/h" : "—"],
      ["하루 사냥", cls(aHours, c && c.hours, true), cell(aHours, function(v){ return (+v.toFixed(1)) + "시간"; }), c ? c.hours + "시간" : "—"],
      ["주간보스", cls(aWeekly, c && c.weekly, true), cell(aWeekly, function(v){ return fmtEok(v) + "/주"; }), c ? fmtEok(c.weekly) + "/주" : "—"],
      ["지출", cls(cOut, aOut, true), cell(aOut, function(v){ return fmtEok(v) + "/월"; }),
               c ? (cOut > 0 ? fmtEok(cOut) + "/월" : '<span class="dim">없음</span>') : "—"],
      ["순수익", cls(aNet, cNet, true), cell(aNet, function(v){ return fmtEok(v) + "/월"; }), c ? fmtEok(cNet) + "/월" : "—"]
    ];
    $("cmp").innerHTML = rows.map(function(r){
      return '<tr><td>' + r[0] + '</td><td class="' + r[1] + '">' + r[2] + '</td><td>' + r[3] + '</td></tr>';
    }).join("");
    $("cmp-sub").textContent = ws ? "최근 " + ws.days + "일" : "기록 없음";
  }

  // 폰에선 수입·지출 열이 숨어서 주 이름 칸 아래 한 줄로 (넓은 화면에선 ph-only 로 숨김)
  function weekSub(s){
    var p = [];
    if (s.inc) p.push("수입 " + fmtEok(s.inc));
    if (s.out) p.push("지출 " + fmtEok(s.out));
    return p.length ? '<span class="cell-sub ph-only">' + p.join(", ") + '</span>' : "";
  }

  function renderWeeks(L){
    var body = $("weeks");
    if (!L.first){ body.innerHTML = '<tr><td colspan="5" class="dim">기록이 생기면 나옴</td></tr>'; return; }
    var t = today(), cur = M.weekStart(t), first = M.weekStart(parseDate(L.first)), out = [];
    for (var w = 0; w < 8; w++){
      var ws = addDays(cur, -7 * w);
      if (ws < first) break;
      var we = addDays(ws, 6), s = sumRange(L, toISO(ws), toISO(we)), net = s.inc - s.out;
      var endBal = balAt(L, toISO(we > t ? t : we));
      out.push('<tr' + (w === 0 ? ' class="now"' : '') + '><td>' + md(ws) + ' ~ ' + md(we) + (w === 0 ? ' (이번 주)' : '') + weekSub(s) + '</td>' +
               '<td class="wide">' + (s.inc ? fmtEok(s.inc) : '<span class="dim">—</span>') + '</td>' +
               '<td class="wide">' + (s.out ? fmtEok(s.out) : '<span class="dim">—</span>') + '</td>' +
               '<td class="' + signCls(net) + '">' + (s.inc || s.out ? fmtSigned(net) : "—") + '</td>' +
               '<td>' + (endBal === null ? "—" : fmtEok(endBal)) + '</td></tr>');
    }
    body.innerHTML = out.join("");
  }

  /* 그래프는 실제 픽셀 폭으로 그림 — viewBox 를 고정하면 폰에서 축 글씨가 5px 대로 줄어듦 */
  function drawChart(L, cfg){
    var box = $("chart");
    if (!L.first){
      box.innerHTML = '<div class="note" style="padding:24px 0;text-align:center">기록이 생기면 잔고 흐름이 그려짐</div>';
      $("legend").hidden = true;
      $("chart-sub").textContent = "";
      return;
    }
    if (!box.clientWidth) return;   // 안 보이는 상태에선 폭을 못 재서 다음에 보일 때 그림
    var W = Math.round(box.clientWidth), H = W < 480 ? 200 : 240;
    $("legend").hidden = false;
    var t = today(), from = parseDate(L.first), lastD = parseDate(L.last);
    var actEnd = lastD > t ? lastD : t;
    var to = dayDiff(from, actEnd) < 13 ? addDays(from, 13) : actEnd;
    var days = dayDiff(from, to) + 1;

    var act = [], ri = 0, run = null;
    for (var i = 0; i < days; i++){
      var d = addDays(from, i), iso = toISO(d);
      while (ri < L.rows.length && L.rows[ri].e.d <= iso){ run = L.rows[ri].after; ri++; }
      act.push(d <= actEnd ? run : null);
    }
    // 계획은 계산기 시작일부터. 점이 하나뿐이면(시작일 = 오늘) 선이 안 되므로 생략
    var plan = [], planPts = 0, ps = cfg && cfg.start <= to ? planSeries(cfg, to) : null;
    if (ps){
      for (var j = 0; j < days; j++){
        var v = ps[toISO(addDays(from, j))];
        plan.push(v === undefined ? null : v);
        if (v !== undefined) planPts++;
      }
    }
    var hasPlan = planPts > 1;
    if (!hasPlan) plan = [];
    $("lg-plan").hidden = !hasPlan;

    var vals = act.concat(plan).filter(function(v){ return v !== null; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pad = (hi - lo) * 0.12 || Math.max(Math.abs(hi) * 0.05, 1);
    lo = lo >= 0 ? Math.max(0, lo - pad) : lo - pad;
    hi += pad;

    // 축 단위: 조 단위면 전부 조, 아니면 억 — 자리가 좁아서 "억" 은 맨 위 눈금에만
    var inJo = hi >= 10000;
    function axisLbl(v, top){
      if (inJo) return (v / 10000).toFixed(1) + (top ? "조" : "");
      return Math.round(v).toLocaleString("ko-KR") + (top ? "억" : "");
    }
    var padL = 46, padR = 8, padT = 10, padB = 26, iw = W - padL - padR, ih = H - padT - padB;
    function sx(i){ return padL + (i / (days - 1)) * iw; }
    function sy(v){ return padT + ih - ((v - lo) / (hi - lo)) * ih; }
    var s = ['<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="잔고 흐름 그래프">'];
    for (var k = 0; k <= 3; k++){
      var val = lo + (hi - lo) * k / 3, y = sy(val);
      s.push('<line class="ch-grid" x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '"/>');
      s.push('<text class="ch-lbl" x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' + axisLbl(val, k === 3) + '</text>');
    }
    if (hasPlan){
      var pp = [];
      plan.forEach(function(v, i){ if (v !== null) pp.push(sx(i).toFixed(1) + "," + sy(v).toFixed(1)); });
      s.push('<polyline class="ch-plan" points="' + pp.join(" ") + '" stroke-width="1.6" stroke-dasharray="5 4"/>');
    }
    // 실제: 계단. 그날 기록이 반영된 잔고가 그날 칸에서 시작
    var i0 = -1, iL = -1, path = "";
    act.forEach(function(v, i){
      if (v === null) return;
      if (i0 < 0){ i0 = i; path = "M " + sx(i).toFixed(1) + " " + sy(v).toFixed(1); }
      else if (v !== act[i-1]) path += " H " + sx(i).toFixed(1) + " V " + sy(v).toFixed(1);
      iL = i;
    });
    if (iL > i0) path += " H " + sx(iL).toFixed(1);
    if (i0 >= 0){
      s.push('<defs><linearGradient id="lag" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style="stop-color:var(--gold);stop-opacity:.22"/><stop offset="100%" style="stop-color:var(--gold);stop-opacity:0"/></linearGradient></defs>');
      s.push('<path d="' + path + ' V ' + (padT + ih) + ' H ' + sx(i0).toFixed(1) + ' Z" fill="url(#lag)"/>');
      s.push('<path class="ch-act" d="' + path + '" stroke-width="2.2" stroke-linejoin="round"/>');
      s.push('<circle class="ch-dot" cx="' + sx(iL).toFixed(1) + '" cy="' + sy(act[iL]).toFixed(1) + '" r="4.5" stroke-width="2.2"/>');
    }
    var ti = dayDiff(from, t);
    if (ti > 0 && ti < days - 1){
      s.push('<line class="ch-today" x1="' + sx(ti).toFixed(1) + '" y1="' + padT + '" x2="' + sx(ti).toFixed(1) + '" y2="' + (padT + ih) + '" stroke-dasharray="2 3"/>');
    }
    s.push('<line class="ch-axis" x1="' + padL + '" y1="' + (padT + ih) + '" x2="' + (W - padR) + '" y2="' + (padT + ih) + '"/>');
    var ticks = W < 480 ? 3 : 5;
    for (var x = 0; x <= ticks; x++){
      var dn = Math.round((days - 1) * x / ticks);
      s.push('<text class="ch-lbl" x="' + sx(dn).toFixed(1) + '" y="' + (padT + ih + 18) + '" text-anchor="' +
             (x === 0 ? "start" : x === ticks ? "end" : "middle") + '">' + md(addDays(from, dn)) + '</text>');
    }
    s.push('</svg>');
    box.innerHTML = s.join("");

    // 계획 대비: 마지막 기록일(오늘 이후면 오늘) 기준
    var sub = "", cl = "";
    if (hasPlan){
      var cmpD = lastD > t ? t : lastD, ci = dayDiff(from, cmpD);
      if (ci >= 0 && ci < days && plan[ci] !== null && act[ci] !== null){
        var diff = act[ci] - plan[ci];
        sub = "계획 대비 " + fmtSigned(diff);
        cl = signCls(diff);
      }
    }
    $("chart-sub").textContent = sub;
    $("chart-sub").className = cl;
  }

  /* ---------- 예산 탭 ---------- */
  // 행 구조는 한 번만 만들고(편집 중 입력칸 포커스 유지), 값과 막대만 매번 갱신
  function buildBudget(){
    var rows = [{k:"_total", n:"전체 한도", c:"var(--text)"}].concat(CATS.out);
    $("budget").innerHTML = rows.map(function(r){
      var v = r.k === "_total" ? st.budget.total : st.budget.cats[r.k];
      return '<div class="brow" data-b="' + r.k + '"' + (r.k === "_total" ? ' data-total' : '') + '>' +
             '<div class="hd"><span class="nm"><span class="dot" style="--c:' + r.c + '"></span>' + r.n + '</span>' +
             '<span class="vl" data-bv></span>' +
             '<label class="edit"><input type="number" min="0" step="1" inputmode="decimal" data-bk="' + r.k + '" value="' + (v > 0 ? v : "") +
             '" placeholder="없음" aria-label="' + r.n + ' 월 예산">억/월</label></div>' +
             '<div class="meter sm" data-bm><div class="fl" data-bf></div><div class="pace" data-bp></div></div></div>';
    }).join("");
  }

  function renderBudget(L){
    var t = today(), pace = monthPace(), m = monthSum(L), tot = budgetTotal();
    var sumCats = 0;
    Object.keys(st.budget.cats).forEach(function(k){ sumCats += st.budget.cats[k]; });

    $("bud-title").textContent = (t.getMonth() + 1) + "월 지출";
    $("bud-spent").textContent = fmtEok(m.out);
    $("bud-of").textContent = tot > 0 ? " / 예산 " + fmtEok(tot) : "";
    var fill = $("bud-fill"), status;
    $("bud-meter").hidden = !(tot > 0);
    if (tot > 0){
      var r = m.out / tot, should = tot * pace;
      fill.style.width = Math.min(100, r * 100).toFixed(1) + "%";
      fill.className = "fl" + (r > 1 ? " over" : m.out > should ? " warn" : "");
      $("bud-pace").style.left = (pace * 100).toFixed(1) + "%";
      if (m.out > tot) status = '예산을 <b class="neg">' + fmtEok(m.out - tot) + '</b> 넘김.';
      else if (m.out > should) status = '오늘 기준보다 <b class="neg">' + fmtEok(m.out - should) + '</b> 더 씀. 이대로면 월말 <b>' +
                                        fmtEok(m.out / pace) + '</b>.';
      else status = '예산 안. 이번 달 <b>' + fmtEok(tot - m.out) + '</b> 더 쓸 수 있음.';
    } else {
      status = m.out > 0 ? "이대로면 월말 <b>" + fmtEok(m.out / pace) + "</b>. 예산을 정하면 비교함."
                         : "아직 이번 달 지출 없음.";
    }
    $("bud-status").innerHTML = status;

    $("budget").classList.toggle("editing", ui.budEdit);
    $("bud-edit").textContent = ui.budEdit ? "완료" : (tot > 0 ? "예산 수정" : "예산 정하기");
    Array.prototype.forEach.call($("budget").children, function(row){
      var k = row.dataset.b, isTot = k === "_total";
      var spent = isTot ? m.out : (m.byOut[k] || 0);
      var bud = isTot ? st.budget.total : (st.budget.cats[k] || 0);
      // 전체 행은 편집할 때만. 평소엔 위 큰 카드가 전체를 보여줌
      row.hidden = isTot && !ui.budEdit;
      if (isTot) row.querySelector("input").placeholder = sumCats > 0 ? "항목 합 " + round(sumCats, 1) : "없음";
      var fl = row.querySelector("[data-bf]"), pc = row.querySelector("[data-bp]"), vl = row.querySelector("[data-bv]");
      row.querySelector("[data-bm]").hidden = !(bud > 0);
      if (bud > 0){
        var r = spent / bud;
        fl.style.width = Math.min(100, r * 100).toFixed(1) + "%";
        fl.className = "fl" + (r > 1 ? " over" : r > pace ? " warn" : "");
        pc.style.left = (pace * 100).toFixed(1) + "%";
        vl.innerHTML = "<b>" + fmtEok(spent) + "</b> / " + fmtEok(bud);
      } else {
        vl.innerHTML = spent > 0 ? "<b>" + fmtEok(spent) + "</b>" : "—";
      }
    });
  }

  /* ---------- 기록 시트 ---------- */
  function charNames(){
    var seen = {}, out = [];
    function add(n){ if (n && !seen[n]){ seen[n] = 1; out.push(n); } }
    M.chars.all().forEach(function(c){ add(c.name); });
    st.entries.slice().sort(function(a, b){ return b.id - a.id; }).forEach(function(e){ add(e.ch); });
    return out;
  }

  // 최근 손으로 넣은 기록 중 (항목, 캐릭, 금액, 시간)이 다른 것 6개 — 반복 기록을 한 번에
  function presets(t){
    var seen = {}, out = [];
    var list = st.entries.slice().sort(function(a, b){ return b.id - a.id; });
    for (var i = 0; i < list.length && out.length < 6; i++){
      var e = list[i];
      if (e.t !== t || e.src) continue;
      var key = [e.c, e.ch || "", round(e.a, 4), e.h || ""].join("|");
      if (seen[key]) continue;
      seen[key] = 1;
      out.push(e);
    }
    return out;
  }

  function balBefore(iso, excludeId){
    var run = null;
    st.entries.slice().sort(function(a, b){ return a.d < b.d ? -1 : a.d > b.d ? 1 : a.id - b.id; })
      .forEach(function(e){
        if (e.id === excludeId || e.d > iso) return;
        run = e.t === "bal" ? e.a : (run || 0) + (e.t === "in" ? e.a : -e.a);
      });
    return run;
  }

  function renderSheet(){
    Array.prototype.forEach.call($("seg").children, function(b){
      b.setAttribute("aria-pressed", b.dataset.t === ui.t ? "true" : "false");
    });
    var isBal = ui.t === "bal", c = ui.c[ui.t], editing = ui.edit ? findEntry(ui.edit) : null;
    $("sh-title").textContent = editing ? "기록 수정" : "기록 추가";

    var ps = isBal || editing ? [] : presets(ui.t);
    $("r-presets").hidden = !ps.length;
    $("presets").innerHTML = ps.map(function(e){
      var info = cat(e.t, e.c);
      return '<button type="button" class="preset" data-pid="' + e.id + '"><span>' + info.n +
             (e.ch ? ", " + esc(e.ch) : "") + (e.h ? ", " + e.h + "시간" : "") + '</span><b>' + fmtMan(e.a) + '</b></button>';
    }).join("");

    $("r-cats").hidden = isBal;
    $("cats").innerHTML = isBal ? "" : CATS[ui.t].map(function(x){
      return '<button type="button" class="cat" data-c="' + x.k + '" style="--c:' + x.c + '" aria-pressed="' + (x.k === c) + '">' +
             '<span class="dot" style="--c:' + x.c + '"></span>' + x.n + '</button>';
    }).join("");

    // 캐릭터 탭에 등록한 보스 수익 · 계산기 사냥 가정으로 채우기
    var q = [], calc = M.calc && M.calc.cfg();
    if (ui.t === "in"){
      if (c === "weekly" || c === "monthly"){
        var val = c === "weekly" ? M.chars.weekly : M.chars.monthly;
        var withV = M.chars.all().filter(function(r){ return val(r) > 0; });
        withV.forEach(function(r){ q.push({label:r.name + " " + fmtFine(val(r)), v:val(r), ch:r.name}); });
        if (withV.length > 1) q.push({label:"전체 " + fmtFine(M.chars.totals()[c]), v:M.chars.totals()[c], ch:""});
      } else if (c === "hunt" && calc && calc.rate > 0 && calc.hours > 0){
        q.push({label:calc.hours + "시간 × " + fmtFine(calc.rate), v:calc.rate * calc.hours, h:calc.hours});
      }
    }
    $("quick").hidden = !q.length;
    $("quick").innerHTML = q.map(function(x){
      return '<button type="button" class="chip" data-v="' + round(x.v, 4) + '"' +
             (x.ch !== undefined ? ' data-ch="' + esc(x.ch) + '"' : '') + (x.h ? ' data-h="' + x.h + '"' : '') +
             '>' + esc(x.label) + '</button>';
    }).join("");

    $("amt-label").textContent = isBal ? "지금 실제로 가진 메소 (인벤토리 + 창고)" : "얼마";
    $("r-hours").hidden = !(ui.t === "in" && c === "hunt");
    $("r-char").hidden = isBal;
    var names = charNames().slice(0, 6), cur = $("f-char").value.trim();
    $("charchips").innerHTML = names.map(function(n){
      return '<button type="button" class="chip" data-name="' + esc(n) + '" aria-pressed="' + (n === cur) + '">' + esc(n) + '</button>';
    }).join("");
    syncDateChips();

    var api = editing && isApi(editing);
    $("api-note").hidden = !api;
    if (api){
      // ≈ 근거(항목 · 횟수 · 금액)를 툴팁 말고 눈에 보이게 — 터치에선 툴팁이 안 뜸
      var ev = editing.x && editing.x.items ? editing.x.items.map(function(it){
        return esc(it[0]) + " " + it[1] + "회 " + fmtEok(it[2]);
      }).join("<br>") : "";
      $("api-note").innerHTML = (editing.lock ? "API 기록. 직접 고쳐서 동기화가 덮어쓰지 않음"
                                              : "API 기록. 고치면 동기화가 덮어쓰지 않음") +
                                (ev ? "<br>" + ev : "");
    }
    $("f-del").hidden = !editing;
    $("f-more").hidden = !!editing;
    $("f-submit").textContent = editing ? "수정" : isBal ? "잔고 확인" : "저장";
    preview();
  }

  function syncDateChips(){
    var v = $("f-date").value, t = today();
    Array.prototype.forEach.call($("dates").children, function(b){
      b.setAttribute("aria-pressed", v === toISO(addDays(t, -(+b.dataset.dd))) ? "true" : "false");
    });
  }

  /* 금액 칸 읽기. 만 단위 모드에선 단위 없는 100만 미만 숫자를 만으로 봄 (3500 → 3,500만).
     단위를 직접 쓴 값(억 · 만 · 조)과 100만 이상 메소 원본값은 모드와 상관없이 그대로 */
  var PLAIN = /^([\d,]+(?:\.\d+)?)$/;
  function plainNum(raw){
    var m = String(raw).replace(/메소|원/g, "").trim().match(PLAIN);
    return m ? parseFloat(m[1].replace(/,/g, "")) : null;
  }
  function readAmt(raw){
    var n = plainNum(raw);
    if (ui.unit === "만" && n !== null && isFinite(n) && n < 1e6) return n / 1e4;
    return M.parseAmount(raw);
  }
  // 억(a) → 금액 칸에 넣을 글자. 만 모드에서 100만 이상이 되면 메소 원본값으로 읽히니 억을 붙여 씀
  function amtText(a){
    if (ui.unit === "만" && a * 1e4 < 1e6) return String(round(a * 1e4, 2));
    return round(a, 4) + (ui.unit === "만" ? "억" : "");
  }
  function syncUnit(){
    var b = $("amt-unit");
    if (b) b.textContent = ui.unit;
    $("f-amt").placeholder = ui.unit === "만" ? "3500" : "0.35";
  }

  function preview(){
    var raw = $("f-amt").value, v = readAmt(raw), el = $("amt-prev");
    el.className = "amt-prev";
    if (!raw.trim()){
      el.textContent = ui.t === "bal" ? "" : ui.unit === "만" ? "3500 = 3,500만, 0.35억도 됨" : "0.35 = 3,500만, 3500만도 됨";
    } else if (v === null){
      el.textContent = "못 읽음. 숫자와 조·억·만 단위만 가능";
      el.className = "amt-prev bad";
    } else {
      var txt = "= " + fmtMan(v), warn = "";
      if (ui.t === "bal"){
        var prev = balBefore($("f-date").value, ui.edit);
        if (prev !== null){
          var d = v - prev;
          if (Math.abs(d) < 1e-4){ txt += ", 기록과 일치"; el.className = "amt-prev good"; }
          else txt += ", 기록에 없는 " + (d > 0 ? "수입 +" + fmtMan(d) : "지출 " + fmtMan(-d));
        }
      }
      // 자릿수 실수(3500 을 억으로 읽음 등) 방지: 잔고의 10배가 넘거나, 억 모드에서 단위 없는 1000 이상
      var bal = compute().bal, pn = plainNum(raw);
      if (bal > 0 && v > bal * 10) warn = ", 잔고의 10배 넘음";
      else if (ui.unit === "억" && pn !== null && pn >= 1000 && pn < 1e6) warn = ", 억 단위 맞는지 확인";
      if (warn){ txt += warn; el.className = "amt-prev warn"; }
      el.textContent = txt;
    }
    var h = parseFloat($("f-hours").value);
    $("hrs-prev").textContent = (v > 0 && h > 0) ? "시급 " + fmtFine(v / h) : "";
  }

  function openSheet(opts){
    opts = opts || {};
    ui.edit = null;
    delete $("sheet").dataset.dirty;
    $("f-amt").value = ""; $("f-hours").value = ""; $("f-memo").value = "";
    if (opts.id){
      var e = findEntry(opts.id);
      if (!e) return;
      ui.edit = e.id;
      ui.t = e.t;
      if (e.c && e.t !== "bal") ui.c[e.t] = e.c;
      $("f-date").value = e.d;
      $("f-amt").value = amtText(e.a);
      $("f-hours").value = e.h || "";
      $("f-char").value = e.ch || "";
      $("f-memo").value = e.m || "";
    } else {
      // 열 때마다 마지막 수입/지출 모드로 — 잔고 확인은 기록이 하나도 없을 때만 기본
      if (opts.t) ui.t = opts.t;
      else ui.t = st.entries.length ? ui.lastT : "bal";
      $("f-date").value = toISO(today());
      $("f-char").value = opts.ch !== undefined ? opts.ch : ui.lastChar;
    }
    syncUnit();
    renderSheet();
    if (!$("sheet").open) $("sheet").showModal();
    // 폰에선 바로 키보드를 올리면 항목 칸을 가려서, 데스크톱에서만 금액에 포커스
    if (!M.coarse()) $("f-amt").focus();
  }

  function saveSheet(keep){
    var d = $("f-date").value;
    if (!parseDate(d)){ $("f-date").focus(); return; }
    var a = readAmt($("f-amt").value);
    if (a === null || a < 0 || (ui.t !== "bal" && a <= 0)){
      // 못 읽은 이유("못 읽음 …")는 그대로 두고, 빈칸이거나 0 일 때만 안내
      if ($("f-amt").value.trim() && a === null) preview();
      else {
        $("amt-prev").textContent = $("f-amt").value.trim() ? "0보다 크게 넣을 것" : "금액 입력 필요";
        $("amt-prev").className = "amt-prev bad";
      }
      $("f-amt").focus();
      return;
    }
    // 시트를 연 사이 다른 기기가 그 기록을 지웠을 수 있음 → 수정이 아니라 새 기록으로 넣음
    var gone = !!ui.edit && !findEntry(ui.edit);
    var e = {id: ui.edit && !gone ? ui.edit : ++st.seq, d:d, t:ui.t, a:round(a, 6)};
    if (ui.t !== "bal"){
      e.c = ui.c[ui.t];
      var ch = $("f-char").value.trim();
      if (ch) e.ch = ch;
      ui.lastChar = ch;
    }
    if (ui.t === "in" && e.c === "hunt"){
      var h = parseFloat($("f-hours").value);
      if (h > 0) e.h = Math.min(24, h);
    }
    var m = $("f-memo").value.trim();
    if (m) e.m = m;
    var label = (e.t === "bal" ? "잔고 확인 " : cat(e.t, e.c).n + " ") + fmtMan(e.a), undo;
    if (ui.edit && !gone){
      var old = findEntry(ui.edit);
      if (old && old.src){
        e.src = old.src;
        if (old.x) e.x = old.x;      // 보스 체크 기록이면 어떤 보스였는지 유지
        // API 기록을 손으로 고치면 고정 — 다음 동기화가 규칙표 값으로 되돌리지 않음
        if (isApi(old)){
          e.lock = true;
          if (old.est && Math.abs(old.a - e.a) < 1e-9) e.est = true;
        }
      }
      st.entries = st.entries.map(function(x){ return x.id === e.id ? e : x; });
      undo = function(){ st.entries = st.entries.map(function(x){ return x.id === old.id ? old : x; }); changed(); };
      label += " 수정함";
    } else {
      st.entries.push(e);
      undo = function(){ st.entries = st.entries.filter(function(x){ return x.id !== e.id; }); changed(); };
      label += gone ? " (다른 기기에서 지운 기록이라 새로 넣음)" : " 기록함";
    }
    // 마지막 모드는 수입/지출만 기억 (잔고 확인이 + 버튼 기본이 되면 안 됨)
    if (e.t !== "bal") ui.lastT = e.t;
    // 시작 잔고를 넣고 나면 다음 기록은 수입부터
    if (st.entries.length === 1 && e.t === "bal") ui.t = ui.lastT;
    delete $("sheet").dataset.dirty;
    ui.month = d.slice(0, 7);
    ui.fresh = e.id;
    if (keep && !ui.edit){
      $("f-amt").value = ""; $("f-hours").value = ""; $("f-memo").value = "";
      changed();
      renderSheet();
      $("f-amt").focus();
    } else {
      ui.edit = null;
      $("sheet").close();
      changed();
    }
    M.toast(label, undo);
  }

  function findEntry(id){
    for (var i = 0; i < st.entries.length; i++) if (st.entries[i].id === id) return st.entries[i];
    return null;
  }
  function findBySrc(src){
    for (var i = 0; i < st.entries.length; i++) if (st.entries[i].src === src) return st.entries[i];
    return null;
  }

  function removeEntry(id, quiet){
    var e = findEntry(id);
    if (!e) return null;
    st.entries = st.entries.filter(function(x){ return x.id !== id; });
    if (isApi(e)) st.api.skip[e.src] = 1;     // 지운 API 기록은 다음 동기화에서 다시 안 들어오게
    ui.edit = null;
    if ($("sheet").open) $("sheet").close();
    changed();
    var undo = function(){
      if (isApi(e)) delete st.api.skip[e.src];
      st.entries.push(e);
      ui.fresh = e.id;
      changed();
    };
    if (!quiet) M.toast((e.t === "bal" ? "잔고 확인" : cat(e.t, e.c).n) + " " + fmtMan(e.a) + " 삭제함", undo);
    return undo;
  }

  // 홈 보스 체크 같은 곳에서 기록을 직접 넣을 때. 되돌리기 함수를 돌려줌
  function addEntry(x){
    var e = {id: ++st.seq, d:x.d || toISO(today()), t:x.t, a:round(+x.a, 6)};
    ["c", "ch", "m", "src"].forEach(function(k){ if (x[k]) e[k] = x[k]; });
    st.entries.push(e);
    ui.fresh = e.id;
    changed();
    return function(){ st.entries = st.entries.filter(function(y){ return y.id !== e.id; }); changed(); };
  }

  /* 보스 체크 기록 (캐릭터 × 주 = 1건). e 가 null 이면 지움, 있으면 같은 src 기록을 갱신하거나 새로 넣음.
     되돌리기 함수를 돌려줌 */
  function setCheck(src, e){
    var old = findBySrc(src), before = old ? JSON.parse(JSON.stringify(old)) : null;
    if (!e){
      if (!old) return function(){};
      st.entries = st.entries.filter(function(x){ return x.id !== old.id; });
    } else if (old){
      // 날짜는 그 주(달) 처음 체크한 날 그대로 — 매번 오늘로 바꾸면 월말 · 월초에 걸친 주의 수입이 다음 달로 넘어감
      old.a = round(e.a, 6); old.m = e.m; old.x = e.x;
      ui.fresh = old.id;
    } else {
      var n = {id: ++st.seq, d:e.d, t:e.t, a:round(e.a, 6), c:e.c, ch:e.ch, src:src};
      if (e.m) n.m = e.m;
      if (e.x) n.x = e.x;
      st.entries.push(n);
      ui.fresh = n.id;
    }
    changed();
    return function(){
      st.entries = st.entries.filter(function(x){ return x.src !== src; });
      if (before) st.entries.push(before);
      changed();
    };
  }

  function renameChar(from, to){
    var n = 0;
    st.entries.forEach(function(e){ if (e.ch === from){ e.ch = to; n++; } });
    if (n) changed();
  }

  /* ---------- Open API 잠재 재설정 동기화 ---------- */
  var RULES = window.MESO_RULES || {};
  var POT_FIRST = "2024-01-25";          // 잠재 재설정 이력 제공 시작일
  var syncing = false;

  function normGrade(g){
    g = String(g || "");
    return /레전/.test(g) ? "레전드리" : /유니크/.test(g) ? "유니크" : /에픽/.test(g) ? "에픽" : /레어/.test(g) ? "레어" : "";
  }

  /* 재설정 1회 비용. 비용은 "재설정 직전" 등급 기준이라 before 옵션 첫 줄 등급(= 아이템 등급)을 먼저 보고,
     없을 때만 응답의 등급 필드를 씀. 레벨이나 등급을 못 읽으면 null → 비용 미상으로 따로 셈. */
  function potCost(h){
    var R = RULES.potential;
    if (!R) return null;
    var add = /에디/.test(h.potential_type || "");
    var before = add ? h.before_additional_potential_option : h.before_potential_option;
    var grade = normGrade(before && before[0] && before[0].grade) ||
                normGrade(add ? h.additional_potential_option_grade : h.potential_option_grade);
    var row = (add ? R.additional : R.main)[grade], lv = +h.item_level;
    if (!row || !(lv > 0)) return null;
    for (var i = 0; i < R.levels.length; i++) if (lv >= R.levels[i]) return {add:add, cost:row[i] / 1e8};
    return null;
  }

  // 하루치 이력을 캐릭터별 기록 1건으로 묶음. 수백 번 돌려도 목록이 안 덮이게
  function potEntries(iso, list){
    var by = {};
    list.forEach(function(h){
      var ch = h.character_name || "?";
      var g = by[ch] || (by[ch] = {n:0, add:0, up:0, unk:0, cost:0, items:{}});
      var c = potCost(h), name = h.target_item || "?";
      var it = g.items[name] || (g.items[name] = [name, 0, 0]);
      g.n++; it[1]++;
      if (c){ g.cost += c.cost; it[2] += c.cost; if (c.add) g.add++; }
      else g.unk++;
      if (/상승|성공/.test(h.item_upgrade_result || "")) g.up++;
    });
    return Object.keys(by).map(function(ch){
      var g = by[ch], main = g.n - g.add - g.unk, memo = [];
      if (main) memo.push("잠재 " + main + "회");
      if (g.add) memo.push("에디 " + g.add + "회");
      if (g.up) memo.push("등급 상승 " + g.up);
      if (g.unk) memo.push("비용 미상 " + g.unk + "회");
      var items = Object.keys(g.items).map(function(k){ return g.items[k]; })
        .sort(function(a, b){ return b[2] - a[2] || b[1] - a[1]; }).slice(0, 8)
        .map(function(it){ return [it[0], it[1], round(it[2], 4)]; });
      return {d:iso, t:"out", c:"pot", a:round(g.cost, 6), ch:ch, m:memo.join(" · "),
              src:"api:pot:" + iso + ":" + ch, est:true,
              x:{n:g.n, unk:g.unk, items:items, rules:RULES.potential && RULES.potential.version}};
    });
  }

  function upsert(e){
    if (st.api.skip[e.src]) return "skip";
    for (var i = 0; i < st.entries.length; i++){
      var old = st.entries[i];
      if (old.src !== e.src) continue;
      if (old.lock) return "locked";
      if (old.a === e.a && old.m === e.m && old.d === e.d) return "same";
      e.id = old.id;
      st.entries[i] = e;
      return "updated";
    }
    e.id = ++st.seq;
    st.entries.push(e);
    return "added";
  }

  function apiLog(html){ $("api-log").innerHTML = html; }

  function sync(){
    if (syncing) return;
    if (!M.api.key()){
      location.hash = "#settings";
      $("api-key").focus();
      apiLog('<span class="bad">API 키 먼저 입력할 것</span>');
      return;
    }
    var t = today(), tISO = toISO(t);
    // 마지막으로 가져온 날도 다시 가져옴 — 이력은 최대 30분 늦게 들어와서 그날 것이 덜 왔을 수 있음
    var from = st.api.last.pot || $("api-from").value || toISO(addDays(t, -6));
    if (from < POT_FIRST) from = POT_FIRST;
    if (from > tISO) from = tISO;
    var days = dayDiff(parseDate(from), t) + 1;
    if (days > 62 && !confirm(days + "일치를 가져옴. 하루 최소 1건씩 호출해서 개발 키 한도(1,000건/일)를 꽤 씀. 진행?")) return;

    syncing = true;
    setSyncUI();
    var tally = {added:0, updated:0, same:0, locked:0, skip:0}, n = 0, sum = 0, err = null;
    var d = parseDate(from);

    function step(){
      if (d > t) return Promise.resolve();
      var iso = toISO(d);
      apiLog(md(d) + " 가져오는 중… (" + (dayDiff(parseDate(from), d) + 1) + "/" + days + ")");
      return M.api.fetchAll("/maplestory/v1/history/potential", "potential_history", iso).then(function(list){
        potEntries(iso, list).forEach(function(e){
          tally[upsert(e)]++;
          n += e.x.n; sum += e.a;
        });
        st.api.last.pot = iso;
        d = addDays(d, 1);
        return step();
      }, function(e){
        // 오늘치가 아직 준비 안 된 건 실패가 아님
        if (iso === tISO && (e.code === "OPENAPI00009" || e.code === "OPENAPI00004")) return;
        throw e;
      });
    }

    step().catch(function(e){ err = e; }).then(function(){
      syncing = false;
      st.api.run = new Date().toISOString();
      changed();
      setSyncUI();
      var range = md(parseDate(from)) + (days > 1 ? "~" + md(t) : "");
      var parts = [];
      if (tally.added) parts.push("추가 " + tally.added);
      if (tally.updated) parts.push("갱신 " + tally.updated);
      if (tally.locked) parts.push("유지 " + tally.locked + " (직접 고친 기록)");
      if (tally.skip) parts.push("건너뜀 " + tally.skip + " (지운 기록)");
      var head = range + " 잠재 재설정 " + n + "회" + (n ? ", −" + fmtEok(sum) + " ≈" : "");
      apiLog((err ? "" : '<span class="ok">') + esc(head) + (err ? "" : "</span>") +
             (parts.length ? "\n" + parts.join(", ") : n ? "\n바뀐 기록 없음" : "") +
             (err ? '\n<span class="bad">중단: ' + esc(err.message) + (st.api.last.pot ? " (" + md(parseDate(st.api.last.pot)) + "까지 반영됨)" : "") + "</span>" : ""));
      if (err) M.toast("동기화 중단: " + err.message);
      else if (tally.added || tally.updated) M.toast("잠재 재설정 " + (tally.added + tally.updated) + "건 반영");
      else M.toast("새로 들어온 기록 없음");
    });
  }

  function setSyncUI(){
    var has = !!M.api.key(), run = st.api.run ? new Date(st.api.run) : null;
    var when = run ? md(run) + " " + String(run.getHours()).padStart(2, "0") + ":" + String(run.getMinutes()).padStart(2, "0") : "";
    $("btn-sync").hidden = !has;
    $("btn-sync").classList.toggle("busy", syncing);
    $("btn-sync").title = syncing ? "동기화 중…" : "넥슨 Open API 동기화" + (when ? " (마지막 " + when + ")" : "");
    $("api-sync").disabled = syncing;
    $("api-sync").textContent = syncing ? "동기화 중…" : "지금 동기화";
    $("api-forget").hidden = !has;
    // 저장된 키는 칸에 다시 채우지 않고 끝 4자리만 안내
    $("api-key").placeholder = has ? "저장됨 …" + M.api.key().slice(-4) : "test_…";
    $("r-api-from").hidden = !!st.api.last.pot;
    $("api-state").textContent = !has ? "키 없음" : when ? "마지막 " + when : "키 저장됨";
  }

  /* ---------- 렌더 ---------- */
  function render(sub){
    if (sub) ui.sub = sub;
    ["log", "stats", "budget"].forEach(function(x){ $("l-" + x).hidden = x !== ui.sub; });
    Array.prototype.forEach.call(document.querySelectorAll("#v-ledger [data-sub]"), function(a){
      if (a.dataset.sub === ui.sub) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    var L = compute();
    if (ui.sub === "log") renderLog(L);
    else if (ui.sub === "stats") renderStats(L, windowStats(L), M.calc.cfg());
    else renderBudget(L);
    ui.fresh = null;
  }

  /* ---------- events ---------- */
  $("list").addEventListener("click", function(e){
    var open = e.target.closest("[data-open]");
    if (open){ openSheet({t:open.dataset.open}); return; }
    if (e.target.closest("[data-all]")){ ui.filter = "all"; renderLog(compute()); return; }
    var row = e.target.closest("[data-id]");
    if (row) openSheet({id:+row.dataset.id});
  });
  $("filters").addEventListener("click", function(e){
    var b = e.target.closest("[data-f]");
    if (!b) return;
    ui.filter = b.dataset.f;
    renderLog(compute());
  });
  function shiftMonth(n){
    var p = ui.month.split("-"), d = new Date(+p[0], +p[1] - 1 + n, 1);
    ui.month = toISO(d).slice(0, 7);
    renderLog(compute());
  }
  $("m-prev").addEventListener("click", function(){ shiftMonth(-1); });
  $("m-next").addEventListener("click", function(){ shiftMonth(1); });
  if ($("m-today")) $("m-today").addEventListener("click", function(){
    ui.month = toISO(today()).slice(0, 7);
    renderLog(compute());
  });
  $("speriod").addEventListener("click", function(e){
    var b = e.target.closest("[data-p]");
    if (!b) return;
    ui.period = b.dataset.p;
    render();
  });

  // 시트
  $("seg").addEventListener("click", function(e){
    var b = e.target.closest("[data-t]");
    if (!b) return;
    ui.t = b.dataset.t;
    renderSheet();
  });
  $("cats").addEventListener("click", function(e){
    var b = e.target.closest("[data-c]");
    if (!b) return;
    ui.c[ui.t] = b.dataset.c;
    renderSheet();
    if (!M.coarse()) $("f-amt").focus();
  });
  $("presets").addEventListener("click", function(e){
    var b = e.target.closest("[data-pid]"), p = b && findEntry(+b.dataset.pid);
    if (!p) return;
    ui.c[p.t] = p.c;
    $("f-amt").value = amtText(p.a);
    $("f-char").value = p.ch || "";
    $("f-hours").value = p.h || "";
    renderSheet();
    $("f-submit").focus();
  });
  $("quick").addEventListener("click", function(e){
    var b = e.target.closest("[data-v]");
    if (!b) return;
    $("f-amt").value = amtText(+b.dataset.v);
    if (b.dataset.ch !== undefined) $("f-char").value = b.dataset.ch;
    if (b.dataset.h) $("f-hours").value = b.dataset.h;
    renderSheet();
    $("f-submit").focus();
  });
  $("charchips").addEventListener("click", function(e){
    var b = e.target.closest("[data-name]");
    if (!b) return;
    $("f-char").value = $("f-char").value.trim() === b.dataset.name ? "" : b.dataset.name;
    renderSheet();
  });
  $("f-char").addEventListener("input", function(){
    var v = this.value.trim();
    Array.prototype.forEach.call($("charchips").children, function(b){
      b.setAttribute("aria-pressed", b.dataset.name === v ? "true" : "false");
    });
  });
  $("dates").addEventListener("click", function(e){
    var b = e.target.closest("[data-dd]");
    if (!b) return;
    $("f-date").value = toISO(addDays(today(), -(+b.dataset.dd)));
    syncDateChips();
    preview();
  });
  $("f-date").addEventListener("input", function(){ syncDateChips(); preview(); });
  ["f-amt", "f-hours"].forEach(function(id){ $(id).addEventListener("input", preview); });
  $("form").addEventListener("submit", function(ev){ ev.preventDefault(); saveSheet(false); });
  $("f-more").addEventListener("click", function(){ saveSheet(true); });
  $("f-del").addEventListener("click", function(){ if (ui.edit) removeEntry(ui.edit); });
  $("sheet").addEventListener("close", function(){ ui.edit = null; delete $("sheet").dataset.dirty; });

  // 입력이 바뀐 시트는 배경 탭으로 안 닫히게 표시 (app.js 가 dataset.dirty 를 봄). 칩으로 채운 것도 입력으로 침
  function markDirty(){ $("sheet").dataset.dirty = "1"; }
  $("sheet").addEventListener("input", markDirty);
  $("sheet").addEventListener("change", markDirty);
  $("sheet").addEventListener("click", function(e){ if (e.target.closest("#presets, #quick, #charchips")) markDirty(); });

  // 단위 억 ↔ 만. 칸에 단위 없는 숫자가 있으면 같은 금액이 되게 바꿔 써 줌
  if ($("amt-unit")) $("amt-unit").addEventListener("click", function(ev){
    ev.preventDefault();
    // 친 숫자는 그대로 두고 새 단위로 읽음 — "3500" 을 치고 "억 맞아?" 를 본 사람이 단위를 바꾸는 게 주된 쓰임
    ui.unit = ui.unit === "만" ? "억" : "만";
    try{ localStorage.setItem(UNIT_KEY, ui.unit); } catch(e){}
    syncUnit();
    preview();
  });

  // 예산
  $("bud-edit").addEventListener("click", function(){
    ui.budEdit = !ui.budEdit;
    renderBudget(compute());
    if (ui.budEdit){
      var first = $("budget").querySelector('.brow:not([data-total]) input');
      if (first && !M.coarse()) first.focus();
    }
  });
  $("budget").addEventListener("input", function(e){
    var k = e.target.dataset.bk;
    if (!k) return;
    var v = parseFloat(e.target.value);
    if (k === "_total") st.budget.total = v > 0 ? v : 0;
    else if (v > 0) st.budget.cats[k] = v;
    else delete st.budget.cats[k];
    save();
    renderBudget(compute());
  });

  // API 설정 (⚙)
  $("api-key").addEventListener("change", function(){
    var k = this.value.trim();
    if (!k) return;                       // 빈칸으로 두면 기존 키 유지. 지우기는 버튼으로
    M.api.setKey(k);
    this.value = "";
    apiLog("키 저장함. 동기화를 누르면 연결 확인을 겸함.");
    setSyncUI();
  });
  $("api-forget").addEventListener("click", function(){
    if (!confirm("저장된 API 키 삭제?")) return;
    M.api.setKey("");
    apiLog("키 지움. 가져온 기록은 그대로 남음.");
    setSyncUI();
  });
  $("api-sync").addEventListener("click", sync);
  $("btn-sync").addEventListener("click", sync);

  M.on("char-rename", function(r){ renameChar(r.from, r.to); });

  /* ---------- init ---------- */
  load();
  try{ if (localStorage.getItem(UNIT_KEY) === "만") ui.unit = "만"; } catch(e){}
  ui.month = toISO(today()).slice(0, 7);
  $("api-from").value = toISO(addDays(today(), -6));
  buildBudget();
  setSyncUI();

  return {
    CATS:CATS, cat:cat, render:render, openSheet:openSheet, compute:compute, windowStats:windowStats,
    sumRange:sumRange, goalInfo:goalInfo, goalHtml:goalHtml, budgetTotal:budgetTotal, monthSum:monthSum,
    entryRow:entryRow, recentRows:recentRows, findBySrc:findBySrc, addEntry:addEntry, removeEntry:removeEntry,
    setCheck:setCheck,
    count:function(){ return st.entries.length; },
    entries:function(){ return st.entries; },
    getState:function(){ return JSON.parse(JSON.stringify(st)); },
    setState:function(s){ adopt(s); save(); buildBudget(); setSyncUI(); M.emit("change", "ledger"); },
    // 백업 복원 전에 미리 검사해 보기용 (원본 안 건드림)
    sanitize:sanitize, inspect:inspect,
    reload:function(){ load(); buildBudget(); setSyncUI(); },
    // 테스트 · 디버그용
    _potEntries:potEntries, _upsert:upsert
  };
})(Meso);
