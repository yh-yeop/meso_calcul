# 장부 × 넥슨 Open API 연동 설계

조사일 2026-10-25. 근거는 [openapi.nexon.com](https://openapi.nexon.com/ko/game/maplestory/) 문서와 실제 응답 헤더.

## 한 줄 결론

API는 **"무슨 일이 있었나"(강화 시도, 재설정, 보스 클리어, 심볼 레벨)** 는 알려주지만 **"메소가 얼마 들었나"** 는 어디에도 없다.
그래서 연동은 `API 사실 + 비용 규칙표 = 추정 장부 기록`이고, 오차는 기존 **잔고 확인 → 미기록** 장치가 잡는다.

## 무엇이 자동이 되나

| 장부 항목 | 방식 | 근거 API | 비용 산출 | 신뢰도 |
|---|---|---|---|---|
| 스타포스 (지출) | **자동** | `history/starforce` | 공식 × 장비 레벨 × 할인 | 중 — 레벨이 응답에 없음, 2025 개편 공식 확인 필요 |
| 잠재능력 재설정 (지출) | **자동** | `history/potential` | 등급 × 레벨 비용표 | 상 — `item_level`, 현재 등급이 응답에 있음 |
| 심볼 (지출) | **자동** | `character/symbol-equipment` (date 지정) | 날짜별 레벨 차이 × 비용표 | 상 — 단 2026.03 이후 비용표 확인 필요 |
| 주간 · 월간보스 (수입) | **반자동** | `scheduler/character-state` | 결정석 가격표 ÷ 파티 인원 | 중 — 파티 인원은 API에 없음, 사용자 설정 |
| 사냥 (수입) | 수동 | — | — | 사냥 메소를 주는 API 없음 |
| 경매장 판매 · 구매 | 수동 | — | — | 거래 API 없음 |
| 현재 잔고 | 수동 | — | — | 보유 메소 · 인벤토리 API 없음 |
| 큐브 (캐시/이벤트) | 제외 | `history/cube` | — | 메소 지출 아님 |
| 소울 잠재 재설정 | 보류 | `history/soul-potential` | ? | 메소 소모 여부 확인 필요 |

즉 **지출 쪽은 대부분 자동**, **수입은 보스만 반자동**, 사냥 · 경매장 · 잔고는 지금처럼 손으로.
그래도 스타포스는 시도 수백 번을 손으로 합산할 수 없는 항목이라 체감 효과가 가장 큼.

## API 사실관계

| | |
|---|---|
| 서버 | `https://open.api.nexon.com`, 헤더 `x-nxopen-api-key` |
| CORS | 허용됨. `Origin: https://yh-yeop.github.io` 프리플라이트에 `access-control-allow-origin` 반사 + `access-control-allow-headers: x-nxopen-api-key` 확인 → **프록시 서버 없이 정적 페이지에서 직접 호출 가능** |
| 호출 한도 | 개발 단계 키 **5건/초, 1,000건/일**. 서비스 단계 500건/초, 2천만 건/일 (FAQ) |
| 키 범위 | 이력 · 스케줄러는 키를 발급한 **본인 계정** 데이터만. 그래서 키는 사용자 각자가 발급해서 넣는 구조 |
| 표기 의무 | "Data based on NEXON Open API" 표기 필요 |
| 보관 의무 | 크롤링한 데이터는 30일 이내 갱신 의무 (원본은 저장하지 않고 장부 금액만 남기는 이유) |

### 엔드포인트별

**`GET /maplestory/v1/history/starforce`** — 2023-12-27부터, 최대 2년, 최대 5분 지연
- 파라미터: `date`(KST) 또는 `cursor` 중 하나 필수, `count` 10~1000
- 필드: `id`, `date_create`, `character_name`, `target_item`, `before/after_starforce_count`, `item_upgrade_result`, `starcatch_result`, `superior_item_flag`, `destroy_defence`, `chance_time`, `event_field_flag`, `upgrade_item`, `protect_shield`, `starforce_event_list[].cost_discount_rate` …
- **없는 것: 비용, 장비 레벨.** 레벨은 `character/item-equipment`의 `item_base_option.base_equipment_level`을 아이템 이름으로 매칭해 얻음. 장착 해제한 아이템은 한 번 물어보고 기억.

**`GET /maplestory/v1/history/potential`** — 2024-01-25부터, 최대 30분 지연
- 필드: `potential_type`(잠재/에디셔널), `item_level`, `potential_option_grade`(재설정 시점 등급), `item_upgrade_result`, `miracle_time_flag`, `upgrade_guarantee`, `target_item` …
- 비용표의 두 축(레벨, 등급)이 응답에 다 있음 → 가장 깔끔하게 계산됨.

**`GET /maplestory/v1/scheduler/character-state`** — 오늘 기준 **14일 전까지만**
- 파라미터: `ocid`(본인 계정 캐릭터만), `date`
- 필드: `boss_contents[].{content_name, difficulty, cycle, registration_flag, complete_flag}`, `weekly_boss_clear_count`, `weekly_boss_clear_limit_count`
- 보스 콘텐츠는 완료 시점에 갱신. **14일 창이 있어서 최소 2주에 한 번은 동기화해야 보스 수입이 안 빠짐.**

**`GET /maplestory/v1/character/symbol-equipment`** — 2023-12-21부터, `date` 지정 가능
- 필드: `symbol[].{symbol_name, symbol_level, symbol_growth_count}`
- 하루 단위 스냅샷 두 개의 레벨 차이 = 그날 강화한 심볼.

**`GET /maplestory/v1/character/list`** — 계정 캐릭터 목록과 `ocid`. 계산기 로스터 이름과 매칭하는 데 씀.

## 구조

```
index.html (장부 탭 · ⚙ 설정)
  ├─ 설정: API 키 (localStorage "meso-ledger-key", 백업 · CSV · 공유에 절대 안 실림)
  ├─ api.js (클라이언트) + ledger.js (동기화 · upsert)
  │    fetch → 정규화 → 비용 산출 → 장부 기록 upsert
  └─ rules.json  ← 비용 규칙표. 코드와 분리, 버전 · 출처 · 적용 시작일 포함
```

빌드 없는 단일 페이지 원칙은 유지. `rules.json`만 별도 파일로 두어, 패치로 비용이 바뀌면 표만 고치면 됨 (적용 시작일이 있어서 과거 기록은 옛 표로 계산).

### 키 보관
- 이력 API 키는 계정 강화 이력을 읽는 열쇠라 민감함. **이 기기 localStorage에만**, 장부 데이터(`meso-ledger-v1`)와 다른 키에 저장.
- URL · 백업 JSON · CSV에 포함하지 않음. 입력칸은 `type=password`, "키 지우기" 버튼 제공.

## 데이터 모델 변경

기록에 출처와 근거를 붙인다. 기존 필드는 그대로.

```js
{ id, d, t, a, c, ch, m,
  src: "api:sf:2026-10-24:호야시치",   // 출처 키 — 같은 날 다시 동기화하면 이 키로 교체(멱등)
  est: true,                             // 규칙표로 추정한 금액
  x: { n: 37, items: [["아케인셰이드 투핸드소드", 17, 19, 3]] },  // 근거 요약: 시도 수, 아이템별 시작/끝 성, 파괴 수
  lock: true }                           // 사용자가 금액을 고친 기록 → 재동기화가 덮어쓰지 않음
```

- **하루 × 캐릭터 × 항목 = 기록 1건**으로 묶는다. 스타포스 수백 번이 목록을 덮지 않게.
- 원본 이력은 저장하지 않음 (30일 갱신 의무 회피 + 용량). 근거 요약 `x`만 남김.
- 동기화 상태: `st.api = { last: {sf:"2026-10-24", pot:..., sched:..., sym:...}, chars:[{name, ocid}], party:{ "카룬 하드": 2 }, levels:{ "아이템명": 200 } }`

## 동기화 알고리즘

```
sync():
  from = st.api.last[kind] (없으면 오늘-6일), to = 오늘
  for day in from..to:                       # 오늘은 지연 때문에 매번 다시 가져옴
    스타포스: date=day 로 cursor 끝까지 → 캐릭터별 묶음 → 비용 합 → upsert("api:sf:day:캐릭")
    잠재    : 같은 방식
    심볼    : 캐릭터별 day-1, day 스냅샷 레벨 차이 → upsert("api:sym:day:캐릭")
  보스 (스케줄러 14일 창):
    목요일 주차마다 마지막 스냅샷의 complete_flag=true 보스 집합
    × 결정석 가격 ÷ party[보스] → upsert("api:boss:주시작일:캐릭"), 날짜는 complete가 처음 보인 날
  st.api.last 갱신 → 저장 → 다시 그리기
```

- upsert: 같은 `src`가 있고 `lock`이 아니면 교체, `lock`이면 건너뛰고 "수정한 기록이라 유지함" 표시.
- 순차 호출 + 초당 4건으로 스로틀, 429면 지수 백오프, `OPENAPI00009`(데이터 준비 중) · `00010`(점검)은 다음에 재시도.

### 호출량 (개발 키 1,000건/일 안에 들어가는지)

| 상황 | 계산 | 건수 |
|---|---|---|
| 매일 동기화, 캐릭 6개 | 목록 1 + 스타포스 1 + 잠재 1 + 심볼 6 + 스케줄러 6 | **≈ 15** |
| 1주 만에 동기화 | 7일 × (2 + 6 + 6) + 1 | ≈ 100 |
| 최초 30일 백필 | 30 × (2 + 6) + 14 × 6 + 1 | ≈ 325 |
| 아이템 레벨 매칭 | 캐릭별 장비 1회, 이후 캐시 | 6 |

강화를 많이 한 날은 스타포스 페이지가 늘지만 count=1000이라 하루 1~2건. 여유 있음.

## 비용 규칙표 (`rules.json`) — 가장 큰 리스크

| 표 | 필요한 값 | 상태 |
|---|---|---|
| 스타포스 | 성별 비용식 (레벨³ 기반), 파괴방지 배율, MVP · PC방 할인 상한 성, 슈페리얼 | 2025.03 개편(30성 확장, 하락 삭제, 17~19 · 21성 비용 증가, 파괴방지 200%)으로 **예전 식이 안 맞음. 공식 패치노트로 확정 필요** |
| 잠재 재설정 | 등급(레어~레전드리) × 레벨 구간 × 잠재/에디셔널 | 공식 공지에 표가 있음. 수치 확정 필요 |
| 심볼 | 지역별 레벨당 비용 (아케인 6 · 어센틱 · 그랜드 어센틱) | 커뮤니티 표만 확인. 확정 필요 |
| 결정석 | 보스 × 난이도 가격 | 계산기에서 쓰는 maplescouter 값과 같은 출처로 맞추는 게 좋음 |

원칙
- 각 표에 `version`, `source`(링크), `since`(적용 시작일).
- 추정 기록은 목록에서 `≈` 표시, 눌러서 근거(`x`) 확인 · 금액 수정 가능(수정하면 `lock`).
- **검증 루프**: 강화 전후로 잔고 확인을 넣으면 미기록이 곧 규칙표 오차. 실제 몇 번 대조해 보고 표를 확정함.
- 사용자 설정: MVP 등급, PC방 여부, 보스별 파티 인원 (스케줄러에 파티 정보 없음).

## UI

- 헤더 도구에 `동기화` 버튼 + 마지막 동기화 시각. 키가 없으면 설정 패널을 엶.
- 설정 패널: API 키, 연결 확인(→ 캐릭터 목록 표시, 로스터 이름과 매칭), MVP · PC방, 보스 파티 인원.
- 동기화 결과 요약: "스타포스 3일치 41회 −52.3억 ≈ · 잠재 −8.1억 ≈ · 보스 +49.1억 · 건너뜀 1(수정한 기록)".
- **13일째 경고**: 스케줄러 14일 창이 닫히기 전에 "보스 기록이 곧 사라짐, 동기화 필요" 배너.
- 통계 확장: API 기록은 아이템 단위 근거가 있어서 **아이템별 누적 투자액** ("아케인 무기에 지금까지 312억")이 가능해짐 — 전략 판단(이 템에 더 넣을까)에 바로 쓰임.

## 단계

1. ~~**잠재능력 재설정**~~ — **구현됨 (2026-10-25).** 키 저장, 동기화 골격(스로틀 · 백오프 · 커서), upsert / lock / 삭제 표시(`api.skip`), `rules.js`.
   설계와 달라진 점: 규칙표를 `rules.json`이 아니라 `rules.js`(`<script src>`)로 둠 — `fetch`가 필요 없어서 오프라인/로컬에서도 로드됨.
   비용 등급은 `before_*_option[0].grade`(재설정 직전 아이템 등급)를 우선 사용. 실응답으로 확인 필요.
2. **스타포스** — 장비 레벨 매칭(장착 장비 API + 수동 기억), 개편 후 공식, 할인 설정.
3. **보스 수입** — 스케줄러, 결정석표, 파티 인원, 14일 경고. 계산기 로스터의 주보 값과 대조 표시.
4. **심볼** — 날짜별 스냅샷 차이.
5. 아이템별 누적 투자 통계, 강화 기대비용과 실제 비교 (전략 도구 쪽).

## 아직 확인 못 한 것

- 2025.03 개편 후 스타포스 비용식 정확한 값, 파괴방지 적용 구간
- 잠재 재설정 · 심볼 현행 비용표
- 스케줄러에 **등록 안 한 보스**도 `complete_flag`가 잡히는지 (`registration_flag` 존재 → 등록한 것만일 가능성)
- `upgrade_item`(주문서 등으로 메소 없이 강화) · `event_field_flag`의 정확한 의미
- 소울 잠재능력 재설정이 메소를 쓰는지
- 이력의 `character_name`이 개명 후 어떻게 보이는지

전부 **본인 키로 실제 응답 몇 개를 받아 보면** 바로 풀리는 것들이라, 1단계 시작 전에 키 하나로 응답 샘플을 떠 두는 게 첫 작업.
