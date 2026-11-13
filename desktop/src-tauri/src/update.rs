//! 새 버전 확인 · 설치. 구조는 ListUp(app/src/lib/updates.ts)을 따른다.
//!
//! - 최신 정보는 yh-yeop/releases 가 자동으로 만드는 앱별 manifest(Pages 사본)에서 읽는다.
//!   GitHub API 를 부르지 않으니 횟수 제한이 없어 앱을 열 때마다 확인한다.
//! - 앱을 열 때: 새 버전을 처음 보면 한 번만 묻는다(같은 버전은 다시 묻지 않음 — update.json).
//! - 설정의 "업데이트 확인": 늘 묻고, 최신이거나 확인하지 못해도 알려 준다.
//! - Windows: 설치 파일을 받아 SHA-256 을 맞춰 보고, 조용한 설치(/P /UPDATE /R)로 돌린 뒤 앱을 끝낸다 → 설치 후 다시 열림.
//! - Android: 브라우저로 APK 를 받게 한다(받은 뒤 알림에서 열어 설치).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

use crate::version;

/// releases 저장소의 앱 id 는 MesoCalc (태그 MesoCalc-v<버전>)
const MANIFEST: &str = "https://yh-yeop.github.io/releases/apps/MesoCalc/manifest.json";
pub const RELEASES_URL: &str = "https://github.com/yh-yeop/releases/releases?q=MesoCalc&expanded=true";

/// manifest 의 assets 키
#[cfg(target_os = "android")]
pub const PLATFORM: &str = "android";
#[cfg(not(target_os = "android"))]
pub const PLATFORM: &str = "windows";

static BUSY: AtomicBool = AtomicBool::new(false);

pub struct Latest {
    pub version: String,
    pub release_url: String,
    pub asset: Option<Asset>,
}

pub struct Asset {
    pub name: String,
    pub url: String,
    pub sha256: Option<String>,
}

/// MESO_UPDATE_MANIFEST 는 시험용 — 가짜 manifest 를 가리켜 업데이트 흐름을 돌려 본다
fn manifest_url() -> String {
    std::env::var("MESO_UPDATE_MANIFEST").unwrap_or_else(|_| MANIFEST.to_string())
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(8))
        .timeout_read(Duration::from_secs(60))
        .build()
}

pub fn parse_manifest(body: &serde_json::Value) -> Result<Latest, String> {
    let version = body["version"].as_str().ok_or("manifest 에 version 이 없음")?.to_string();
    let release_url = body["release_url"].as_str().unwrap_or(RELEASES_URL).to_string();
    let a = &body["assets"][PLATFORM];
    let asset = match (a["name"].as_str(), a["url"].as_str()) {
        (Some(name), Some(url)) => Some(Asset {
            name: name.to_string(),
            url: url.to_string(),
            sha256: a["sha256"]
                .as_str()
                .map(|s| s.trim_start_matches("sha256:").to_ascii_lowercase())
                .filter(|s| s.len() == 64),
        }),
        _ => None,
    };
    Ok(Latest { version, release_url, asset })
}

fn fetch_latest() -> Result<Latest, String> {
    let body: serde_json::Value = agent()
        .get(&manifest_url())
        .call()
        .map_err(|e| e.to_string())?
        .into_json()
        .map_err(|e| e.to_string())?;
    parse_manifest(&body)
}

// ---- 이미 물어본 버전 (앱 데이터 폴더의 update.json) ----

fn state_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("update.json"))
}

fn prompted<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let raw = std::fs::read_to_string(state_path(app)?).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v["promptedVersion"].as_str().map(str::to_string)
}

fn set_prompted<R: Runtime>(app: &AppHandle<R>, version: &str) {
    if let Some(path) = state_path(app) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(path, serde_json::json!({ "promptedVersion": version }).to_string());
    }
}

// ---- 대화상자 ----

fn dialog<R: Runtime>(app: &AppHandle<R>, msg: &str) -> tauri_plugin_dialog::MessageDialogBuilder<R> {
    let b = app.dialog().message(msg).title("메소 계산기").kind(MessageDialogKind::Info);
    #[cfg(desktop)]
    let b = match app.get_webview_window("main") {
        Some(w) => b.parent(&w),
        None => b,
    };
    b
}

fn ask<R: Runtime>(app: &AppHandle<R>, msg: &str, ok: &str) -> bool {
    dialog(app, msg)
        .buttons(MessageDialogButtons::OkCancelCustom(ok.to_string(), "나중에".to_string()))
        .blocking_show()
}

fn info<R: Runtime>(app: &AppHandle<R>, msg: &str) {
    // Android 기본 단추 글자가 영어("Ok")라서 직접 정한다
    dialog(app, msg).buttons(MessageDialogButtons::OkCustom("확인".to_string())).blocking_show();
}

fn open<R: Runtime>(app: &AppHandle<R>, url: &str) {
    let _ = app.opener().open_url(url, None::<&str>);
}

// ---- 확인 ----

