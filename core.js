/* 계산기 순수 계산 로직. DOM을 만지지 않는다.
   브라우저에서는 <script src="core.js"> 로 전역 MesoCore, Node(test/core.test.js)에서는 require 로 쓴다. */
var MesoCore = (function(){
  "use strict";

  var WEEK_PER_MONTH = 365.2425 / 12 / 7;
  var DAYS_PER_MONTH = 365.2425 / 12;
  var MAX_DAYS = 3650;

  /* ---------- paste parser ----------
     maplescouter 캐릭터 목록을 통째로 긁으면 캐릭터마다 이런 블록이 나옴:

       #1제네시스 2차 해방
       베라
       호야시치            <- 이름 (Lv. 줄 바로 위)
       Lv.289 소마
       57,101
       주간수익
       2,131,700,000       <- 원 단위 메소
       월간수익
       665,000,000
       🪙 12 / sole 1.51 / de 16   <- 뒤에 붙는 잡다한 숫자

     그래서 #N 으로 블록을 자르고, 블록 안에서 주간수익/월간수익 라벨
     바로 뒤 숫자만 읽는다. 앞뒤 UI 텍스트는 자연스럽게 버려짐.       */

  // "2,131,700,000"(원) / "21억 3170만" / "21.317"(억) 을 전부 억 단위로
  function parseMeso(s){
    s = String(s).trim();
    var me = s.match(/([\d,]+(?:\.\d+)?)\s*억/);
    var mm = s.match(/([\d,]+(?:\.\d+)?)\s*만/);
    if (me || mm){
      return (me ? parseFloat(me[1].replace(/,/g,"")) : 0) +
             (mm ? parseFloat(mm[1].replace(/,/g,"")) : 0) / 10000;
    }
    var plain = s.match(/^([\d,]+(?:\.\d+)?)$/);
    if (!plain) return null;
    var v = parseFloat(plain[1].replace(/,/g,""));
    if (!isFinite(v)) return null;
    // 사이트는 메소를 원 단위로 찍음. 주 수익이 1만억일 리도, 1만 메소일 리도 없음
    return v >= 10000 ? v / 1e8 : v;
  }

  // from 부터 몇 줄 안에서 처음 나오는 숫자
  function nextMeso(lines, from){
    for (var i = from; i < lines.length && i < from + 3; i++){
      var v = parseMeso(lines[i]);
      if (v !== null) return v;
    }
    return 0;
  }

  function readBlock(block){
    var name = "", weekly = 0, monthly = 0;
    for (var i = 0; i < block.length; i++){
      var l = block[i];
      if (!name && i > 0 && /^Lv\.?\s*\d+/i.test(l)) name = block[i-1];
      if (/주간\s*수익/.test(l))      weekly  = nextMeso(block, i+1);
      else if (/월간\s*수익/.test(l)) monthly = nextMeso(block, i+1);
    }
    if (!name) name = block[2] || block[1] || "";
    return {name:name.replace(/^#\d+\s*/, ""), weekly:weekly, monthly:monthly};
  }

  // 라벨-값 쌍만 있는 형식 (정산표 일부만 긁었을 때)
  function readPairs(lines){
    var chars = [], pend = {}, mode = null;
    lines.forEach(function(line){
      if (/합계/.test(line)){ mode = null; return; }
      if (/주간/.test(line) && /수익/.test(line)){ mode = "weekly";  return; }
      if (/월간/.test(line) && /수익/.test(line)){ mode = "monthly"; return; }
      if (!mode) return;
      var v = parseMeso(line);
      if (v === null) return;
      pend[mode] = v;
      mode = null;
      if (pend.weekly !== undefined && pend.monthly !== undefined){
        chars.push({name:"", weekly:pend.weekly, monthly:pend.monthly});
        pend = {};
      }
    });
    return chars;
  }

  function parsePaste(text){
    var lines = text.split(/\r?\n/).map(function(l){ return l.trim(); }).filter(Boolean);

    var starts = [];
    lines.forEach(function(l, i){ if (/^#\d+/.test(l)) starts.push(i); });

    if (starts.length){
      return starts.map(function(s, k){
        return readBlock(lines.slice(s, k + 1 < starts.length ? starts[k+1] : lines.length));
      }).filter(function(c){ return c.weekly > 0 || c.monthly > 0; });
    }
    return readPairs(lines);
  }

  /* parsePaste 가 빈 배열을 돌려줬을 때, 텍스트에서 어떤 단서를 찾았는지.
     사이트 형식이 바뀌면 어디서 막혔는지 바로 보이게 한다. */
  function diagnosePaste(text){
    var lines = String(text || "").split(/\r?\n/).map(function(l){ return l.trim(); }).filter(Boolean);
    var d = {lines:lines.length, blocks:0, weeklyLabels:0, monthlyLabels:0,
             weeklyValues:0, monthlyValues:0, levelLines:0, numbers:0, hints:[]};
    lines.forEach(function(l, i){
      if (/^#\d+/.test(l)) d.blocks++;
      if (/^Lv\.?\s*\d+/i.test(l)) d.levelLines++;
      if (parseMeso(l) !== null) d.numbers++;
      var w = /주간\s*수익/.test(l), m = !w && /월간\s*수익/.test(l);
      if (w){ d.weeklyLabels++;  if (hasMesoAfter(lines, i+1)) d.weeklyValues++; }
      if (m){ d.monthlyLabels++; if (hasMesoAfter(lines, i+1)) d.monthlyValues++; }
    });
    var h = d.hints;
    if (!d.lines){
      h.push("빈 텍스트");
    } else if (!d.weeklyLabels && !d.monthlyLabels){
      h.push("'주간수익'·'월간수익' 라벨이 없음 — 캐릭터 목록이 아닌 곳을 긁은 듯함" +
             (d.numbers ? " (숫자 줄 " + d.numbers + "개는 있음)" : ""));
    } else {
      if (d.weeklyLabels && !d.weeklyValues)
        h.push("'주간수익' 라벨 " + d.weeklyLabels + "개 뒤 3줄 안에서 숫자를 못 읽음 — 라벨과 값이 같은 줄에 있거나 형식이 바뀐 듯함");
      if (d.monthlyLabels && !d.monthlyValues)
        h.push("'월간수익' 라벨 " + d.monthlyLabels + "개 뒤 3줄 안에서 숫자를 못 읽음");
      if (d.weeklyValues && !d.monthlyLabels)
        h.push("'월간수익' 라벨이 없어 주간·월간 쌍을 못 만듦 — 월간보스가 0이어도 라벨까지 같이 긁어야 함");
      if (d.blocks && d.weeklyValues + d.monthlyValues > 0)
        h.push("#N 블록 " + d.blocks + "개는 찾았지만 수익이 전부 0 — 0인 캐릭터는 제외됨");
      else if (!d.blocks && d.weeklyValues && d.monthlyValues)
        h.push("#N 블록 없이 라벨-값 쌍만 있는데 짝이 안 맞음 — 주간·월간이 번갈아 나와야 함");
    }
    d.summary = "#N 블록 " + d.blocks + "개 · '주간수익' " + d.weeklyLabels + "개(값 " + d.weeklyValues +
                ") · '월간수익' " + d.monthlyLabels + "개(값 " + d.monthlyValues + ") · Lv 줄 " + d.levelLines + "개";
    return d;
  }
  function hasMesoAfter(lines, from){
    for (var i = from; i < lines.length && i < from + 3; i++) if (parseMeso(lines[i]) !== null) return true;
    return false;
  }

  function fmtEok(v){
    if (!isFinite(v)) return "—";
    var neg = v < 0; v = Math.abs(v); var out;
    if (v >= 10000){
      var jo = Math.floor(v/10000), rest = Math.round(v - jo*10000);
      if (rest >= 10000){ jo += 1; rest -= 10000; }   // 9999.6억 이 반올림되면 "9조 10,000억" 이 되므로 올림
      out = jo + "조" + (rest > 0 ? " " + rest.toLocaleString("ko-KR") + "억" : "");
    } else {
      out = v.toLocaleString("ko-KR", {maximumFractionDigits: v < 100 ? 1 : 0}) + "억";
    }
    return (neg ? "-" : "") + out;
  }
  function fmtShort(v){
    if (v >= 10000) return (v/10000).toFixed(1) + "조";
    return Math.round(v).toLocaleString("ko-KR");
  }
  var DOW = ["일","월","화","수","목","금","토"];
  function parseDate(str){
    if (!str) return null;
    var p = str.split("-"); if (p.length !== 3) return null;
    var d = new Date(+p[0], +p[1]-1, +p[2]);
    // 2026-13-99 같은 값은 Date가 다음 해로 넘겨 버리므로 되돌려 확인한다
    if (isNaN(d.getTime()) || d.getMonth() !== +p[1]-1 || d.getDate() !== +p[2]) return null;
    return d;
  }
  function toISO(d){
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" +
           String(d.getDate()).padStart(2,"0");
  }
  function addDays(d,n){ var x = new Date(d.getTime()); x.setDate(x.getDate()+n); return x; }
  function dayOffset(start, d){ return Math.round((d - start) / 86400000); }

  // 시작일 이후(당일 포함) 다가오는 목요일 n개
  function nextThursdays(start, n){
    var out = [], d = new Date(start.getTime());
    d.setDate(d.getDate() + ((4 - d.getDay()) + 7) % 7);
    for (var i = 0; i < n; i++){ out.push(d); d = addDays(d, 7); }
    return out;
  }
  // 건너뛸 주(ISO 날짜 배열)를 simulate 가 쓰는 {dayOffset:true} 집합으로. 시작일 이전은 버림
  function skipOffsets(start, isoList){
    var map = null;
    (isoList || []).forEach(function(iso){
      var d = parseDate(iso); if (!d) return;
      var off = dayOffset(start, d);
      if (off < 0 || off >= MAX_DAYS) return;
      if (!map) map = {};
      map[off] = true;
    });
    return map;
  }

  // 정기 지출 [{label, amount(억), every:"w"|"m"}] 을 주기별 합계로
  function recurTotals(list){
    var w = 0, m = 0;
    (list || []).forEach(function(r){
      var a = parseFloat(r.amount);
      if (!isFinite(a) || a <= 0) return;
      if (r.every === "m") m += a; else w += a;
    });
    return {weekly:w, monthly:m};
  }

  /* ---------- simulation ----------
     cfg: weekly, monthly, rate, hours, skipThu, have, goal, start
          once       {dayOffset: 억}    일회성 (음수 = 지출)
          skipWeeks  {dayOffset: true}  그 목요일의 주보를 0으로 (skipThu 와 별개)
          expWeekly  억                 매주 목요일 나가는 정기 지출
          expMonthly 억                 매월 1일 나가는 정기 지출                  */
  // light = 그래프용 배열을 안 만들고 도달 시점에서 바로 끊음 (시나리오 표에서 8번 돌아서)
  function simulate(cfg, days, light){
    var pts = light ? null : [{x:0, y:cfg.have, kind:"start"}];
    var daily = [], run = cfg.have, hit = -1;
    var expW = cfg.expWeekly || 0, expM = cfg.expMonthly || 0;
    var d = new Date(cfg.start.getTime());
    for (var i = 0; i < days; i++){
      var isThu = d.getDay() === 4, isFirst = d.getDate() === 1;
      var skipped = isThu && cfg.skipWeeks && cfg.skipWeeks[i];
      if (isThu && cfg.weekly !== 0 && !skipped){ run += cfg.weekly; if (pts) pts.push({x:i,y:run,kind:"weekly"}); }
      if (isFirst && cfg.monthly !== 0){ run += cfg.monthly; if (pts) pts.push({x:i,y:run,kind:"monthly"}); }
      // 일회성 항목: 시작일 기준 i일째에 들어오는(또는 나가는) 돈. cfg.once = {dayOffset: 억}
      if (cfg.once && cfg.once[i]){ run += cfg.once[i]; if (pts) pts.push({x:i,y:run,kind:"once"}); }
      var exp = (isThu ? expW : 0) + (isFirst ? expM : 0);
      if (exp){ run -= exp; if (pts) pts.push({x:i,y:run,kind:"expense"}); }
      run += (isThu && cfg.skipThu) ? 0 : cfg.rate * cfg.hours;
      if (pts) pts.push({x:i+1, y:run, kind:"hunt"});
      if (!light) daily.push(run);
      if (hit < 0 && run >= cfg.goal){
        hit = i;
        if (light) return {pts:null, daily:daily, hitIndex:hit, end:run};
      }
      d = addDays(d, 1);
    }
    return {pts:pts, daily:daily, hitIndex:hit, end:run};
  }

  function findGoal(cfg){
    var perDay = cfg.weekly/7 + cfg.monthly/DAYS_PER_MONTH +
                 cfg.rate*cfg.hours*(cfg.skipThu ? 6/7 : 1) -
                 (cfg.expWeekly || 0)/7 - (cfg.expMonthly || 0)/DAYS_PER_MONTH;
    if (cfg.have >= cfg.goal) return {days:0};
    var hasOnce = false;
    if (cfg.once) for (var k in cfg.once) if (cfg.once[k] > 0){ hasOnce = true; break; }
    if (perDay <= 0 && !hasOnce) return {days:-1};
    var est = perDay > 0 ? Math.ceil((cfg.goal - cfg.have)/perDay) + 40 : MAX_DAYS;
    var span = Math.min(MAX_DAYS, Math.max(est, 60));
    var sim = simulate(cfg, span, true);
    if (sim.hitIndex < 0 && span < MAX_DAYS) sim = simulate(cfg, MAX_DAYS, true);
    return sim.hitIndex < 0 ? {days:-1} : {days:sim.hitIndex + 1};
  }

  // expense 는 양수(나가는 크기), total 은 그걸 뺀 순수익
  function monthIncome(cfg){
    var inc = {
      weekly:  cfg.weekly * WEEK_PER_MONTH,
      monthly: cfg.monthly,
      hunt:    cfg.rate * cfg.hours * DAYS_PER_MONTH * (cfg.skipThu ? 6/7 : 1),
      expense: (cfg.expWeekly || 0) * WEEK_PER_MONTH + (cfg.expMonthly || 0)
    };
    inc.total = inc.weekly + inc.monthly + inc.hunt - inc.expense;
    return inc;
  }

  // cfg 복사본에서 키 하나만 바꾼다 (once 같은 부가 필드도 그대로 따라감)
  function withCfg(cfg, key, val){
    var c = {};
    for (var k in cfg) c[k] = cfg[k];
    c[key] = val;
    return c;
  }

  // 잔고 곡선은 어느 입력에 대해서도 단조라 도달일도 단조. 이분 탐색이 성립함
  function costFor1Day(cfg, key, baseDays){
    if (!(baseDays > 1)) return null;
    var cur = cfg[key];
    var hi = Math.max(Math.abs(cur), 1) * 0.02, lo = 0, n = 0;
    while (findGoal(withCfg(cfg, key, cur + hi)).days > baseDays - 1){
      lo = hi; hi *= 2;
      if (++n > 30) return null;          // 아무리 올려도 안 줄면 무의미한 레버
    }
    for (var i = 0; i < 26; i++){
      var mid = (lo + hi) / 2;
      if (findGoal(withCfg(cfg, key, cur + mid)).days <= baseDays - 1) hi = mid; else lo = mid;
    }
    return hi;
  }

  function fmtFine(v){
    if (v >= 0.1) return (+v.toFixed(2)) + "억";
    return Math.round(v * 10000).toLocaleString("ko-KR") + "만";
  }


  function b64e(str){
    var bytes = new TextEncoder().encode(str), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  }
  function b64d(str){
    str = str.replace(/-/g,"+").replace(/_/g,"/");
    var bin = atob(str), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }


  return {
    WEEK_PER_MONTH: WEEK_PER_MONTH, DAYS_PER_MONTH: DAYS_PER_MONTH, MAX_DAYS: MAX_DAYS,
    parseMeso: parseMeso, parsePaste: parsePaste, diagnosePaste: diagnosePaste,
    fmtEok: fmtEok, fmtShort: fmtShort, fmtFine: fmtFine,
    DOW: DOW, parseDate: parseDate, toISO: toISO, addDays: addDays, dayOffset: dayOffset,
    nextThursdays: nextThursdays, skipOffsets: skipOffsets, recurTotals: recurTotals,
    simulate: simulate, findGoal: findGoal, monthIncome: monthIncome,
    withCfg: withCfg, costFor1Day: costFor1Day,
    b64e: b64e, b64d: b64d
  };
})();
if (typeof module === "object" && module.exports) module.exports = MesoCore;
