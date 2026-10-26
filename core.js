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

  /* ---------- 기기 간 동기화 병합 ----------
     로컬과 클라우드를 "마지막으로 맞춘 때(base)" 기준 3방향으로 합침. base 는 사본이 아니라 id → 내용 해시라 작음.
     state = {ledger, chars, calc, prices} — 각각 localStorage 에 저장하는 모양 그대로(없으면 null). */
  // 키 순서와 상관없이 같은 값이면 같은 문자열
  function stable(v){
    if (v === undefined) return "null";
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    return "{" + Object.keys(v).sort().filter(function(k){ return v[k] !== undefined; })
      .map(function(k){ return JSON.stringify(k) + ":" + stable(v[k]); }).join(",") + "}";
  }
  // FNV-1a 32비트 두 번(시드 다르게) — 기록 수만 건에서도 충돌 걱정 없을 만큼
  function hash(v){
    var s = stable(v), a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    for (var i = 0; i < s.length; i++){
      var c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c, 0x01000193) >>> 0;
    }
    return a.toString(36) + "." + b.toString(36);
  }
  function noId(e){ var o = {}; for (var k in e) if (k !== "id") o[k] = e[k]; return o; }

  // base 형식 버전 — 저장된 base 의 v 가 다르면 없는 걸로 보고 첫 연결 경로로 감 (2: 예산 · api 따로, rev 추가)
  var BASE_V = 2;

  // "데이터 없음" 판정 — 첫 연결에서 빈 쪽 값이 있는 쪽을 덮지 않게 함
  function keysOf(o){ return o && typeof o === "object" ? Object.keys(o) : []; }
  function budgetEmpty(b){ return !b || (!b.total && !keysOf(b.cats).length); }
  function apiEmpty(a){ return !a || (!keysOf(a.last).length && !keysOf(a.skip).length && !a.run); }
  function pricesClean(p){ return keysOf(p).length ? p : null; }   // {} 도 null 과 같은 "없음"
  function empty(s){
    var L = s.ledger, C = s.chars;
    return !(L && L.entries && L.entries.length) && budgetEmpty(L && L.budget) && apiEmpty(L && L.api) &&
           !(C && C.list && C.list.length) && !s.calc && !pricesClean(s.prices);
  }

  // rev: 이 상태가 대응하는 클라우드 rev (없을 수 있음)
  function baseOf(st, rev){
    var b = {v:BASE_V, rev:rev, ledger:{e:{}, budget:null, skip:[]}, chars:{c:{}, order:null},
             calc:hash(st.calc || null), prices:hash(pricesClean(st.prices))};
    var L = st.ledger, C = st.chars;
    if (L && L.entries) L.entries.forEach(function(e){ b.ledger.e[e.id] = hash(e); });
    b.ledger.budget = hash(L && L.budget || null);
    b.ledger.skip = keysOf(L && L.api && L.api.skip).sort();   // 지운 API 기록 목록만 — 3방향 집합 병합용
    if (C && C.list){
      C.list.forEach(function(c){ b.chars.c[c.id] = hash(c); });
      b.chars.order = C.list.map(function(c){ return c.id; });   // 순서는 해시 말고 id 목록 (추가 · 삭제와 순서 변경을 구분하려고)
    }
    return b;
  }

  // 한 덩어리: 한쪽만 바뀌면 그쪽, 둘 다 바뀌었거나 base 가 없으면 로컬
  function pick3(l, r, bh){
    var hl = hash(l === undefined ? null : l), hr = hash(r === undefined ? null : r);
    if (hl === hr) return {v:l, from:"same"};
    if (bh !== undefined && hl === bh) return {v:r, from:"remote"};
    return {v:l, from:"local"};
  }

  /* id 단위 병합. base[id] 가 없으면 그 기록은 base 이후에 생긴 것.
     양쪽에 base 에 없는 같은 id 가 다른 내용으로 있으면 둘 다 새로 만든 것 → 로컬 것을 collide 로 표시해 둘 다 살림 */
  function mergeList(local, remote, base, dedupe){
    var L = {}, R = {}, out = [], seen = {};
    local.forEach(function(x){ L[x.id] = x; });
    remote.forEach(function(x){ R[x.id] = x; });
    // 처음 연결해서 합칠 땐 id 만 다르고 내용이 같은 건 같은 기록으로 봄.
    // 같은 내용이 여러 건이면 개수까지 맞춤 — 내용별로 max(로컬 개수, 클라우드 개수) 건이 남음
    if (dedupe){
      var buckets = {};
      remote.forEach(function(x){
        var l = L[x.id];
        if (l && hash(l) === hash(x)) return;        // id 까지 같으면 decide 가 하나로 합침
        var h = hash(noId(x));
        (buckets[h] = buckets[h] || []).push(x);
      });
      local.forEach(function(x){
        if (L[x.id] !== x) return;
        var r = R[x.id];
        if (r && hash(r) === hash(x)) return;
        var bk = buckets[hash(noId(x))];
        if (bk && bk.length){ bk.shift(); delete L[x.id]; }   // 클라우드의 같은 내용 한 건과 짝 → 클라우드 쪽을 씀
      });
    }
    function decide(id){
      var l = L[id], r = R[id], b = base[id];
      if (!l && !r) return [];
      if (l && r){
        var hl = hash(l), hr = hash(r);
        if (hl === hr) return [{v:l, from:"same"}];
        if (b === undefined) return [{v:r, from:"remote"}, {v:l, from:"local", collide:true}];
        if (hl === b) return [{v:r, from:"remote"}];
        return [{v:l, from:"local"}];
      }
      if (l){
        if (b === undefined) return [{v:l, from:"local"}];
        return hash(l) === b ? [] : [{v:l, from:"local"}];   // 저쪽에서 지움 / 지웠는데 여기서 고침 → 살림
      }
      if (b === undefined) return [{v:r, from:"remote"}];
      return hash(r) === b ? [] : [{v:r, from:"remote"}];
    }
    remote.concat(local).forEach(function(x){
      if (seen[x.id]) return;
      seen[x.id] = true;
      out.push.apply(out, decide(x.id));
    });
    return out;
  }

  // 순서: 로컬에서만 순서를 바꿨으면 로컬 순서, 아니면 클라우드 순서. 없는 건 빼고 빠진 건 뒤에.
  // 추가 · 삭제는 순서 변경이 아님 — base 에 있던 것끼리의 상대 순서만 봄
  function moved(ids, baseIds){
    var inA = {}, inB = {};
    ids.forEach(function(id){ inA[id] = true; });
    baseIds.forEach(function(id){ inB[id] = true; });
    return ids.filter(function(id){ return inB[id]; }).join("\n") !== baseIds.filter(function(id){ return inA[id]; }).join("\n");
  }
  function order(items, localIds, remoteIds, baseOrder){
    var base = Array.isArray(baseOrder) ? baseOrder : null;
    var pref = base && moved(localIds, base) && !moved(remoteIds, base) ? localIds : base ? remoteIds : localIds;
    var by = {}, out = [];
    items.forEach(function(x){ (by[x.v.id] = by[x.v.id] || []).push(x); });
    pref.forEach(function(id){ if (by[id]){ out.push.apply(out, by[id]); delete by[id]; } });
    items.forEach(function(x){ if (by[x.v.id]){ out.push.apply(out, by[x.v.id]); delete by[x.v.id]; } });
    return out;
  }

  // API 상태: skip 은 3방향 집합(합집합 − 한쪽이 base 에서 지운 것), last 는 키별 최댓값(ISO 날짜), run 은 더 최근 것
  function mergeApi(la, ra, baseSkip){
    if (!la) return ra || undefined;
    if (!ra) return la;
    if (hash(la) === hash(ra)) return la;
    var bs = {}; (baseSkip || []).forEach(function(k){ bs[k] = true; });
    var ls = la.skip || {}, rs = ra.skip || {}, skip = {};
    Object.keys(ls).concat(Object.keys(rs)).forEach(function(k){
      var both = ls[k] && rs[k];
      if (both || ((ls[k] || rs[k]) && !bs[k])) skip[k] = 1;   // 한쪽에서 base 의 항목을 지웠으면 지움, 새로 생긴 건 살림
    });
    var last = {}, ll = la.last || {}, rl = ra.last || {};
    Object.keys(ll).concat(Object.keys(rl)).forEach(function(k){
      var a = ll[k], b = rl[k];
      last[k] = typeof a !== "string" ? b : typeof b !== "string" ? a : a >= b ? a : b;
    });
    var ta = Date.parse(la.run), tb = Date.parse(ra.run), run;
    if (!isNaN(ta) && !isNaN(tb)) run = tb > ta ? ra.run : la.run;
    else run = !isNaN(tb) ? ra.run : la.run != null ? la.run : null;
    var out = {};
    for (var k in la) out[k] = la[k];
    out.skip = skip; out.last = last; out.run = run == null ? null : run;
    return out;
  }

  function mergeLedger(l, r, b, first){
    if (!r) return l;
    if (!l) return r;
    // 장부 화면은 늘 날짜 · id 로 정렬해서 저장 순서는 안 맞춰도 됨
    var items = mergeList(l.entries || [], r.entries || [], b.e || {}, first);
    var maxId = Math.max(l.seq || 0, r.seq || 0);
    items.forEach(function(x){ if (!x.collide && x.v.id > maxId) maxId = x.v.id; });
    // 같은 src(보스 체크 · API 기록)가 양쪽에서 따로 생기면 로컬 것 하나만
    var bySrc = {};
    items.forEach(function(x){ if (x.v.src) (bySrc[x.v.src] = bySrc[x.v.src] || []).push(x); });
    var drop = [];
    Object.keys(bySrc).forEach(function(s){
      var g = bySrc[s];
      if (g.length < 2) return;
      var keep = g.filter(function(x){ return x.from !== "remote"; })[0] || g[0];
      g.forEach(function(x){ if (x !== keep) drop.push(x); });
    });
    items = items.filter(function(x){ return drop.indexOf(x) < 0; });
    var entries = items.map(function(x){
      if (!x.collide) return x.v;
      var e = {}; for (var k in x.v) e[k] = x.v[k];
      e.id = ++maxId;
      return e;
    }).sort(function(a, b){ return a.id - b.id; });
    // 예산 · API 는 따로: 첫 연결은 빈 쪽을 없는 걸로 보고, 아니면 바뀐 쪽
    var lb = l.budget || null, rb = r.budget || null;
    var bud = first ? (budgetEmpty(lb) && rb ? rb : lb || rb) : pick3(lb, rb, b.budget).v;
    var out = {};
    for (var k in l) out[k] = l[k];
    out.entries = entries;
    out.seq = maxId;
    if (bud) out.budget = bud;
    var api = mergeApi(l.api, r.api, b.skip);
    if (api) out.api = api;
    return out;
  }

  // 본캐는 하나만 — 둘 이상이면 이 기기에서 바꾼 쪽, 없으면 앞쪽. 하나도 없으면 그대로(store 가 고침)
  function oneMain(list, ll, bc){
    var mains = [];
    list.forEach(function(c, i){ if (c.main) mains.push(i); });
    if (mains.length < 2) return list;
    var lid = {}; ll.forEach(function(c){ lid[c.id] = c; });
    var win = mains[0];
    for (var i = 0; i < mains.length; i++){
      var c = list[mains[i]], lc = lid[c.id];
      if (lc && hash(lc) !== bc[c.id]){ win = mains[i]; break; }
    }
    return list.map(function(c, i){
      if (!c.main || i === win) return c;
      var o = {}; for (var k in c) o[k] = c[k];
      o.main = false;
      return o;
    });
  }

  function mergeChars(l, r, b, dedupe){
    if (!r) return l;
    if (!l) return r;
    var ll = l.list || [], rl = r.list || [];
    var items = mergeList(ll, rl, b.c || {}, dedupe);
    // 문자열 id 라 충돌은 사실상 없음 — 생기면 로컬 것만
    items = items.filter(function(x){ return !x.collide; });
    items = order(items, ll.map(function(c){ return c.id; }), rl.map(function(c){ return c.id; }), b.order);
    var list = oneMain(items.map(function(x){ return x.v; }), ll, b.c || {});
    return {v: l.v || r.v || 1, list: list};
  }

  /* local · remote · base → 합친 state. base 가 null 이면 처음 연결(합치기): 내용이 같은 기록은 하나로,
     빈 쪽(calc null · prices 없음 · 예산 0 · api 비어 있음)은 상대 쪽을 씀 */
  function syncMerge(local, remote, base){
    if (base && base.v !== BASE_V) base = null;
    var first = !base;
    var lc = local.calc || null, rc = remote.calc || null, lp = pricesClean(local.prices), rp = pricesClean(remote.prices);
    var st;
    if (first && empty(local)){
      // 이 기기에 데이터가 없으면 클라우드를 그대로 (없는 덩어리만 로컬)
      st = {ledger: remote.ledger || local.ledger || null, chars: remote.chars || local.chars || null,
            calc: rc || lc, prices: rp || lp};
    } else {
      var bs = base || {ledger:{e:{}}, chars:{c:{}}};
      st = {
        ledger: mergeLedger(local.ledger || null, remote.ledger || null, bs.ledger || {e:{}}, first),
        chars: mergeChars(local.chars || null, remote.chars || null, bs.chars || {c:{}}, first),
        calc: first ? (lc || rc) : pick3(lc, rc, bs.calc).v,
        prices: first ? (lp || rp) : pick3(lp, rp, bs.prices).v
      };
    }
    var hs = hash(norm(st));
    return {
      state: st,
      // 로컬에 써야 하나 · 클라우드에 써야 하나
      toLocal: hs !== hash(norm(local)),
      toRemote: hs !== hash(norm(remote))
    };
  }
  // 비교용 — 장부 기록은 저장 순서가 의미 없어서 id 순으로 맞춰서 비교
  function norm(s){
    var l = s.ledger || null;
    if (l && l.entries){
      var c = {}; for (var k in l) c[k] = l[k];
      c.entries = l.entries.slice().sort(function(a, b){ return a.id - b.id; });
      l = c;
    }
    return {ledger:l, chars:s.chars || null, calc:s.calc || null, prices:pricesClean(s.prices)};
  }

  // 장부는 클라우드 문서 1MB 제한 때문에 해마다 나눠 저장
  function splitLedger(l){
    var meta = {}, years = {};
    for (var k in l) if (k !== "entries") meta[k] = l[k];
    (l.entries || []).forEach(function(e){
      var y = /^\d{4}/.test(e.d || "") ? e.d.slice(0, 4) : "0000";
      (years[y] = years[y] || []).push(e);
    });
    return {meta: meta, years: years};
  }
  function joinLedger(meta, years){
    var out = {};
    for (var k in meta) out[k] = meta[k];
    var all = [];
    Object.keys(years).sort().forEach(function(y){ all.push.apply(all, years[y]); });
    out.entries = all.sort(function(a, b){ return a.id - b.id; });
    return out;
  }


  return {
    WEEK_PER_MONTH: WEEK_PER_MONTH, DAYS_PER_MONTH: DAYS_PER_MONTH, MAX_DAYS: MAX_DAYS,
    parseMeso: parseMeso, parsePaste: parsePaste, diagnosePaste: diagnosePaste,
    fmtEok: fmtEok, fmtShort: fmtShort, fmtFine: fmtFine,
    DOW: DOW, parseDate: parseDate, toISO: toISO, addDays: addDays, dayOffset: dayOffset,
    nextThursdays: nextThursdays, skipOffsets: skipOffsets, recurTotals: recurTotals,
    simulate: simulate, findGoal: findGoal, monthIncome: monthIncome,
    withCfg: withCfg, costFor1Day: costFor1Day,
    b64e: b64e, b64d: b64d,
    sync: {hash: hash, norm: norm, baseOf: baseOf, merge: syncMerge, empty: empty, BASE_V: BASE_V, splitLedger: splitLedger, joinLedger: joinLedger}
  };
})();
if (typeof module === "object" && module.exports) module.exports = MesoCore;
