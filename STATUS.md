# STATUS — meso_calcul

- 2026-11-13: 설치판(`desktop/`, Tauri 2) 추가, MesoCalc 1.0.0(Windows)을 yh-yeop/releases 에 올림. 웹 ↓ 버튼 · "앱 설치" 카드, 앱 업데이트(받기→SHA-256→조용한 설치→재실행) 검증.
- 2026-11-14: **MesoCalc 1.1.0 (Windows + Android APK) 올림**, releases apps.json platforms 에 android 추가, manifest 1.1.0 · Android UA 에서 APK 버튼 라이브 확인. 다음 버전: `desktop/package.json` 버전 올리고 `releases/v<버전>.md` → `npm run build` · `npm run build:android`(잠금) → `npm run release`.
- [PC 전달] 2026-11-14: Android 서명 키 `C:\Users\hoyaj\.meso_calcul\` (jks + properties) 를 따로 백업할 것 — 잃으면 기존 설치에 업데이트 불가.
- [PC 전달] 2026-11-14: Windows 앱 안 Google 로그인 · 동기화를 실제 계정으로 한 번 확인 (미검증).
- 요청(소개 사이트 담당): `yh-yeop.github.io` `js/data.js` meso 항목에 `release: { repo: 'releases', prefix: 'MesoCalc' }` — 사이트 카드 다운로드 버튼.
