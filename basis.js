/* "계산 기준" 접는 칸 — 캐릭터(보스 수익) · 계산기 화면 맨 아래.
   숫자는 화면에 박지 않고 bosses.js(MESO_BOSSES) · core.js(MesoCore 상수)에서 읽는다. 가격표나 계산 방식이 바뀌면 여기 문장도 따라 바뀜.
   위쪽 MesoBasis 는 DOM 을 안 만지는 순수 함수 (test/basis.test.js 가 require 로 시험), 아래 Meso.basis 는 화면에 그리는 쪽. */
var MesoBasis = (function(){
  "use strict";

  function esc(s){
    return String(s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; });
  }
  // "2026-10-22" → "2026.10.22"
  function dot(iso){ return String(iso || "").replace(/-/g, "."); }
  function trim(v, n){ return String(+v.toFixed(n)); }

  /* 보스 수익 기준. b = MESO_BOSSES, over = ⚙에서 덮어쓴 가격 개수 */
  function bossItems(b, over){
    var lim = b.weeklyLimit, sell = b.sellLimit, items = [];
    items.push("결정석 가격은 <b>" + esc(dot(b.version)) + "</b> 패치 기준" +
      (b.source ? '<span class="basis-src">출처: ' + esc(b.source) + "</span>" : ""));
    if (over > 0) items.push('<a href="#settings">⚙ 설정</a>에서 고친 가격 <b>' + over + "개</b>는 기본값 대신 고친 값으로 계산");
    items.push("파티로 잡으면 결정석 가격 ÷ 인원, 소수점 아래는 버림");
    items.push("주간 보스는 캐릭터당 주 <b>" + lim + "회</b>까지 고를 수 있음");
    items.push("결정석은 메이플ID당 주 <b>" + sell + "개</b>까지만 팔 수 있음 (11/19 패치부터. 챌린저스 · 스페셜 같은 이벤트 월드는 따로). " +
      "넘어도 계산에서 빼지는 않고 캐릭터 화면에 경고만 띄움. 여기 있는 캐릭터를 모두 한 메이플ID로 보고 셈");
    items.push("주간 보스는 <b>목요일 0시</b>, 월간 보스는 <b>매월 1일</b> 리셋. 홈의 이번 주 보스 체크도 이 기준");
    items.push("홈에서 체크한 보스는 체크한 때의 금액으로 장부에 남음. 나중에 가격 · 파티를 바꿔도 다시 계산하지 않음");
    items.push("보스를 안 고른 캐릭터는 직접 넣은 주 · 월 수익을 그대로 씀");
    items.push("추천 구성은 난이도 대신 결정석 가격으로 줄 세움: 고른 보스까지 보스마다 그 가격 이하인 가장 비싼 난이도를 하나씩 골라 비싼 순으로 주 " +
      lim + "개까지. 익스트림은 고른 보스만");
    return items;
  }

  /* 목표 도달일 계산 가정 (core.js simulate · monthIncome). k = MesoCore */
  function calcItems(k){
    var years = Math.round(k.MAX_DAYS / 365.2425);
    return [
      "시작일 당일부터 하루씩 잔고를 쌓아, 처음으로 목표 이상이 되는 날을 도달일로 봄 (최대 " + k.MAX_DAYS + "일, 약 " + years + "년)",
      "입력한 금액이 기간 내내 그대로라고 봄",
      "주간 보스 수익(캐릭터 합계)은 매주 <b>목요일</b>에 한 번. “주보 건너뛸 주”로 고른 목요일은 0",
      "월간 보스 수익은 매월 <b>1일</b>에 한 번",
      "사냥은 재획 시급 × 하루 사냥 시간을 매일 더함. “목요일은 보스런으로 사냥 못 함”을 켜면 목요일은 0",
      "일회성 항목은 그 날짜에 한 번 (지출은 뺌)",
      "정기 지출은 매주 항목은 목요일, 매월 항목은 1일에 뺌",
      "월 순수익 · 비율은 평균으로 환산: 한 달 = " + trim(k.DAYS_PER_MONTH, 2) + "일 = " + trim(k.WEEK_PER_MONTH, 2) +
        "주. 도달일은 실제 달력의 목요일 · 1일을 세므로 월 순수익으로 나눈 값과 조금 다를 수 있음"
    ];
  }

  function section(title, items){
    return '<h4 class="basis-h">' + title + '</h4><ul class="basis-list">' +
      items.map(function(t){ return "<li>" + t + "</li>"; }).join("") + "</ul>";
  }

  /* o = {bosses: MESO_BOSSES, over: 고친 가격 수, core: MesoCore(계산기 화면일 때만)} */
  function html(o){
    var out = "";
    if (o.core) out += section("목표 도달일", calcItems(o.core));
    return out + section("보스 수익", bossItems(o.bosses, o.over || 0));
  }

  // 접은 상태에서도 보이는 한 줄
  function summary(o){
    return "결정석 " + dot(o.bosses.version) + (o.over > 0 ? ", 고친 가격 " + o.over + "개" : "");
  }

  return {bossItems: bossItems, calcItems: calcItems, html: html, summary: summary};
})();
if (typeof module === "object" && module.exports) module.exports = MesoBasis;

if (typeof Meso === "object" && Meso) Meso.basis = (function(M){
  "use strict";
  // prefix: "ch"(캐릭터) | "c"(계산기) → #<prefix>-basis-body, #<prefix>-basis-sub
  function render(prefix, withCalc){
    var body = document.getElementById(prefix + "-basis-body");
    if (!body) return;
    var o = {bosses: M.bosses.data, over: Object.keys(M.bosses.overrides()).length, core: withCalc ? M.core : null};
    body.innerHTML = MesoBasis.html(o);
    var sub = document.getElementById(prefix + "-basis-sub");
    if (sub) sub.textContent = MesoBasis.summary(o);
  }
  return {render: render};
})(Meso);
