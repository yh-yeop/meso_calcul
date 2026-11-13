// 메소 계산기 설치판 (Windows · Android 공용).
// 창은 배포된 사이트(GitHub Pages)를 그대로 연다: 사이트를 고치면 앱도 따라 바뀌고,
// 출처가 같아서 Firebase 로그인 · 동기화가 웹과 똑같이 동작한다(Android 는 Google 이 웹뷰 로그인을 막음).
// 오프라인은 사이트의 서비스 워커가 맡는다. 앱 자체의 새 버전은 update.rs.

mod update;
mod version;

use tauri::{Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

const SITE: &str = "https://yh-yeop.github.io/meso_calcul/";
/// 웹이 앱에 부탁할 때 이동하는 가짜 주소. on_navigation 이 가로채고 실제로는 이동하지 않는다
/// (원격 페이지에 IPC 권한을 열지 않으려고). 웹 쪽은 appinfo.js 가 부르는 MesoApp.checkUpdate().
const BRIDGE_HOST: &str = "meso-app.invalid";

/// 앱 창 안에서 열어도 되는 주소: 계산기 자체와 Google 로그인(Firebase) 흐름
fn in_app(url: &Url) -> bool {
    if url.scheme() == "about" {
        return true;
    }
    if url.scheme() != "https" {
        return false;
    }
    let host = url.host_str().unwrap_or("");
    (host == "yh-yeop.github.io" && url.path().starts_with("/meso_calcul"))
        || host == "meso-save.firebaseapp.com"
        || host == "accounts.google.com"
        || (host.ends_with(".google.com") && url.path().contains("signin"))
}

/// 페이지가 열릴 때마다 먼저 도는 스크립트 — 웹이 설치판인지, 몇 버전인지 알게 한다
fn init_script(version: &str) -> String {
    format!(
        "window.MesoApp=Object.freeze({{platform:{p:?},version:{v:?},releases:{r:?},\
         checkUpdate:function(){{location.href='https://{h}/check-update';}}}});",
        p = update::PLATFORM,
        v = version,
        r = update::RELEASES_URL,
        h = BRIDGE_HOST
    )
}

#[cfg(desktop)]
fn desktop_window<'a, R: tauri::Runtime, M: tauri::Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
    handle: tauri::AppHandle<R>,
) -> WebviewWindowBuilder<'a, R, M> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tauri::webview::NewWindowResponse;

    let popups = AtomicUsize::new(0);
    builder
        .title("메소 계산기")
        .inner_size(480.0, 860.0)
        .min_inner_size(360.0, 560.0)
        .center()
        // 로그인 팝업은 앱 안에 띄워야 window.opener 로 결과가 돌아온다. 그 밖의 새 창은 기본 브라우저로
        .on_new_window(move |url, features| {
            if !in_app(&url) {
                let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                return NewWindowResponse::Deny;
            }
            let n = popups.fetch_add(1, Ordering::Relaxed);
            let blank = WebviewUrl::External("about:blank".parse().unwrap());
            match WebviewWindowBuilder::new(&handle, format!("popup-{n}"), blank)
                .window_features(features)
                .title("로그인")
                .on_document_title_changed(|w, title| {
                    let _ = w.set_title(&title);
                })
                .build()
            {
                Ok(window) => NewWindowResponse::Create { window },
                Err(_) => NewWindowResponse::Deny,
            }
        })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let nav = handle.clone();
            let version = app.package_info().version.to_string();
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(SITE.parse().unwrap()))
                .initialization_script(init_script(&version))
                // 바깥 링크(메이플 계산기 모음 등)는 앱 창을 떠나지 않게 기본 브라우저로
                .on_navigation(move |url| {
                    if url.host_str() == Some(BRIDGE_HOST) {
                        if url.path() == "/check-update" {
                            update::check(nav.clone(), true);
                        }
                        return false;
                    }
                    if in_app(url) {
                        return true;
                    }
                    let _ = nav.opener().open_url(url.as_str(), None::<&str>);
                    false
                });
            #[cfg(desktop)]
            let builder = desktop_window(builder, handle.clone());
            builder.build()?;
            update::check(handle, false);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("메소 계산기 실행 실패");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links() {
        let ok = |s: &str| in_app(&s.parse().unwrap());
        assert!(ok("https://yh-yeop.github.io/meso_calcul/#home"));
        assert!(ok("https://meso-save.firebaseapp.com/__/auth/handler?x=1"));
        assert!(ok("https://accounts.google.com/o/oauth2/auth"));
        assert!(ok("about:blank"));
        assert!(!ok("https://yh-yeop.github.io/#maple"));
        assert!(!ok("https://openapi.nexon.com/ko/my-application/"));
        assert!(!ok("http://yh-yeop.github.io/meso_calcul/"));
    }

    #[test]
    fn script_is_js_object() {
        let s = init_script("1.0.0");
        assert!(s.contains("version:\"1.0.0\""));
        assert!(s.contains("platform:\"windows\""));
        assert!(s.contains("https://meso-app.invalid/check-update"));
    }
}
