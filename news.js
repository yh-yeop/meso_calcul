/* ⚙ 설정의 "새 소식".
   새 기능 · 결정석 가격 갱신처럼 이용자가 알아야 할 것만 위에 한 줄씩 더한다 (날짜 내림차순, 최신이 맨 위).
   마지막으로 본 소식보다 새 것이 있으면 머리글 ⚙ 버튼에 점을 찍고, 설정 화면을 열면 지운다. */
Meso.news = (function(M){
  "use strict";

  var LIST = [
    ["2026-11-15", "보스 설정에 추천 구성 — 마지막으로 잡는 보스만 고르면 주간 루틴을 비싼 순으로 채움"],
    ["2026-11-15", "링크를 공유하면 미리보기 카드가 뜸. 문의 · 오류 신고 양식 정리, 새 소식 추가"],
    ["2026-11-14", "Open API로 불러온 캐릭터의 월드 · 직업 · 레벨을 일주일마다 자동으로 갱신"],
    ["2026-11-14", "이름을 메소노믹스(Mesonomics)로 바꿈"],
    ["2026-11-14", "개인정보처리방침 · 이용약관, 탈퇴(클라우드 데이터 삭제) 추가"],
    ["2026-11-14", "설치판 1.1.0 — Android 앱"],
    ["2026-11-13", "Windows 설치판 — 앱 안에서 업데이트 확인"],
    ["2026-11-02", "홈 화면에 앱으로 설치"],
    ["2026-10-26", "Google 로그인으로 기기 간 자동 동기화"],
    ["2026-10-25", "결정석 가격을 10/22 패치 기준으로 갱신"],
    ["2026-10-25", "캐릭터별 보스 루틴과 주간 보스 체크"],
    ["2026-10-25", "메소 장부 — 기록 · 예산 · 통계"]
  ];
  var SHOW = 4;   // 펼치지 않아도 보이는 개수
  var KEY = "meso-news-seen";

  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
  function get(){ try{ return localStorage.getItem(KEY) || ""; } catch(e){ return ""; } }
  function set(v){ try{ localStorage.setItem(KEY, v); } catch(e){} }

  function row(n){
    var d = n[0].split("-");
    return '<li><time datetime="' + n[0] + '">' + (+d[1]) + "/" + (+d[2]) + '</time><span>' + esc(n[1]) + "</span></li>";
  }

  function render(){
    var box = $("news-list");
    if (!box) return;
    var head = LIST.slice(0, SHOW).map(row).join(""), rest = LIST.slice(SHOW).map(row).join("");
    box.innerHTML = '<ul class="news">' + head + "</ul>" +
      (rest ? '<details class="news-more"><summary>이전 소식 ' + (LIST.length - SHOW) + '개</summary><ul class="news">' + rest + "</ul></details>" : "");
    $("news-sub").textContent = LIST[0][0].replace(/-/g, ".");
  }

  // 처음 온 사람에게는 점을 찍지 않음 (전부 새 소식이라 의미가 없음)
  function mark(){
    var btn = $("btn-settings"), seen = get(), latest = LIST[0][0];
    if (/^#settings/.test(location.hash)){ if (seen !== latest) set(latest); seen = latest; }
    else if (!seen){ set(latest); seen = latest; }
    if (btn) btn.classList.toggle("has-new", seen < latest);
  }

  render();
  mark();
  window.addEventListener("hashchange", mark);

  return {list: LIST, latest: function(){ return LIST[0][0]; }};
})(Meso);
