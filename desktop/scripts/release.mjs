// 설치판을 yh-yeop/releases 에 올린다 (규칙은 그 저장소 README "배포 규칙").
//
//   node scripts/release.mjs            올리기
//   node scripts/release.mjs --dry-run  무엇을 올릴지만 보기
//
// 먼저 빌드해 둔다: npm run build (Windows), 1.1.0 부터는 npm run build:android 도.
// - 태그 MesoCalc-v<버전>, 제목 "메소 계산기 <버전>", 본문 releases/v<버전>.md
// - Windows MesoCalc-Setup-<버전>.exe, Android MesoCalc-<버전>.apk, 각각 .sha256
// - manifest · 다운로드 표 · 소개 사이트는 releases 저장소의 Actions 가 맞춘다.
//   앱의 업데이트 확인과 웹의 다운로드 버튼은 그 manifest(Pages 사본)를 읽는다.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'yh-yeop/releases';
const APP = 'MesoCalc';
const NAME = '메소 계산기';
const dry = process.argv.includes('--dry-run');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = `${APP}-v${version}`;
const beta = /-beta/.test(version);
/** 이 버전이 내는 플랫폼 — package.json 의 platforms (releases apps.json 의 platforms 와 맞출 것) */
const platforms = pkg.platforms ?? ['windows'];

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

const notes = path.join(ROOT, 'releases', `v${version}.md`);
if (!fs.existsSync(notes)) fail(`릴리스 노트가 없음: releases/v${version}.md`);

const out = path.join(ROOT, 'out', version);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

function stage(src, name) {
  const dest = path.join(out, name);
  fs.copyFileSync(src, dest);
  const hex = createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
  fs.writeFileSync(`${dest}.sha256`, `${hex}  ${name}\n`);
  console.log(`  ${name}  ${(fs.statSync(dest).size / 1048576).toFixed(2)}MB  ${hex.slice(0, 12)}…`);
  return [dest, `${dest}.sha256`];
}

const files = [];

// Windows (NSIS)
{
  const dir = path.join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
  const exe = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => f.endsWith(`_${version}_x64-setup.exe`));
  if (!exe) fail(`Windows 설치 파일이 없음 (v${version}). 먼저 npm run build`);
  files.push(...stage(path.join(dir, exe), `${APP}-Setup-${version}.exe`));
}

// Android (APK) — package.json platforms 에 android 가 있을 때만
if (platforms.includes('android')) {
  const apk = path.join(ROOT, 'src-tauri', 'gen', 'android', 'app', 'build', 'outputs', 'apk', 'universal', 'release', 'app-universal-release.apk');
  if (!fs.existsSync(apk)) fail('Android APK 가 없음. 먼저 npm run build:android');
  // 다른 버전이나 서명 안 된 APK 를 올리지 않게 확인
  const sdk = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
  const tools = path.join(sdk, 'build-tools');
  const latest = fs.readdirSync(tools).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
  const badging = execFileSync(path.join(tools, latest, 'aapt2.exe'), ['dump', 'badging', apk], { encoding: 'utf8' });
  const apkVersion = badging.match(/versionName='([^']+)'/)?.[1];
  if (apkVersion !== version) fail(`APK 버전이 ${apkVersion} (package.json 은 ${version}). 다시 빌드할 것`);
  try {
    execFileSync(path.join(tools, latest, 'apksigner.bat'), ['verify', apk], { stdio: 'pipe', shell: true });
  } catch {
    fail('APK 가 서명되지 않음. ~/.meso_calcul/android-signing.properties 확인 (README "Android 서명")');
  }
  files.push(...stage(apk, `${APP}-${version}.apk`));
}

const title = `${NAME} ${version.replace(/-beta(?:\.(\d+))?$/, (_, n) => ` 베타${n ? ` ${n}` : ''}`)}`;
console.log(`\n${tag}  "${title}"  → ${REPO}${beta ? ' (프리릴리스)' : ''}`);

let exists = true;
try {
  execFileSync('gh', ['release', 'view', tag, '--repo', REPO], { stdio: 'ignore' });
} catch {
  exists = false;
}
if (exists) fail(`${tag} 가 이미 있음. 버전을 올릴 것 (npm version <버전> --no-git-tag-version)`);

if (dry) {
  console.log('(--dry-run: 올리지 않음)');
  process.exit(0);
}

execFileSync(
  'gh',
  ['release', 'create', tag, ...files, '--repo', REPO, '--title', title, '--notes-file', notes, ...(beta ? ['--prerelease'] : [])],
  { stdio: 'inherit' },
);
console.log(`\n✔ https://github.com/${REPO}/releases/tag/${tag}`);
console.log('  manifest 는 releases 의 Actions(sync)가 몇 분 안에 맞춤 → 앱 업데이트 확인 · 웹 다운로드 버튼에 반영');
