/* 계산기 — 목표 메소 도달일. 계산은 전부 MesoCore(core.js), 여기는 입력 · 저장 · 그리기.
   보스 수입(주보 · 월보)은 캐릭터 탭에 등록한 값의 합. 장부는 cfg() 로 같은 입력을 받아 계획 곡선을 그림. */
Meso.calc = (function(M){
  "use strict";

  var C = M.core, $ = M.$;
  var MAX_DAYS = C.MAX_DAYS, DAYS_PER_MONTH = C.DAYS_PER_MONTH, WEEK_PER_MONTH = C.WEEK_PER_MONTH;
  var parseDate = M.parseDate, toISO = M.toISO, addDays = M.addDays, DOW = M.DOW;
  var fmtEok = M.fmtEok, fmtFine = M.fmtFine, fmtShort = M.fmtShort, esc = M.esc;
  var simulate = C.simulate, findGoal = C.findGoal, monthIncome = C.monthIncome, withCfg = C.withCfg;
  var SKIP_CHIPS = 8;
  var FIELDS = ["in-rate","in-hours","in-have","in-goal","in-start","in-target"];
  var DEFAULTS = {"in-rate":"3", "in-hours":"2", "in-have":"0", "in-goal":"781.25"};

  // 일회성 항목: {date, label, amount(억, 음수면 지출)} / 정기 지출: {label, amount(억), every:"w"|"m"} / 주보 건너뛸 주: 목요일 ISO
  var once = [], recur = [], skipWeeks = [];
  var last = null;    // 마지막 계산 결과 (이미지 카드용)

  function num(id){ var v = parseFloat($(id).value); return isFinite(v) ? v : 0; }

  /* ---------- 저장 / 복원 ----------
     저장값엔 캐릭터를 안 넣음(캐릭터 탭이 주인). 공유 링크엔 넣어서 다른 기기로 캐릭터까지 넘어가게. */
  function snapshot(withRoster){
    var s = {v:1, skip:$("in-skip").checked ? 1 : 0};
    if (withRoster) s.r = M.chars.toRoster();
    if (once.length) s.o = once.map(function(o){ return [o.date, o.label, o.amount]; });
    if (recur.length) s.e = recur.map(function(x){ return [x.label, x.amount, x.every]; });
    if (skipWeeks.length) s.k = skipWeeks.slice();
    FIELDS.forEach(function(id){ s[id.slice(3)] = $(id).value; });
    return s;
  }

  function applyState(s){
    if (!s || typeof s !== "object") return false;
    // 공유 링크 JSON 은 믿을 수 없으니 길이 · 타입을 제한
    function lab(v){ return String(v != null ? v : "").slice(0, 40); }
    once = Array.isArray(s.o) ? s.o.filter(Array.isArray).slice(0, 50).map(function(o){
      return {date: String(o[0] || ""), label: lab(o[1]), amount: parseFloat(o[2]) || 0};
    }) : [];
    recur = Array.isArray(s.e) ? s.e.filter(Array.isArray).slice(0, 50).map(function(x){
      return {label: lab(x[0]), amount: Math.max(0, parseFloat(x[1]) || 0), every: x[2] === "m" ? "m" : "w"};
    }) : [];
    skipWeeks = Array.isArray(s.k) ? s.k.filter(function(k){ return typeof k === "string" && parseDate(k); }).sort().slice(0, 8) : [];
    FIELDS.forEach(function(id){
      var k = id.slice(3), v = s[k];
      if (typeof v !== "string" && !(typeof v === "number" && isFinite(v))) return;
      if (v === "") return;
      if (id === "in-start" || id === "in-target"){ if (!parseDate(String(v))) return; }
      else if (!isFinite(parseFloat(v)) || !isFinite(+v)) return;   // 숫자 칸엔 숫자로 읽히는 값만
      $(id).value = v;
    });
    if (s.skip !== undefined) $("in-skip").checked = !!s.skip;
    return true;
  }

  function save(){ M.write(M.KEYS.calc, snapshot(false)); }

  function setDefaults(){
    var t = M.today();
    Object.keys(DEFAULTS).forEach(function(id){ $(id).value = DEFAULTS[id]; });
    $("in-start").value = toISO(t);
    $("in-target").value = toISO(addDays(t, 90));
    $("in-skip").checked = true;
    once = []; recur = []; skipWeeks = [];
  }

  /* ---------- cfg — 계산기와 장부가 같이 쓰는 입력 묶음 ---------- */
  function onceByDay(start){
    var map = {}, any = false;
    once.forEach(function(o){
      var d = parseDate(o.date);
      if (!d || !o.amount) return;
      var off = C.dayOffset(start, d);
      if (off < 0 || off >= MAX_DAYS) return;
      map[off] = (map[off] || 0) + o.amount;
      any = true;
    });
    return any ? map : null;
  }

  function cfg(){
    var start = parseDate($("in-start").value);
    if (!start) return null;
    var tot = M.chars.totals(), exp = C.recurTotals(recur);
    return {
      weekly: tot.weekly, monthly: tot.monthly,
      rate: num("in-rate"),
      hours: Math.max(0, Math.min(24, num("in-hours"))),
      skipThu: $("in-skip").checked,
      have: num("in-have"), goal: num("in-goal"), start: start,
      once: onceByDay(start),
      skipWeeks: C.skipOffsets(start, skipWeeks),
      expWeekly: exp.weekly, expMonthly: exp.monthly
    };
  }

  /* ---------- 입력 목록 ---------- */
  // 금액 칸 오른쪽 안에 "억" — 칸이 좁아(70~84px) 바깥 단위 글자를 둘 자리가 없어서 칸 안에 겹쳐 둠
  function amtBox(attrs, ph){
    return '<span class="irow-amt" style="position:relative;display:block">' +
      '<input type="number" step="0.01" ' + attrs + (ph ? ' placeholder="' + ph + '"' : '') + ' style="padding-right:20px">' +
      '<i class="irow-u" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);font-style:normal;font-size:11px;color:var(--muted);pointer-events:none">억</i></span>';
  }
  function renderRecur(){
    var box = $("recur");
    if (!recur.length){ box.innerHTML = '<div class="note">없음. 매주·매월 나가는 돈 (심볼, 경험치 쿠폰 등)</div>'; return; }
    box.innerHTML = "";
    recur.forEach(function(x, idx){
      var r = document.createElement("div");
      r.className = "irow x";
      r.innerHTML =
        '<input type="text" data-xf="label" data-xi="'+idx+'" placeholder="내용" aria-label="내용">' +
        amtBox('min="0" data-xf="amount" data-xi="'+idx+'" aria-label="금액 (억)"') +
        '<select data-xf="every" data-xi="'+idx+'" aria-label="주기"><option value="w">매주 목</option><option value="m">매월 1일</option></select>' +
        '<button class="del" data-xdel="'+idx+'" title="삭제" aria-label="지출 삭제">&times;</button>';
      r.querySelector('[data-xf=label]').value = x.label;
      r.querySelector('[data-xf=amount]').value = x.amount;
      r.querySelector('[data-xf=every]').value = x.every;
      box.appendChild(r);
    });
  }

  function renderOnce(){
    var box = $("once");
    if (!once.length){ box.innerHTML = '<div class="note">없음. 특정 날 한 번 들어오거나 나가는 돈</div>'; return; }
    box.innerHTML = "";
    once.forEach(function(o, idx){
      var r = document.createElement("div");
      r.className = "irow irow-once";   // 폰에선 날짜 + 금액 한 줄, 내용은 아래 줄 (CSS 는 .irow-once)
      r.innerHTML =
        '<input type="date" data-of="date" data-oi="'+idx+'" aria-label="날짜">' +
        '<input type="text" data-of="label" data-oi="'+idx+'" placeholder="내용" aria-label="내용">' +
        amtBox('data-of="amount" data-oi="'+idx+'" aria-label="금액 (억, 수입 +, 지출 −)"', "±") +
        '<button class="del" data-odel="'+idx+'" title="삭제" aria-label="항목 삭제">&times;</button>';
      r.querySelector('[data-of=date]').value = o.date;
      r.querySelector('[data-of=label]').value = o.label;
      var a = r.querySelector('[data-of=amount]');
      a.value = o.amount;
      if (o.amount < 0) a.classList.add("neg");
      box.appendChild(r);
    });
  }

  // 시작일 이후 목요일 8개를 칩으로. 그 밖의 날짜는 상태에서도 지운다 (보이는 것만 적용되게)
  function renderSkipChips(start){
    var thus = C.nextThursdays(start, SKIP_CHIPS).map(toISO);
    skipWeeks = skipWeeks.filter(function(iso){ return thus.indexOf(iso) >= 0; });
    $("skip-chips").innerHTML = thus.map(function(iso){
      var on = skipWeeks.indexOf(iso) >= 0, p = iso.split("-");
      return '<button class="chip strike" type="button" data-skip="'+iso+'" aria-pressed="'+(on ? "true" : "false")+
             '" title="'+iso+' 주간보스 '+(on ? "건너뜀" : "포함")+'">'+(+p[1])+'/'+(+p[2])+'</button>';
    }).join("");
    $("skip-sum").textContent = skipWeeks.length ? "(" + skipWeeks.length + "주 건너뜀)" : "(눌러서 건너뜀)";
  }

  function renderIncome(){
    var list = M.chars.all(), tot = M.chars.totals();
    if (!list.length){
      $("c-income").innerHTML = '<div class="note">캐릭터 없음. 캐릭터 탭에서 등록하면 보스 수입이 합산됨.</div>' +
        '<div class="btns" style="margin-top:10px"><a class="btn sm primary" href="#chars">캐릭터 등록</a></div>';
      return;
    }
    var names = list.slice(0, 4).map(function(c){ return esc(c.name); }).join(", ") + (list.length > 4 ? " 외 " + (list.length - 4) + "명" : "");
    $("c-income").innerHTML = '<div class="income"><div><b>주 ' + fmtFine(tot.weekly) + ', 월 ' + fmtFine(tot.monthly) + '</b>' +
      '<div class="note">' + list.length + '명 (' + names + ')</div></div></div>';
  }

  /* ---------- 그래프 ---------- */
  var chart = null;   // 마지막으로 그린 그래프의 좌표계와 날짜별 항목 (hover 툴팁용)
  var KIND_NAME = {weekly:"주간보스", monthly:"월간보스", hunt:"사냥", once:"일회성", expense:"지출"};
  var KIND_COLOR = {weekly:"var(--gold)", monthly:"var(--gold-dim)", hunt:"var(--violet)", once:"var(--sky)", expense:"var(--orange)"};

  // 실제 픽셀 폭으로 그림 — viewBox 를 고정하면 폰에서 축 글씨가 5px 대로 줄어듦
  function drawChart(c, sim, days, goalIdx){
    var box = $("c-chart");
    if (!box.clientWidth) return;
    var W = Math.round(box.clientWidth), H = W < 480 ? 220 : 280, padL = 46, padR = 10, padT = 12, padB = 26;
    var iw = W - padL - padR, ih = H - padT - padB;
    // 끝값이 아니라 곡선 전체의 최고점 · 최저점으로 잡는다 (일회성 수입 뒤 큰 지출이면 중간 봉우리가 잘리고, 잔고가 음수면 축 밖으로 나감)
    var maxV = Math.max(c.goal, c.have, 1), minV = Math.min(0, c.have);
    sim.pts.forEach(function(p){ if (p.y > maxV) maxV = p.y; if (p.y < minV) minV = p.y; });
    sim.daily.forEach(function(v){ if (v > maxV) maxV = v; if (v < minV) minV = v; });
    var maxY = maxV * 1.08, minY = minV < 0 ? minV * 1.08 : 0;
    function sx(x){ return padL + (x/days)*iw; }
    function sy(y){ return padT + ih - ((y - minY)/(maxY - minY))*ih; }

    // 날짜별로 그날 들어온(나간) 항목을 모은다. 점프는 x=i 에, 사냥은 x=i+1 에 찍혀 있음
    var events = [];
    for (var e = 0; e < days; e++) events.push([]);
    sim.pts.forEach(function(p, i){
      if (i === 0) return;
      var day = p.kind === "hunt" ? p.x - 1 : p.x, amt = p.y - sim.pts[i-1].y;
      if (day >= 0 && day < days && amt !== 0) events[day].push({kind:p.kind, amt:amt});
    });
    chart = {W:W, padL:padL, iw:iw, days:days, start:c.start, daily:sim.daily, events:events, sx:sx, sy:sy};

    var s = ['<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="누적 메소 그래프">'];
    for (var t = 0; t <= 4; t++){
      var val = minY + (maxY - minY)*t/4, y = sy(val);
      s.push('<line class="ch-grid" x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+y.toFixed(1)+'"/>');
      s.push('<text class="ch-lbl" x="'+(padL-8)+'" y="'+(y+4).toFixed(1)+'" text-anchor="end">'+fmtShort(val)+'</text>');
    }
    if (minY < 0){
      s.push('<line class="ch-axis" x1="'+padL+'" y1="'+sy(0).toFixed(1)+'" x2="'+(W-padR)+'" y2="'+sy(0).toFixed(1)+'"/>');
    }
    if (c.goal > 0 && c.goal <= maxY){
      var gy = sy(c.goal);
      s.push('<line x1="'+padL+'" y1="'+gy.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+gy.toFixed(1)+'" style="stroke:var(--mint)" stroke-width="1.2" stroke-dasharray="5 4" opacity=".8"/>');
    }
    var pts = sim.pts;
    var area = "M " + sx(pts[0].x).toFixed(1) + " " + sy(pts[0].y).toFixed(1), segs = [];
    for (var i = 1; i < pts.length; i++){
      var a = pts[i-1], b = pts[i];
      var x1 = sx(a.x), y1 = sy(a.y), x2 = sx(b.x), y2 = sy(b.y);
      area += " L " + x2.toFixed(1) + " " + y2.toFixed(1);
      var col = KIND_COLOR[b.kind] || KIND_COLOR.hunt;
      segs.push('<line x1="'+x1.toFixed(1)+'" y1="'+y1.toFixed(1)+'" x2="'+x2.toFixed(1)+'" y2="'+y2.toFixed(1)+'" style="stroke:'+col+'" stroke-width="'+(b.kind==="hunt"?1.6:2.4)+'" stroke-linecap="round"/>');
    }
    s.push('<defs><linearGradient id="cag" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style="stop-color:var(--violet);stop-opacity:.26"/><stop offset="100%" style="stop-color:var(--violet);stop-opacity:0"/></linearGradient></defs>');
    s.push('<path d="'+area+' L '+sx(pts[pts.length-1].x).toFixed(1)+' '+sy(0).toFixed(1)+' L '+sx(0).toFixed(1)+' '+sy(0).toFixed(1)+' Z" fill="url(#cag)"/>');
    s.push(segs.join(""));
    if (goalIdx >= 0 && goalIdx < days){
      var mx = sx(goalIdx+1);
      s.push('<line x1="'+mx.toFixed(1)+'" y1="'+padT+'" x2="'+mx.toFixed(1)+'" y2="'+(padT+ih)+'" style="stroke:var(--mint)" stroke-width="1" opacity=".45"/>');
      s.push('<circle cx="'+mx.toFixed(1)+'" cy="'+sy(sim.daily[goalIdx]).toFixed(1)+'" r="4.5" style="fill:var(--ink-2);stroke:var(--mint)" stroke-width="2"/>');
    }
    s.push('<line class="ch-axis" x1="'+padL+'" y1="'+(padT+ih)+'" x2="'+(W-padR)+'" y2="'+(padT+ih)+'"/>');
    var ticks = W < 480 ? 3 : 5;
    for (var k = 0; k <= ticks; k++){
      var dn = Math.round(days*k/ticks);
      s.push('<text class="ch-lbl" x="'+sx(dn).toFixed(1)+'" y="'+(padT+ih+18)+'" text-anchor="'+(k === 0 ? "start" : k === ticks ? "end" : "middle")+'">'+
             (dn === 0 ? "시작" : dn+"일")+'</text>');
    }
    s.push('<g id="c-guide" hidden><line y1="'+padT+'" y2="'+(padT+ih)+'" style="stroke:var(--faint)" stroke-width="1" stroke-dasharray="3 3"/>' +
           '<circle r="4" style="fill:var(--ink-2);stroke:var(--text)" stroke-width="1.5"/></g>');
    s.push('</svg><div class="tip" id="c-tip" hidden></div>');
    box.innerHTML = s.join("");
  }

  /* svg 는 그릴 때마다 새로 만들어지므로 이벤트는 #c-chart 에 위임.
     터치는 touch-action:pan-y 라서 세로 스크롤은 살리고 가로로 문지르면 날짜를 훑는다. */
  function labelsFor(kind, date){
    var iso = toISO(date), out = [];
    if (kind === "once") once.forEach(function(o){ if (o.date === iso && o.amount && o.label) out.push(o.label); });
    if (kind === "expense"){
      var thu = date.getDay() === 4, first = date.getDate() === 1;
      recur.forEach(function(x){ if (x.amount > 0 && x.label && ((x.every === "m" && first) || (x.every !== "m" && thu))) out.push(x.label); });
    }
    return out.map(esc).join(", ");
  }

  function showTip(clientX, clientY){
    var svg = $("c-chart").querySelector("svg"), tip = $("c-tip"), guide = $("c-guide");
    if (!chart || !svg || !tip || !guide) return;
    var rect = svg.getBoundingClientRect(), box = $("c-chart").getBoundingClientRect();
    var vx = (clientX - rect.left) / rect.width * chart.W;
    var i = Math.round((vx - chart.padL) / chart.iw * chart.days) - 1;
    i = Math.max(0, Math.min(chart.days - 1, i));
    var date = addDays(chart.start, i), bal = chart.daily[i];

    var gx = chart.sx(i + 1), gy = chart.sy(bal);
    var line = guide.firstChild, dot = guide.lastChild;
    line.setAttribute("x1", gx.toFixed(1)); line.setAttribute("x2", gx.toFixed(1));
    dot.setAttribute("cx", gx.toFixed(1)); dot.setAttribute("cy", gy.toFixed(1));
    guide.removeAttribute("hidden");   // SVG 요소엔 .hidden 프로퍼티가 없음

    var items = chart.events[i];
    tip.innerHTML = '<b>' + (date.getMonth()+1) + '.' + date.getDate() + ' (' + DOW[date.getDay()] + ')' +
      '<small>' + (i + 1) + '일째</small></b>' +
      '<div class="tbal">잔고 ' + fmtEok(bal) + '</div>' +
      (items.length ? '<ul>' + items.map(function(ev){
        var lab = labelsFor(ev.kind, date);
        return '<li><i class="swd" style="background:' + KIND_COLOR[ev.kind] + '"></i>' + KIND_NAME[ev.kind] +
               ' ' + (ev.amt > 0 ? '+' : '−') + fmtFine(Math.abs(ev.amt)) + (lab ? ' <em>' + lab + '</em>' : '') + '</li>';
      }).join("") + '</ul>' : '<div class="dim">들어온 항목 없음</div>');
    tip.hidden = false;

    // 가이드선 왼쪽/오른쪽 중 공간이 있는 쪽에, 세로는 포인터 근처
    var px = (gx / chart.W) * rect.width + (rect.left - box.left);
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var left = px + 14;
    if (left + tw > box.width) left = Math.max(0, px - 14 - tw);
    var top = clientY - box.top + 16;
    if (top + th > box.height) top = Math.max(0, clientY - box.top - th - 12);
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }
  function hideTip(){
    var tip = $("c-tip"), guide = $("c-guide");
    if (tip) tip.hidden = true;
    if (guide) guide.setAttribute("hidden", "");
  }

  /* ---------- 시나리오 ---------- */
  function renderScenarios(c, baseDays){
    var hours = [0,1,2,3,4,5,6];
    if (hours.indexOf(c.hours) < 0 && c.hours > 0 && c.hours <= 24){
      hours.push(c.hours);
      hours.sort(function(a,b){ return a - b; });
    }
    var prev = null;
    $("scen").innerHTML = hours.map(function(h){
      var x = withCfg(c, "hours", h);
      var mTot = monthIncome(x).total;
      var g = c.goal > 0 ? findGoal(x) : {days:-1};
      var days = "—", delta = "", eff = "—";
      if (g.days === 0){ days = "달성"; }
      else if (g.days > 0){
        days = g.days + "일";
        if (baseDays > 0){
          var d = baseDays - g.days;
          delta = d === 0 ? '<span class="d-0">기준</span>'
                : d > 0  ? '<span class="d-up">&minus;' + d + '일</span>'
                         : '<span class="d-dn">+' + (-d) + '일</span>';
        }
        // 직전 구간의 한계 효용 — 사냥 1시간을 더 넣을 때 당겨지는 일수
        if (prev && prev.days > 0 && h > prev.h){
          var per = (prev.days - g.days) / (h - prev.h);
          eff = per > 0 ? '&minus;' + (per >= 10 ? per.toFixed(0) : per.toFixed(1)) + '일' : '—';
        }
      }
      if (g.days > 0) prev = {h:h, days:g.days};
      var isNow = Math.abs(h - c.hours) < 1e-9;
      return '<tr' + (isNow ? ' class="now"' : '') + '>' +
             '<td>' + (h % 1 === 0 ? h : h.toFixed(1)) + '시간' + (isNow ? ' (지금)' : '') + '</td>' +
             '<td>' + fmtEok(mTot) + '</td>' +
             '<td>' + days + (eff !== "—" ? '<span class="cell-sub ph-only">1h당 ' + eff + '</span>' : "") + '</td>' +   // 폰에선 1h당 칸이 숨겨져서 도달 칸 아래 줄로
             '<td>' + delta + '</td><td class="wide">' + eff + '</td></tr>';
    }).join("");
    $("scen-goal").textContent = c.goal > 0 ? "목표 " + fmtEok(c.goal) : "목표 미입력";
  }

  /* ---------- 민감도 ----------
     같은 입력에서 파생되는 두 가지 질문에 답한다.
       (1) 어느 수입원이 도달일을 크게 움직이나  -> ±10% 토네이도
       (2) 도달을 하루 당기는 데 각각 얼마가 드나 -> 이분 탐색            */
  function renderSensitivity(c, baseDays, over){
    var tor = $("tor"), cost = $("cost"), hint = $("tor-hint");
    if (!(baseDays > 0)){
      $("sens-base").textContent = "";
      tor.innerHTML = '<div class="note">도달 가능한 목표가 있어야 계산됨.</div>';
      cost.innerHTML = "";
      hint.hidden = true;
      return;
    }
    $("sens-base").textContent = baseDays + "일 기준";
    function d(key, val){ return findGoal(withCfg(c, key, val)).days; }
    var rows = [
      {name:"주간보스", sub:"±" + fmtFine(c.weekly * 0.1) + "/주", up:d("weekly", c.weekly * 1.1), dn:d("weekly", c.weekly * 0.9)},
      {name:"사냥", sub:"±" + (c.hours * 6).toFixed(0) + "분/일", up:d("hours", c.hours * 1.1), dn:d("hours", c.hours * 0.9)},
      {name:"월간보스", sub:"±" + fmtFine(c.monthly * 0.1) + "/월", up:d("monthly", c.monthly * 1.1), dn:d("monthly", c.monthly * 0.9)}
    ];
    // 목요일 사냥은 켜고 끄는 값이라 한쪽 방향만 존재
    var thuDays = findGoal(withCfg(c, "skipThu", !c.skipThu)).days;
    rows.push({name:"목요일 사냥", sub: c.skipThu ? "지금 쉼" : "지금 함",
               up: c.skipThu ? thuDays : baseDays, dn: c.skipThu ? baseDays : thuDays});

    var span = 0, anyGain = false;
    rows.forEach(function(r){
      r.gain = r.up > 0 ? baseDays - r.up : 0;   // 당겨지는 일수 (+)
      r.loss = r.dn > 0 ? r.dn - baseDays : 0;   // 밀리는 일수 (+)
      if (r.gain > 0) anyGain = true;
      span = Math.max(span, Math.abs(r.gain), Math.abs(r.loss));
    });
    if (span <= 0) span = 1;

    /* 결승선이 목요일 주보 점프에 걸려 있으면 초과분만큼 여유가 생겨서 수익을 늘려도 날짜가 안 바뀐다.
       그때 막대가 전부 0으로 나오는데, 설명이 없으면 "늘려도 소용없다"로 읽혀서 반대로 오해된다. */
    if (!anyGain && over > 0){
      hint.innerHTML = "<b>여유 +" + fmtEok(over) + "</b>: 이만큼 덜 벌어도 같은 날 도달함. " +
        "이 범위에선 수익을 올려도 날짜가 그대로라 '영향 없음'으로 나옴.";
      hint.hidden = false;
    } else {
      hint.hidden = true;
    }

    tor.innerHTML = rows.map(function(r){
      var g = Math.max(0, r.gain) / span * 50, b = Math.max(0, r.loss) / span * 50;
      var val = (r.gain > 0 ? '<b>&minus;' + r.gain + '</b>' : "") + (r.gain > 0 && r.loss > 0 ? " / " : "") +
                (r.loss > 0 ? '<s>+' + r.loss + '</s>' : "") + (r.gain <= 0 && r.loss <= 0 ? '<em>영향 없음</em>' : "일");
      return '<div class="tor-row"><div class="tor-name">' + r.name + '<i>' + r.sub + '</i></div>' +
             '<div class="tor-track"><div class="tor-bar good" style="right:50%;width:' + g.toFixed(1) + '%"></div>' +
             '<div class="tor-bar bad" style="left:50%;width:' + b.toFixed(1) + '%"></div></div>' +
             '<div class="tor-val">' + val + '</div></div>';
    }).join("");

    var huntFactor = DAYS_PER_MONTH * (c.skipThu ? 6/7 : 1);
    var levers = [
      {name:"사냥 시간", key:"hours",
       unit:function(v){ return v < 1 ? "+" + (v*60).toFixed(1) + "분/일" : "+" + v.toFixed(2) + "시간/일"; },
       month:function(v){ return c.rate * v * huntFactor; }},
      {name:"재획 시급", key:"rate", unit:function(v){ return "+" + fmtFine(v) + "/시간"; },
       month:function(v){ return v * c.hours * huntFactor; }},
      {name:"주간보스", key:"weekly", unit:function(v){ return "+" + fmtFine(v) + "/주"; },
       month:function(v){ return v * WEEK_PER_MONTH; }},
      {name:"월간보스", key:"monthly", unit:function(v){ return "+" + fmtFine(v) + "/월"; },
       month:function(v){ return v; }}
    ];
    var results = levers.map(function(l){
      var v = C.costFor1Day(c, l.key, baseDays);
      return {name:l.name, v:v, unit:v === null ? null : l.unit(v), m:v === null ? null : l.month(v)};
    });
    var best = null;
    results.forEach(function(r){ if (r.m !== null && (best === null || r.m < best)) best = r.m; });
    cost.innerHTML = results.map(function(r){
      if (r.v === null) return '<tr><td>' + r.name + '</td><td colspan="2" class="dim">이 목표에선 못 움직임</td></tr>';
      var cheap = best !== null && r.m <= best * 1.02;
      return '<tr' + (cheap ? ' class="cheap"' : '') + '><td>' + r.name + '</td><td>' + r.unit + '</td><td>' + fmtEok(r.m) + '/월</td></tr>';
    }).join("");
  }

  /* ---------- 장부에서 가져오기 ---------- */
  function ledgerFacts(){
    var L = M.ledger.compute(), ws = M.ledger.windowStats(L);
    return {bal: L.last ? L.bal : null, last: L.last, rate: ws && ws.rate ? ws.rate : null};
  }
  // 장부 버튼이 채운 값을 필드 아래 한 줄로 알려줌. 사용자가 그 칸을 직접 고치면 낡은 안내라 지움
  function fillNote(inputId, text){
    var input = $(inputId), field = input.closest(".field");
    if (!field) return;
    var n = field.nextElementSibling;
    if (!n || !n.classList.contains("fill-note")){
      n = document.createElement("div");
      n.className = "note fill-note";
      n.style.textAlign = "right";
      n.setAttribute("aria-live", "polite");
      field.parentNode.insertBefore(n, field.nextSibling);
    }
    n.textContent = text;
  }
  function clearFillNote(inputId){
    var field = $(inputId).closest(".field"), n = field && field.nextElementSibling;
    if (n && n.classList.contains("fill-note")) n.remove();
  }

  function renderLedgerButtons(){
    var f = ledgerFacts(), b = $("btn-ledger"), r = $("btn-ledger-rate");
    b.hidden = f.bal === null;
    // 잔고는 마지막 기록일 마감 기준이라 시작일은 그 다음 날 (계산기는 시작일 당일 수익부터 더함)
    if (f.bal !== null) b.title = "장부 잔고 " + fmtEok(f.bal) + " (" + f.last + " 마감). 시작일은 다음 날로";
    r.hidden = !f.rate;
    if (f.rate) r.title = "장부 최근 28일 실측 시급 " + fmtFine(f.rate);
  }

  /* ---------- render ---------- */
  function hitStr(d){ return d.getFullYear() + "." + (d.getMonth() + 1) + "." + d.getDate(); }

  function render(){
    var c = cfg();
    if (!c) return;
    var target = parseDate($("in-target").value);

    renderIncome();
    renderLedgerButtons();
    renderSkipChips(c.start);
    c.skipWeeks = C.skipOffsets(c.start, skipWeeks);

    var oIn = 0, oOut = 0;
    once.forEach(function(o){ if (o.amount > 0) oIn += o.amount; else oOut -= o.amount; });
    $("once-sum").textContent = once.length
      ? (oIn ? "+" + fmtFine(oIn) : "") + (oIn && oOut ? ", " : "") + (oOut ? "−" + fmtFine(oOut) : "") || "0" : "";
    $("legend-once").hidden = !c.once;
    $("legend-expense").hidden = !(c.expWeekly || c.expMonthly);

    var inc = monthIncome(c), mGross = inc.weekly + inc.monthly + inc.hunt;
    $("recur-sum").textContent = recur.length ? (inc.expense ? "월 −" + fmtFine(inc.expense) : "0") : "";
    $("out-month").textContent = fmtEok(inc.total);
    var pct = function(v){ return mGross > 0 ? Math.round(v / mGross * 100) : 0; };
    $("out-day").innerHTML = "주보 " + pct(inc.weekly) + "%, 사냥 " + pct(inc.hunt) + "%, 월보 " + pct(inc.monthly) + "%" +
      (inc.expense ? "<br>지출 −" + fmtEok(inc.expense) + " 차감" : "");

    var g = c.goal > 0 ? findGoal(c) : {days:-2};
    var span = (target && target >= c.start) ? Math.round((target - c.start)/86400000) + 1 : 0;
    var chartDays = Math.min(MAX_DAYS, Math.max(span, g.days > 0 ? Math.ceil(g.days*1.12) : 60, 30));
    var sim = simulate(c, chartDays);

    /* 도달은 "며칠"보다 "언제"가 고정값이다. 시작일을 미루면 일수는 줄지만
       끝나는 날짜는 그대로이거나 오히려 늦어진다. 그래서 날짜를 주역으로 둔다. */
    var over = 0;
    last = null;
    if (g.days === -2){
      $("out-date").textContent = "—";
      $("out-days").textContent = "목표 메소 입력 필요";
    } else if (g.days === 0){
      $("out-date").textContent = "이미 달성";
      $("out-days").textContent = "보유 메소가 목표 이상";
    } else if (g.days < 0){
      $("out-date").textContent = "—";
      $("out-days").textContent = M.chars.all().length ? "수익이 없어 도달 불가" : "캐릭터 등록 또는 사냥 수익 입력 필요";
    } else {
      var hitDate = addDays(c.start, g.days - 1);
      var isThu = hitDate.getDay() === 4 && c.weekly > 0;
      over = sim.daily[g.days - 1] - c.goal;
      $("out-date").innerHTML = hitDate.getFullYear() + ". " + (hitDate.getMonth() + 1) + ". " + hitDate.getDate() +
        '<small' + (isThu ? ' class="thu" title="주간보스가 들어오는 날. 그 주에 못 돌면 도달이 일주일 밀림"' : '') +
        '>(' + DOW[hitDate.getDay()] + ')</small>';
      // 건너뛴 주가 있으면 그게 없을 때와 비교해 며칠 밀렸는지
      var skipNote = "", pushed = 0;
      if (c.skipWeeks){
        var g0 = findGoal(withCfg(c, "skipWeeks", null)).days, n = Object.keys(c.skipWeeks).length;
        pushed = g0 > 0 ? g.days - g0 : 0;
        skipNote = ", 건너뛴 주 " + n + "개로 " + (pushed > 0 ? "+" + pushed + "일" : "변동 없음");
      }
      last = {hitDate:hitDate, days:g.days, goal:c.goal, inc:inc,
              skipN: c.skipWeeks ? Object.keys(c.skipWeeks).length : 0, pushed: pushed || 0,
              url: location.host ? location.host + location.pathname.replace(/index\.html$/, "") : "yh-yeop.github.io/meso_calcul/"};
      $("out-days").innerHTML = "<b>" + g.days + "일 뒤</b>, 목표 " + fmtEok(c.goal) +
        ', 여유 +' + fmtEok(over) + skipNote;
    }

    if (span > 0){
      var used = Math.min(span, sim.daily.length), bal = sim.daily[used - 1], diff = bal - c.goal;   // MAX_DAYS 를 넘는 날짜면 실제로 계산된 일수만큼
      $("out-bal").textContent = fmtEok(bal);
      $("out-bal-sub").textContent = used + "일간, 목표 대비 " + (diff >= 0 ? "+" : "") + fmtEok(diff);
    } else {
      $("out-bal").textContent = "—";
      $("out-bal-sub").textContent = "목표 날짜는 시작일 이후여야 함";
    }

    drawChart(c, sim, chartDays, g.days > 0 ? g.days - 1 : -1);
    // 그래프 아래 한 줄 요약 — 그림을 못 보는 경우 · 스크린리더용
    var cs = $("chart-sum");
    if (cs){
      var sumHit = g.days === 0 ? "이미 달성" : g.days > 0 ? "도달 " + hitStr(addDays(c.start, g.days - 1)) : "도달 불가";
      cs.textContent = g.days === -2 ? "" : sumHit + (span > 0 ? ", 목표일 잔고 " + fmtEok(sim.daily[Math.min(span, sim.daily.length) - 1]) : "");
    }
    renderScenarios(c, g.days);
    renderSensitivity(c, g.days, over);
  }

  // 입력이 바뀌면 저장하고 알림 — 장부 계획 곡선 · 홈 목표 카드가 같이 바뀜
  function changed(){ save(); render(); M.emit("change", "calc"); }

  /* ---------- 결과 카드 이미지 ----------
     마지막 render 결과를 캔버스에 그려 PNG 로 내보낸다. 테마와 무관하게 다크 카드로 고정 */
  var CARD = {ink:"#111112", panel:"#19191B", line:"#34343A", text:"#EDEDEF", dim:"#A1A1A8", faint:"#8E8E96",
              gold:"#E9B949", goldDim:"#8A6E2C", violet:"#9AA6F0", rose:"#E8639B", mint:"#4FD1AA", orange:"#F2784B"};
  var SANS = '"Pretendard",-apple-system,BlinkMacSystemFont,"Segoe UI","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
  var MONO = '"SF Mono",ui-monospace,"JetBrains Mono",Menlo,Consolas,"D2Coding",monospace';

  function roundRect(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function fitText(ctx, text, maxW, size, family, weight){
    var sz = size;
    do {
      ctx.font = (weight || "400") + " " + sz + "px " + family;
      if (ctx.measureText(text).width <= maxW) break;
      sz -= 2;
    } while (sz > 18);
    return sz;
  }

  function renderCard(r){
    var W = 1080, H = 760, P = 80;
    var cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    var ctx = cv.getContext("2d");
    ctx.fillStyle = CARD.ink; ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = "alphabetic";

    var eb = "메소 적립 계산기";
    ctx.fillStyle = CARD.gold; ctx.font = "500 24px " + MONO;
    ctx.fillText(eb, P, P + 22);
    var ebW = ctx.measureText(eb).width;
    var g = ctx.createLinearGradient(P + ebW + 20, 0, W - P, 0);
    g.addColorStop(0, CARD.goldDim); g.addColorStop(1, "rgba(138,110,44,0)");
    ctx.fillStyle = g; ctx.fillRect(P + ebW + 20, P + 13, W - P * 2 - ebW - 20, 2);

    var d = r.hitDate;
    var dateStr = d.getFullYear() + "." + String(d.getMonth()+1).padStart(2,"0") + "." + String(d.getDate()).padStart(2,"0");
    ctx.fillStyle = CARD.text;
    var ds = fitText(ctx, dateStr + " (목)", W - P * 2, 108, MONO, "600");
    ctx.fillText(dateStr, P, P + 150);
    var dw = ctx.measureText(dateStr).width;
    ctx.fillStyle = d.getDay() === 4 ? CARD.gold : CARD.dim;
    ctx.font = "500 " + Math.round(ds * 0.42) + "px " + MONO;
    ctx.fillText("(" + DOW[d.getDay()] + ")", P + dw + 14, P + 150);

    var sub = r.days + "일 뒤, 목표 " + fmtEok(r.goal) + (r.skipN ? ", 건너뛴 주 " + r.skipN + "개로 +" + r.pushed + "일" : "");
    ctx.fillStyle = CARD.dim;
    fitText(ctx, sub, W - P * 2, 32, SANS, "400");
    ctx.fillText(sub, P, P + 206);

    var by = P + 268, bh = 260, bw = W - P * 2;
    ctx.save(); roundRect(ctx, P, by, bw, bh, 22); ctx.fillStyle = CARD.panel; ctx.fill(); ctx.restore();
    ctx.fillStyle = CARD.dim; ctx.font = "500 26px " + SANS;
    ctx.fillText("월 순수익", P + 40, by + 58);
    var inc = r.inc, gross = inc.weekly + inc.monthly + inc.hunt;
    ctx.fillStyle = CARD.text;
    var vs = fitText(ctx, fmtEok(inc.total), bw - 80, 76, MONO, "600");
    ctx.fillText(fmtEok(inc.total), P + 40, by + 140);
    if (inc.expense){
      var vw = ctx.measureText(fmtEok(inc.total)).width;
      ctx.fillStyle = CARD.orange; ctx.font = "400 " + Math.round(vs * 0.36) + "px " + MONO;
      ctx.fillText("지출 −" + fmtEok(inc.expense) + " 차감", P + 40 + vw + 18, by + 140);
    }
    var barY = by + 176, barH = 14, barW = bw - 80, x = P + 40;
    var parts = [{v:inc.weekly, c:CARD.gold, n:"주보"}, {v:inc.hunt, c:CARD.violet, n:"사냥"}, {v:inc.monthly, c:CARD.rose, n:"월보"}];
    ctx.save(); roundRect(ctx, x, barY, barW, barH, 7); ctx.clip();
    ctx.fillStyle = CARD.line; ctx.fillRect(x, barY, barW, barH);
    parts.forEach(function(pt){
      var w = gross > 0 ? barW * pt.v / gross : 0;
      ctx.fillStyle = pt.c; ctx.fillRect(x, barY, w, barH); x += w;
    });
    ctx.restore();
    var lx = P + 40, ly = barY + 52;
    ctx.font = "400 24px " + SANS;
    parts.forEach(function(pt){
      var pc = gross > 0 ? Math.round(pt.v / gross * 100) : 0;
      ctx.fillStyle = pt.c; ctx.beginPath(); ctx.arc(lx + 8, ly - 8, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = CARD.dim;
      var t = pt.n + " " + pc + "%, " + fmtEok(pt.v);
      ctx.fillText(t, lx + 26, ly);
      lx += 26 + ctx.measureText(t).width + 34;
    });
    ctx.fillStyle = CARD.faint; ctx.font = "400 22px " + MONO;
    ctx.fillText(r.url, P, H - P + 14);
    return new Promise(function(res){ cv.toBlob(res, "image/png"); });
  }

  function flash(btn, text){
    var old = btn.dataset.label || btn.textContent;
    btn.dataset.label = old;
    btn.textContent = text;
    btn.classList.add("ok");
    setTimeout(function(){ btn.textContent = old; btn.classList.remove("ok"); }, 1600);
  }
  function download(blob, name, btn){
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
    flash(btn, "저장됨");
  }

  /* ---------- events ---------- */
  FIELDS.forEach(function(id){ $(id).addEventListener("input", changed); });
  $("in-skip").addEventListener("change", changed);
  $("recur").addEventListener("input", function(e){
    var t = e.target;
    if (t.dataset.xf === undefined) return;
    var i = +t.dataset.xi, f = t.dataset.xf;
    if (f === "amount") recur[i].amount = Math.max(0, parseFloat(t.value) || 0);
    else recur[i][f] = t.value;
    changed();
  });
  $("recur").addEventListener("change", function(e){ if (e.target.dataset.xf === "every") changed(); });
  $("recur").addEventListener("click", function(e){
    var d = e.target.closest("[data-xdel]");
    if (!d) return;
    recur.splice(+d.dataset.xdel, 1);
    renderRecur(); changed();
  });
  $("btn-recur-add").addEventListener("click", function(){
    recur.push({label:"", amount:0, every:"w"});
    renderRecur(); changed();
    var last = $("recur").querySelector(".irow:last-child [data-xf=label]");
    if (last) last.focus();
  });
  $("once").addEventListener("input", function(e){
    var t = e.target;
    if (t.dataset.of === undefined) return;
    var i = +t.dataset.oi, f = t.dataset.of;
    if (f === "amount"){ once[i].amount = parseFloat(t.value) || 0; t.classList.toggle("neg", once[i].amount < 0); }
    else once[i][f] = t.value;
    changed();
  });
  $("once").addEventListener("click", function(e){
    var d = e.target.closest("[data-odel]");
    if (!d) return;
    once.splice(+d.dataset.odel, 1);
    renderOnce(); changed();
  });
  $("btn-once-add").addEventListener("click", function(){
    var start = parseDate($("in-start").value) || M.today();
    once.push({date: toISO(addDays(start, 7)), label: "", amount: 0});
    renderOnce(); changed();
    var last = $("once").querySelector(".irow:last-child [data-of=label]");
    if (last) last.focus();
  });
  $("skip-chips").addEventListener("click", function(e){
    var b = e.target.closest("[data-skip]");
    if (!b) return;
    var iso = b.dataset.skip, i = skipWeeks.indexOf(iso);
    if (i >= 0) skipWeeks.splice(i, 1); else skipWeeks.push(iso);
    skipWeeks.sort();
    changed();
    var nb = $("skip-chips").querySelector('[data-skip="'+iso+'"]');
    if (nb) nb.focus();
  });
  $("btn-today").addEventListener("click", function(){ $("in-start").value = toISO(M.today()); changed(); });
  $("btn-ledger").addEventListener("click", function(){
    var f = ledgerFacts();
    if (f.bal === null) return;
    // 복원한 백업에 깨진 날짜가 있을 수 있어서, 입력을 건드리기 전에 먼저 확인
    var lastD = parseDate(f.last);
    if (!lastD){ M.toast("장부 마지막 기록 날짜를 못 읽음"); return; }
    var st = addDays(lastD, 1), tg = parseDate($("in-target").value);
    $("in-have").value = M.round(f.bal, 4);
    $("in-start").value = toISO(st);
    if (!tg || tg < st) $("in-target").value = toISO(addDays(st, 90));
    changed();
    fillNote("in-have", "장부 잔고 " + fmtEok(f.bal) + "로 채움");
    M.toast("장부 잔고 " + fmtEok(f.bal) + "로 시작 (" + M.md(st) + "부터)");
  });
  $("btn-ledger-rate").addEventListener("click", function(){
    var f = ledgerFacts();
    if (!f.rate) return;
    $("in-rate").value = M.round(f.rate, 2);
    changed();
    fillNote("in-rate", "장부 최근 28일 시급 " + fmtFine(f.rate) + "로 채움");
  });
  $("in-have").addEventListener("input", function(){ clearFillNote("in-have"); });
  $("in-rate").addEventListener("input", function(){ clearFillNote("in-rate"); });

  $("c-chart").addEventListener("pointermove", function(e){ showTip(e.clientX, e.clientY); });
  $("c-chart").addEventListener("pointerdown", function(e){ showTip(e.clientX, e.clientY); });
  $("c-chart").addEventListener("pointerleave", hideTip);
  $("c-chart").addEventListener("pointercancel", hideTip);

  $("btn-share").addEventListener("click", function(){
    var btn = this;
    var url = location.origin + location.pathname + "#s=" + C.b64e(JSON.stringify(snapshot(true)));
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(function(){ flash(btn, "복사됨"); }, function(){ prompt("이 주소 복사할 것", url); });
    } else {
      prompt("이 주소 복사할 것", url);
    }
  });
  $("btn-image").addEventListener("click", function(){
    var btn = this;
    if (!last){ flash(btn, "도달 날짜가 있어야 함"); return; }
    renderCard(last).then(function(blob){
      if (!blob){ flash(btn, "실패"); return; }
      var name = "meso-" + toISO(last.hitDate) + ".png", file = null;
      try{ file = new File([blob], name, {type:"image/png"}); } catch(e){}
      // 모바일은 공유 시트, 그 외는 다운로드
      if (file && M.coarse() && navigator.canShare && navigator.canShare({files:[file]})){
        navigator.share({files:[file]}).then(function(){ flash(btn, "공유됨"); },
                                             function(err){ if (err && err.name !== "AbortError") download(blob, name, btn); });
        return;
      }
      download(blob, name, btn);
    });
  });

  /* ---------- init ---------- */
  setDefaults();
  applyState(M.read(M.KEYS.calc));
  renderOnce();
  renderRecur();

  return {
    render:render, cfg:cfg,
    // 공유 링크(#s=…) — 계산기 입력과 캐릭터를 링크 것으로
    applyShare:function(s, withChars){
      if (!s || typeof s !== "object") return false;
      setDefaults();
      applyState(s);
      // 캐릭터를 덮어쓰는 건 사용자가 허락했을 때만 (app.js 가 물어보고 넘김)
      if (withChars && Array.isArray(s.r)) M.chars.replaceFromRoster(s.r);
      renderOnce(); renderRecur(); changed();
      return true;
    },
    // 다른 계산기에서 목표만 넘겨받는 진입점: #goal=781.25 (억)
    applyGoal:function(v){ $("in-goal").value = v; changed(); $("in-goal").focus(); },
    reset:function(){ setDefaults(); renderOnce(); renderRecur(); changed(); },
    // 다른 기기에서 받은 값으로 다시 읽음 — 저장 · 알림은 안 함 (받은 걸 그대로 다시 올리지 않게)
    reload:function(){ setDefaults(); applyState(M.read(M.KEYS.calc)); renderOnce(); renderRecur(); render(); },
    getState:function(){ return snapshot(false); },
    setState:function(s){ setDefaults(); applyState(s); renderOnce(); renderRecur(); changed(); },
    renderCard:function(){ return last ? renderCard(last) : Promise.resolve(null); }
  };
})(Meso);
