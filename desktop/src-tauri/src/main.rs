// Windows 진입점. 앱 본체는 lib.rs (Android 와 같이 쓴다)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    meso_calcul_lib::run()
}
