# STATUS — meso_calcul

- 2026-11-13: 설치판(`desktop/`, Tauri 2) — Windows NSIS, 배포 사이트를 여는 창. 처음 만든 desktop.yml 은 releases 저장소 방식으로 바꾸며 지움.
- 2026-11-13: **MesoCalc 1.0.0 (Windows) 을 yh-yeop/releases 에 올림**, apps.json 등록, manifest 확인. 웹 머리글 ↓ 버튼 · ⚙ "앱 설치" 카드 라이브 확인. 앱 업데이트(받기→SHA-256→조용한 설치→재실행) · 수동 확인 다리 로컬 검증.
  1.1.0(Android 추가) 준비: 버전 올림, `npm run build:android`, 서명 키 `~/.meso_calcul/`(저장소 밖, 백업 필요), releases/v1.1.0.md. **1.1.0 올리기는 사용자 확인 대기** — 올릴 때 releases apps.json platforms 에 android 추가.
  미검증: 앱 안 Google 로그인(Windows). 요청: 소개 사이트 `js/data.js` meso 항목에 `release: { repo: 'releases', prefix: 'MesoCalc' }` (사이트 카드 다운로드 버튼, 그 저장소 담당).
