# STATUS — meso_calcul

- 2026-11-13: 설치판(`desktop/`, Tauri 2) 추가, MesoCalc 1.0.0(Windows)을 yh-yeop/releases 에 올림. 웹 ↓ 버튼 · "앱 설치" 카드, 앱 업데이트(받기→SHA-256→조용한 설치→재실행) 검증.
- 2026-11-14: **MesoCalc 1.1.0 (Windows + Android APK) 올림**, releases apps.json platforms 에 android 추가, manifest 1.1.0 · Android UA 에서 APK 버튼 라이브 확인. 다음 버전: `desktop/package.json` 버전 올리고 `releases/v<버전>.md` → `npm run build` · `npm run build:android`(잠금) → `npm run release`.
- [PC 전달] 2026-11-14: Android 서명 키 `C:\Users\hoyaj\.meso_calcul\` (jks + properties) 를 따로 백업할 것 — 잃으면 기존 설치에 업데이트 불가.
- [PC 전달] 2026-11-14: Windows 앱 안 Google 로그인 · 동기화를 실제 계정으로 한 번 확인 (미검증).
- 요청(소개 사이트 담당): `yh-yeop.github.io` `js/data.js` meso 항목에 `release: { repo: 'releases', prefix: 'MesoCalc' }` — 사이트 카드 다운로드 버튼.
- 2026-11-14: **정식 서비스 필수 항목** — `legal.html`(개인정보처리방침 · 이용약관, Firestore 서울 리전 · Auth 국외이전 명시), 설정 푸터 비공식 고지 · 링크, 로그인 버튼 아래 동의 문구, **탈퇴(클라우드 데이터 + Firebase Auth 계정 삭제, 최근 로그인 요구 시 재인증)**. sw v22. 가짜 Firebase로 탈퇴 흐름 확인. 문의처는 GitHub Issues.
- [PC 전달] 2026-11-14: `legal.html` 문구 검토 (운영자 표기 · 문의처). 공개 이메일을 문의처로 둘지 결정.
- [PC 전달] 2026-11-14: Firebase 콘솔 — App Check(reCAPTCHA) 켜기, 결제 예산 알림, 승인된 도메인 점검. 실제 계정으로 탈퇴 한 번 시험(테스트 계정).
- 다음(정식 서비스 결정 대기): 자체 도메인 · 광고 수익 · 스토어 배포(Play · MS Store) 여부.
- 2026-11-14: **서비스 이름 → 메소노믹스(Mesonomics)**. 웹 제목 · 헤더 · manifest · legal · README, 설치판 소스(창 제목 · 업데이트 안내 문구)를 바꿈. 검색용 설명엔 "메소 계산기" 유지. sw v23. 앱 식별자 · 저장소 주소 · 릴리스 접두어(MesoCalc)는 업데이트가 끊기지 않게 그대로.
- [PC 전달] 2026-11-14: 설치판 `tauri.conf.json` productName("메소 계산기")은 그대로 둠 — 바꾸면 Windows 설치 폴더 · 제거 항목이 달라져 자동 업데이트가 옛 앱 옆에 따로 설치될 수 있음. 다음 릴리스 때 이름까지 바꿀지(옛 설치 정리 방법 포함) 결정.
- 요청(소개 사이트 담당): `yh-yeop.github.io` `js/data.js` meso 항목 제목을 "메소노믹스"로. 요청(releases): `apps.json` MesoCalc 표시 이름을 "메소노믹스"로.
- 2026-11-14: 넥슨 Open API 정식 서비스 요건 조사 → `docs/openapi-design.md` "정식 서비스 체크리스트". 코드로 할 일: 불러온 캐릭터 정보 30일 안 자동 갱신, API 데이터 근처 표기.
- [PC 전달] 2026-11-14: Open API 서비스 단계 앱 등록(넥슨 로그인 필요 — 서비스명 메소노믹스 · URL · 소개 · 대표 이미지), 광고를 붙일 거면 help_openapi@nexon.co.kr 로 영리 이용 문의.
