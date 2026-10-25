/* 보스 결정석(강렬한 힘의 결정) 판매가 — 캐릭터별 보스 루틴의 수익 계산에 씀. 단위: 메소.
   패치로 가격이 바뀌면 여기를 고치고 version 을 올릴 것. 사용자는 ⚙ 설정에서 개별 가격을 덮어쓸 수 있음.
   보스 이름 · 난이도는 게임(그리고 Open API 스케줄러) 표기 그대로 — 나중에 클리어 기록을 자동으로 맞추려고.
   규칙: 캐릭터당 주간 보스 12회, 파티면 가격 ÷ 인원(소수점 버림), 월드당 주 90개, 목요일 0시 리셋. */
window.MESO_BOSSES = {
  version: "2026-10-22",
  source: "나무위키 '강렬한 힘의 결정' 현재 가격 (2026-10-25 확인). 메덕후 9/17 표와 몇 줄이 달라 확인 필요: " +
          "카링 · 찬란한 흉성 노멀, 카링 익스트림 · 유피테르 하드",
  weeklyLimit: 12,
  worldLimit: 90,
  diffs: {easy:"이지", normal:"노멀", hard:"하드", chaos:"카오스", extreme:"익스트림"},
  // 진행 순서 = 표시 순서
  weekly: [
    {id:"zakum",       n:"자쿰",              p:{chaos:4040000}},
    {id:"bloodyqueen", n:"블러디퀸",          p:{chaos:4070000}},
    {id:"vonbon",      n:"반반",              p:{chaos:4070000}},
    {id:"pierre",      n:"피에르",            p:{chaos:4080000}},
    {id:"magnus",      n:"매그너스",          p:{hard:4280000}},
    {id:"vellum",      n:"벨룸",              p:{chaos:4640000}},
    {id:"papulatus",   n:"파풀라투스",        p:{chaos:6550000}},
    {id:"lotus",       n:"스우",              p:{normal:8350000, hard:48900000, extreme:545000000}},
    {id:"damien",      n:"데미안",            p:{normal:8750000, hard:46400000}},
    {id:"slime",       n:"가디언 엔젤 슬라임", p:{normal:12700000, chaos:71300000}},
    {id:"lucid",       n:"루시드",            p:{easy:14900000, normal:17800000, hard:59700000}},
    {id:"will",        n:"윌",                p:{easy:16100000, normal:20500000, hard:73200000}},
    {id:"dusk",        n:"더스크",            p:{normal:22000000, chaos:66300000}},
    {id:"dunkel",      n:"듄켈",              p:{normal:23700000, hard:89600000}},
    {id:"jinhilla",    n:"진 힐라",           p:{normal:67600000, hard:100000000}},
    {id:"seren",       n:"선택받은 세렌",     p:{normal:167000000, hard:302000000, extreme:1840000000}},
    {id:"kalos",       n:"감시자 칼로스",     p:{easy:238000000, normal:479000000, chaos:1230000000, extreme:4104000000}},
    {id:"adversary",   n:"최초의 대적자",     p:{easy:261000000, normal:532000000, hard:1390000000, extreme:4712000000}},
    {id:"kaling",      n:"카링",              p:{easy:320000000, normal:593000000, hard:1560000000, extreme:4845000000}},
    {id:"radiant",     n:"찬란한 흉성",       p:{normal:576000000, hard:2678000000}},
    {id:"bellona",     n:"벨로나",            p:{easy:396000000, normal:824000000, hard:2950000000}},
    {id:"limbo",       n:"림보",              p:{normal:995000000, hard:2385000000, extreme:7500000000}},
    {id:"baldrix",     n:"발드릭스",          p:{normal:1320000000, hard:3078000000, extreme:9600000000}},
    {id:"jupiter",     n:"유피테르",          p:{normal:1560000000, hard:5387000000}}
  ],
  monthly: [
    {id:"blackmage",   n:"검은 마법사",       p:{hard:465000000, extreme:5680000000}}
  ]
};