/// manual: 사용자가 "업데이트 확인"을 눌렀을 때. 확인은 뒤에서 돌고, 이미 도는 중이면 겹쳐 돌리지 않는다.
pub fn check<R: Runtime>(app: AppHandle<R>, manual: bool) {
    if BUSY.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        run_check(&app, manual);
        BUSY.store(false, Ordering::SeqCst);
    });
}

fn run_check<R: Runtime>(app: &AppHandle<R>, manual: bool) {
    let current = app.package_info().version.to_string();
    let latest = match fetch_latest() {
        Ok(l) => l,
        Err(e) => {
            if manual {
                info(app, &format!("새 버전을 확인하지 못했습니다.\n{e}"));
            }
            return;
        }
    };
    if !version::is_newer(&latest.version, &current) {
        if manual {
            info(app, &format!("최신 버전입니다 (v{current})."));
        }
        return;
    }
    if !manual {
        if prompted(app).as_deref() == Some(latest.version.as_str()) {
            return;
        }
        // 묻기 전에 적는다 — 창을 닫거나 앱이 꺼져도 같은 버전을 계속 묻지 않게
        set_prompted(app, &latest.version);
    }
    match &latest.asset {
        Some(asset) => install(app, &latest, asset, &current),
        None => {
            // 이 플랫폼 설치 파일이 없는 릴리스
            let msg = format!("메소 계산기 v{} 이 나왔습니다 (지금 v{current}).\n릴리스 페이지를 열까요?", latest.version);
            if ask(app, &msg, "열기") {
                open(app, &latest.release_url);
            }
        }
    }
}

#[cfg(target_os = "android")]
fn install<R: Runtime>(app: &AppHandle<R>, latest: &Latest, asset: &Asset, current: &str) {
    let msg = format!(
        "메소 계산기 v{} 이 나왔습니다 (지금 v{current}).\n브라우저로 새 APK 를 받을까요? 다 받으면 알림에서 열어 설치하세요.",
        latest.version
    );
    if ask(app, &msg, "받기") {
        open(app, &asset.url);
    }
}

#[cfg(not(target_os = "android"))]
fn install<R: Runtime>(app: &AppHandle<R>, latest: &Latest, asset: &Asset, current: &str) {
    let msg = format!(
        "메소 계산기 v{} 이 나왔습니다 (지금 v{current}).\n지금 받아서 설치할까요? 설치가 끝나면 다시 열립니다.",
        latest.version
    );
    if !ask(app, &msg, "업데이트") {
        return;
    }
    let path = match download(asset) {
        Ok(p) => p,
        Err(e) => {
            if ask(app, &format!("새 버전을 받지 못했습니다.\n{e}\n\n릴리스 페이지에서 직접 받을까요?"), "열기") {
                open(app, &latest.release_url);
            }
            return;
        }
    };
    // Tauri 업데이터와 같은 인자: /P 진행 창만, /UPDATE 업데이트 설치, /R 설치 후 다시 실행
    match std::process::Command::new(&path).args(["/P", "/UPDATE", "/R"]).spawn() {
        Ok(_) => app.exit(0),
        Err(e) => info(app, &format!("설치 프로그램을 열지 못했습니다.\n{e}\n{}", path.display())),
    }
}

#[cfg(not(target_os = "android"))]
fn download(asset: &Asset) -> Result<PathBuf, String> {
    use sha2::{Digest, Sha256};
    use std::io::{Read, Write};

    let name = std::path::Path::new(&asset.name)
        .file_name()
        .ok_or("파일 이름이 이상함")?
        .to_owned();
    let dir = std::env::temp_dir().join("meso-calcul-update");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);

    let res = agent().get(&asset.url).call().map_err(|e| e.to_string())?;
    let mut reader = res.into_reader();
    let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
    }
    drop(file);
    let hex = format!("{:x}", hasher.finalize());
    if let Some(want) = &asset.sha256 {
        if &hex != want {
            let _ = std::fs::remove_file(&path);
            return Err("받은 파일의 SHA-256 이 릴리스와 다릅니다.".to_string());
        }
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_assets() {
        let body = serde_json::json!({
            "schema": 1, "version": "1.1.0", "release_url": "https://example/r",
            "assets": {
                "windows": { "name": "MesoCalc-Setup-1.1.0.exe", "url": "https://example/w",
                             "sha256": "sha256:ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789" },
                "android": { "name": "MesoCalc-1.1.0.apk", "url": "https://example/a", "sha256": null }
            }
        });
        let l = parse_manifest(&body).unwrap();
        assert_eq!(l.version, "1.1.0");
        assert_eq!(l.release_url, "https://example/r");
        let a = l.asset.unwrap();
        assert_eq!(a.name, "MesoCalc-Setup-1.1.0.exe");
        assert_eq!(a.sha256.as_deref(), Some("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"));
    }

    #[test]
    fn manifest_without_platform() {
        let body = serde_json::json!({ "version": "1.0.0", "assets": { "android": { "name": "a.apk", "url": "u" } } });
        let l = parse_manifest(&body).unwrap();
        assert!(l.asset.is_none());
        assert_eq!(l.release_url, RELEASES_URL);
        assert!(parse_manifest(&serde_json::json!({})).is_err());
    }
}
