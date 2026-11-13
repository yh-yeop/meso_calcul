// tauri android <인자> 를 SDK · NDK 경로를 채워서 돌린다 (환경 변수가 없으면 Android Studio 기본 위치).
//
//   npm run build:android     서명된 APK → src-tauri/gen/android/app/build/outputs/apk/universal/release/
//   npm run android -- dev    에뮬레이터 · 기기에서 개발 실행
//
// 서명 키는 저장소 밖 (README "Android 서명"). 무거운 작업이라 공용 잠금(heavy-job.ps1)으로 감싸서 돌린다.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const env = { ...process.env };
env.ANDROID_HOME ||= path.join(env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
if (!env.NDK_HOME) {
  const dir = path.join(env.ANDROID_HOME, 'ndk');
  const latest = fs.existsSync(dir) && fs.readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
  if (latest) env.NDK_HOME = path.join(dir, latest);
}
// gradle 은 데몬 없이 (같은 PC 의 다른 세션 빌드와 엮이지 않게)
env.GRADLE_OPTS = [env.GRADLE_OPTS, '-Dorg.gradle.daemon=false'].filter(Boolean).join(' ');

const r = spawnSync('npx', ['tauri', 'android', ...process.argv.slice(2)], { stdio: 'inherit', env, shell: true });
process.exit(r.status ?? 1);
